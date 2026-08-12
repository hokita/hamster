import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockGenerateContent } = vi.hoisted(() => ({ mockGenerateContent: vi.fn() }))

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: mockGenerateContent }
  },
}))

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

  it('calls the model eagle uses, with a bounded output budget', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'ok' })
    await summarize('Title', 'Article body')
    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3.1-flash-lite',
        config: expect.objectContaining({ maxOutputTokens: 1024 }),
      })
    )
  })

  it('puts the trusted rules in systemInstruction, asking for English output and three bullets', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'ok' })
    await summarize('My Title', 'The article body text')
    const call = mockGenerateContent.mock.calls[0][0]
    const systemInstruction = call.config.systemInstruction as string
    expect(systemInstruction).toContain('English')
    expect(systemInstruction).toContain('three')
  })

  it('keeps the rules out of contents, which carries only the untrusted title and body', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'ok' })
    await summarize('My Title', 'The article body text')
    const contents = mockGenerateContent.mock.calls[0][0].contents as string
    expect(contents).toContain('My Title')
    expect(contents).toContain('The article body text')
    expect(contents).not.toContain('Rules:')
    expect(contents).not.toContain('Write in English')
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
})
