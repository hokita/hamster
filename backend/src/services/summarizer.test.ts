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

import { summarize, SummarizerUnavailableError } from './summarizer'

const originalKey = process.env.GEMINI_API_KEY

beforeEach(() => {
  vi.clearAllMocks()
  process.env.GEMINI_API_KEY = 'test-key'
})

afterEach(() => {
  if (originalKey === undefined) delete process.env.GEMINI_API_KEY
  else process.env.GEMINI_API_KEY = originalKey
})

describe('summarize', () => {
  it('returns the generated text', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'A summary.\n\n- one\n- two\n- three' })
    await expect(summarize('Title', 'Article body')).resolves.toBe(
      'A summary.\n\n- one\n- two\n- three'
    )
  })

  it('calls the latest Flash model, with a bounded output budget', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'ok' })
    await summarize('Title', 'Article body')
    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3.7-flash',
        config: expect.objectContaining({ maxOutputTokens: 8192 }),
      })
    )
  })

  it('asks for the lowest supported thinking, so the output budget funds the summary and not the reasoning', async () => {
    // Thinking tokens are drawn from maxOutputTokens, and flash models think at "medium" by
    // default. Left at the default, reasoning about a 20k-char article exhausts the budget before
    // any summary text is emitted, and every request dies on the MAX_TOKENS guard below.
    // gemini-3.7-flash rejects MINIMAL outright (400 INVALID_ARGUMENT, verified live), so LOW is
    // the floor for this model.
    mockGenerateContent.mockResolvedValue({ text: 'ok' })
    await summarize('Title', 'Article body')
    const config = mockGenerateContent.mock.calls[0][0].config
    expect(config.thinkingConfig).toEqual({ thinkingLevel: 'LOW' })
  })

  it('puts the trusted rules in systemInstruction', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'ok' })
    await summarize('My Title', 'The article body text')
    const call = mockGenerateContent.mock.calls[0][0]
    const systemInstruction = call.config.systemInstruction as string
    expect(systemInstruction).toContain('Rules:')
    expect(systemInstruction).toContain('Do not speculate')
  })

  it('asks for the summary in the article language, falling back to English', async () => {
    // A Japanese article deserves a Japanese summary, and vice versa; anything else is summarized
    // in English rather than in a language the reader most likely cannot read.
    mockGenerateContent.mockResolvedValue({ text: 'ok' })
    await summarize('My Title', 'The article body text')
    const systemInstruction = mockGenerateContent.mock.calls[0][0].config
      .systemInstruction as string
    expect(systemInstruction).toContain('the language the article itself is written in')
    expect(systemInstruction).toContain('English or')
    expect(systemInstruction).toContain('Japanese')
    expect(systemInstruction).toContain('any other language, write the summary in English')
    // The old rule forced English on every article, whatever it was written in.
    expect(systemInstruction).not.toContain('Write in English, even when')
  })

  it('asks for a summary long enough to be worth reading', async () => {
    // The first version asked for three sentences and three bullets, which read as a teaser rather
    // than a summary. Two paragraphs around four to six substantive bullets is the shape now.
    mockGenerateContent.mockResolvedValue({ text: 'ok' })
    await summarize('My Title', 'The article body text')
    const systemInstruction = mockGenerateContent.mock.calls[0][0].config
      .systemInstruction as string
    expect(systemInstruction).toContain('three to five sentences')
    expect(systemInstruction).toContain('four to six bullet points')
    expect(systemInstruction).toContain('two or three sentences')
    expect(systemInstruction).not.toContain('exactly three bullet points')
  })

  it('asks for Markdown, restricted to the constructs the page renders', async () => {
    // The page renders the summary as Markdown but drops anything outside this subset, so the
    // prompt has to stay inside it — a summary whose substance lives in a table or a link arrives
    // gutted. Headings are part of the deal: they are what makes a summary skimmable.
    mockGenerateContent.mockResolvedValue({ text: 'ok' })
    await summarize('My Title', 'The article body text')
    const systemInstruction = mockGenerateContent.mock.calls[0][0].config
      .systemInstruction as string
    expect(systemInstruction).toContain('Markdown')
    expect(systemInstruction).toContain('"## " section headings')
    expect(systemInstruction).toContain('**bold**')
    expect(systemInstruction).toContain('Never use links, images, tables, code blocks')
    expect(systemInstruction).toContain('Key points')
    expect(systemInstruction).toContain('Takeaway')
    // Headings in English above a Japanese summary would read as a translation glitch.
    expect(systemInstruction).toContain('write them in the summary language too')
    // The old rule banned every heading, which was right when the output was plain text.
    expect(systemInstruction).not.toContain('no heading, no preamble')
  })

  it('keeps the rules out of contents, which carries only the untrusted title and body', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'ok' })
    await summarize('My Title', 'The article body text')
    const contents = mockGenerateContent.mock.calls[0][0].contents as string
    expect(contents).toContain('My Title')
    expect(contents).toContain('The article body text')
    expect(contents).not.toContain('Rules:')
    expect(contents).not.toContain('Do not speculate')
  })

  it('fences the title the same way as the body, instead of leaving it bare', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'ok' })
    await summarize('My Title', 'The article body text')
    const contents = mockGenerateContent.mock.calls[0][0].contents as string
    expect(contents).not.toContain('Page title: My Title')
    expect(contents).toMatch(/"""\s*My Title\s*"""/)
  })

  it('passes an AbortSignal via config.abortSignal so the SDK actually cancels the request', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'ok' })
    await summarize('Title', 'Body')
    const config = mockGenerateContent.mock.calls[0][0].config
    expect(config.abortSignal).toBeInstanceOf(AbortSignal)
  })

  it('throws SummarizerUnavailableError when the API key is not configured', async () => {
    delete process.env.GEMINI_API_KEY
    await expect(summarize('Title', 'Body')).rejects.toBeInstanceOf(SummarizerUnavailableError)
    expect(mockGenerateContent).not.toHaveBeenCalled()
  })

  it('throws when the API call fails', async () => {
    mockGenerateContent.mockRejectedValue(new Error('429 rate limited'))
    await expect(summarize('Title', 'Body')).rejects.toThrow()
  })

  it('throws when the response has no text', async () => {
    mockGenerateContent.mockResolvedValue({ text: '   ' })
    await expect(summarize('Title', 'Body')).rejects.toThrow()
  })

  it('throws when generation stopped early because it hit the token cap', async () => {
    // A response cut off at MAX_OUTPUT_TOKENS ends mid-sentence with no indication. The prompt
    // asks for ~150 tokens of output, so hitting the 1024 cap means the model went badly
    // off-script — surfacing that as a retryable failure beats storing half a summary.
    mockGenerateContent.mockResolvedValue({
      text: 'A summary that stops abruptly halfway through',
      candidates: [{ finishReason: 'MAX_TOKENS' }],
    })
    await expect(summarize('Title', 'Body')).rejects.toThrow()
  })

  it('returns normally when finishReason is STOP', async () => {
    mockGenerateContent.mockResolvedValue({
      text: 'A complete summary.',
      candidates: [{ finishReason: 'STOP' }],
    })
    await expect(summarize('Title', 'Body')).resolves.toBe('A complete summary.')
  })

  it('returns normally when the response has no candidates array at all', async () => {
    // A shape the SDK legitimately produces; the finishReason check must not throw on its absence.
    mockGenerateContent.mockResolvedValue({ text: 'A complete summary.' })
    await expect(summarize('Title', 'Body')).resolves.toBe('A complete summary.')
  })
})
