import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockGenerateContent } = vi.hoisted(() => ({ mockGenerateContent: vi.fn() }))

vi.mock('@google/genai', async () => {
  const actual = await vi.importActual<typeof import('@google/genai')>('@google/genai')
  return {
    GoogleGenAI: class {
      models = { generateContent: mockGenerateContent }
    },
    // The real enum, not a stand-in: the thinking assertion below is only worth anything if it
    // pins the value the SDK actually puts on the wire.
    ThinkingLevel: actual.ThinkingLevel,
  }
})

import { translate, isTranslatorConfigured, TranslatorUnavailableError } from './translator'

const originalKey = process.env.GEMINI_API_KEY

beforeEach(() => {
  vi.clearAllMocks()
  process.env.GEMINI_API_KEY = 'test-key'
})

afterEach(() => {
  if (originalKey === undefined) delete process.env.GEMINI_API_KEY
  else process.env.GEMINI_API_KEY = originalKey
})

describe('isTranslatorConfigured', () => {
  it('is true only while GEMINI_API_KEY is set', () => {
    expect(isTranslatorConfigured()).toBe(true)
    delete process.env.GEMINI_API_KEY
    expect(isTranslatorConfigured()).toBe(false)
  })
})

describe('translate', () => {
  it('returns the translated text', async () => {
    mockGenerateContent.mockResolvedValue({ text: '## 要点\n- 一つ目' })
    await expect(translate('## Key points\n- The first one')).resolves.toBe('## 要点\n- 一つ目')
  })

  it('trims the surrounding whitespace the model sometimes emits', async () => {
    mockGenerateContent.mockResolvedValue({ text: '\n\n概要。\n' })
    await expect(translate('An overview.')).resolves.toBe('概要。')
  })

  it('calls the same pinned Flash model as the summarizer, with a bounded output budget', async () => {
    // Japanese costs more tokens per sentence than the English it is translating, so the budget
    // has to clear the input comfortably rather than match it.
    mockGenerateContent.mockResolvedValue({ text: 'ok' })
    await translate('A summary.')
    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3.7-flash',
        config: expect.objectContaining({ maxOutputTokens: 16384 }),
      })
    )
  })

  it('asks for the lowest supported thinking, so the output budget funds the translation', async () => {
    // Same trap as the summarizer: thinking tokens are drawn from maxOutputTokens, and at the
    // default "medium" a long summary can exhaust the budget before the first output token.
    mockGenerateContent.mockResolvedValue({ text: 'ok' })
    await translate('A summary.')
    const config = mockGenerateContent.mock.calls[0][0].config
    expect(config.thinkingConfig).toEqual({ thinkingLevel: 'LOW' })
  })

  it('asks for Japanese, preserving the Markdown structure it was given', async () => {
    // The translation is rendered by the same component as the summary, so it has to come back
    // as the same subset of Markdown — a translation that flattens the headings and bullets
    // arrives as one unreadable block.
    mockGenerateContent.mockResolvedValue({ text: 'ok' })
    await translate('A summary.')
    const systemInstruction = mockGenerateContent.mock.calls[0][0].config
      .systemInstruction as string
    expect(systemInstruction).toContain('Japanese')
    expect(systemInstruction).toContain('"## " headings')
    expect(systemInstruction).toContain('**bold**')
  })

  it('asks for a translation rather than a summary of the summary', async () => {
    // The text handed over is already a summary. A model asked to "condense" it a second time
    // returns something shorter than what the English reader sees, which is not a translation.
    mockGenerateContent.mockResolvedValue({ text: 'ok' })
    await translate('A summary.')
    const systemInstruction = mockGenerateContent.mock.calls[0][0].config
      .systemInstruction as string
    expect(systemInstruction).toContain('Do not summarize, shorten, or expand')
    expect(systemInstruction).toContain('nothing else')
  })

  it('keeps the rules out of contents, which carries only the untrusted summary', async () => {
    // The summary was written from an untrusted page, so it stays fenced and labelled as content
    // in the user turn — same treatment the summarizer gives the page it came from.
    mockGenerateContent.mockResolvedValue({ text: 'ok' })
    await translate('The summary text')
    const call = mockGenerateContent.mock.calls[0][0]
    const contents = call.contents as string
    expect(contents).toContain('The summary text')
    expect(contents).toMatch(/"""\s*The summary text\s*"""/)
    expect(contents).not.toContain('Do not summarize, shorten, or expand')
  })

  it('passes an AbortSignal via config.abortSignal so the SDK actually cancels the request', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'ok' })
    await translate('A summary.')
    const config = mockGenerateContent.mock.calls[0][0].config
    expect(config.abortSignal).toBeInstanceOf(AbortSignal)
  })

  it('throws TranslatorUnavailableError when the API key is not configured', async () => {
    delete process.env.GEMINI_API_KEY
    await expect(translate('A summary.')).rejects.toBeInstanceOf(TranslatorUnavailableError)
    expect(mockGenerateContent).not.toHaveBeenCalled()
  })

  it('throws when the API call fails', async () => {
    mockGenerateContent.mockRejectedValue(new Error('429 rate limited'))
    await expect(translate('A summary.')).rejects.toThrow()
  })

  it('throws when the response has no text', async () => {
    mockGenerateContent.mockResolvedValue({ text: '   ' })
    await expect(translate('A summary.')).rejects.toThrow()
  })

  it('throws when generation stopped early because it hit the token cap', async () => {
    // A translation cut off at the cap ends mid-sentence with no indication, and the page would
    // show it beside a button offering to switch back to the complete English. Failing is honest.
    mockGenerateContent.mockResolvedValue({
      text: '途中で切れた訳',
      candidates: [{ finishReason: 'MAX_TOKENS' }],
    })
    await expect(translate('A summary.')).rejects.toThrow()
  })

  it('returns normally when the response has no candidates array at all', async () => {
    // A shape the SDK legitimately produces; the finishReason check must not throw on its absence.
    mockGenerateContent.mockResolvedValue({ text: '完全な訳。' })
    await expect(translate('A summary.')).resolves.toBe('完全な訳。')
  })
})
