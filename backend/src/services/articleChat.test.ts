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

import { answerQuestion, ChatUnavailableError } from './articleChat'
import type { ChatMessage } from './articleChat'

const originalKey = process.env.GEMINI_API_KEY

beforeEach(() => {
  vi.clearAllMocks()
  process.env.GEMINI_API_KEY = 'test-key'
})

afterEach(() => {
  if (originalKey === undefined) delete process.env.GEMINI_API_KEY
  else process.env.GEMINI_API_KEY = originalKey
})

const question: ChatMessage[] = [{ role: 'user', text: 'What is the main argument?' }]

describe('answerQuestion', () => {
  it('returns the generated answer', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'The article argues X.' })
    await expect(answerQuestion('Title', 'Article body', question)).resolves.toBe(
      'The article argues X.'
    )
  })

  it('calls the latest Flash model, with a bounded output budget', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'ok' })
    await answerQuestion('Title', 'Article body', question)
    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3.7-flash',
        config: expect.objectContaining({ maxOutputTokens: 8192 }),
      })
    )
  })

  it('asks for the lowest supported thinking, so the output budget funds the answer', async () => {
    // Thinking tokens are drawn from maxOutputTokens; gemini-3.7-flash rejects MINIMAL
    // (400 INVALID_ARGUMENT — see summarizer.ts), so LOW is the floor for this model.
    mockGenerateContent.mockResolvedValue({ text: 'ok' })
    await answerQuestion('Title', 'Article body', question)
    const config = mockGenerateContent.mock.calls[0][0].config
    expect(config.thinkingConfig).toEqual({ thinkingLevel: 'LOW' })
  })

  it('puts the trusted rules in systemInstruction', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'ok' })
    await answerQuestion('My Title', 'The article body text', question)
    const systemInstruction = mockGenerateContent.mock.calls[0][0].config
      .systemInstruction as string
    expect(systemInstruction).toContain('Rules:')
    expect(systemInstruction).toContain('only information found in the article')
  })

  it('tells the model to admit when the article does not cover the question', async () => {
    // An answer invented beyond the article would defeat the point of asking about THIS article.
    mockGenerateContent.mockResolvedValue({ text: 'ok' })
    await answerQuestion('My Title', 'The article body text', question)
    const systemInstruction = mockGenerateContent.mock.calls[0][0].config
      .systemInstruction as string
    expect(systemInstruction).toContain('does not cover')
  })

  it('asks for the answer in the question language, falling back to English', async () => {
    // Same policy as the summarizer: the app renders English and Japanese (its lang derivation
    // knows only those two scripts), so the prompt must not promise other languages — an answer
    // in one would be marked lang="en" and mispronounced by screen readers.
    mockGenerateContent.mockResolvedValue({ text: 'ok' })
    await answerQuestion('My Title', 'The article body text', question)
    const systemInstruction = mockGenerateContent.mock.calls[0][0].config
      .systemInstruction as string
    expect(systemInstruction).toContain('language the question was asked in')
    expect(systemInstruction).toContain('English or')
    expect(systemInstruction).toContain('Japanese')
    expect(systemInstruction).toContain('any other language, answer in English')
  })

  it('merges the fenced article and the first question into one user turn, so roles alternate', async () => {
    // Gemini's multi-turn contract is alternating user/model roles; a separate leading article
    // turn followed by the first question is two consecutive user contents, which the API can
    // reject. The article rides as an extra part of the first user turn instead — same channel,
    // same fencing, valid alternation.
    mockGenerateContent.mockResolvedValue({ text: 'ok' })
    const conversation: ChatMessage[] = [
      { role: 'user', text: 'First question?' },
      { role: 'model', text: 'First answer.' },
      { role: 'user', text: 'Follow-up question?' },
    ]
    await answerQuestion('My Title', 'The article body text', conversation)
    const contents = mockGenerateContent.mock.calls[0][0].contents as {
      role: string
      parts: { text: string }[]
    }[]
    expect(contents).toHaveLength(3)
    expect(contents.map((content) => content.role)).toEqual(['user', 'model', 'user'])
    expect(contents[0].parts).toHaveLength(2)
    expect(contents[0].parts[0].text).toMatch(/"""\s*My Title\s*"""/)
    expect(contents[0].parts[0].text).toMatch(/"""\s*The article body text\s*"""/)
    expect(contents[0].parts[0].text).toContain('Untrusted')
    expect(contents[0].parts[1]).toEqual({ text: 'First question?' })
    expect(contents[1]).toEqual({ role: 'model', parts: [{ text: 'First answer.' }] })
    expect(contents[2]).toEqual({ role: 'user', parts: [{ text: 'Follow-up question?' }] })
  })

  it('keeps the rules out of the article turn', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'ok' })
    await answerQuestion('My Title', 'The article body text', question)
    const contents = mockGenerateContent.mock.calls[0][0].contents as {
      role: string
      parts: { text: string }[]
    }[]
    expect(contents[0].parts[0].text).not.toContain('Rules:')
  })

  it('passes an AbortSignal via config.abortSignal so the SDK actually cancels the request', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'ok' })
    await answerQuestion('Title', 'Body', question)
    const config = mockGenerateContent.mock.calls[0][0].config
    expect(config.abortSignal).toBeInstanceOf(AbortSignal)
  })

  it('throws ChatUnavailableError when the API key is not configured', async () => {
    delete process.env.GEMINI_API_KEY
    await expect(answerQuestion('Title', 'Body', question)).rejects.toBeInstanceOf(
      ChatUnavailableError
    )
    expect(mockGenerateContent).not.toHaveBeenCalled()
  })

  it('throws when the API call fails', async () => {
    mockGenerateContent.mockRejectedValue(new Error('429 rate limited'))
    await expect(answerQuestion('Title', 'Body', question)).rejects.toThrow()
  })

  it('throws when the response has no text', async () => {
    mockGenerateContent.mockResolvedValue({ text: '   ' })
    await expect(answerQuestion('Title', 'Body', question)).rejects.toThrow()
  })

  it('throws when generation stopped early because it hit the token cap', async () => {
    // An answer cut off at the cap ends mid-sentence with no indication; surfacing that as a
    // retryable failure beats showing half an answer as if it were whole.
    mockGenerateContent.mockResolvedValue({
      text: 'An answer that stops abruptly',
      candidates: [{ finishReason: 'MAX_TOKENS' }],
    })
    await expect(answerQuestion('Title', 'Body', question)).rejects.toThrow()
  })

  it('returns normally when finishReason is STOP', async () => {
    mockGenerateContent.mockResolvedValue({
      text: 'A complete answer.',
      candidates: [{ finishReason: 'STOP' }],
    })
    await expect(answerQuestion('Title', 'Body', question)).resolves.toBe('A complete answer.')
  })

  it('returns normally when the response has no candidates array at all', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'A complete answer.' })
    await expect(answerQuestion('Title', 'Body', question)).resolves.toBe('A complete answer.')
  })
})
