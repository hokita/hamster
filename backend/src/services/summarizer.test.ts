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

  it('asks for English output and three bullets, and includes the article', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'ok' })
    await summarize('My Title', 'The article body text')
    const prompt = mockGenerateContent.mock.calls[0][0].contents as string
    expect(prompt).toContain('English')
    expect(prompt).toContain('three')
    expect(prompt).toContain('My Title')
    expect(prompt).toContain('The article body text')
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
