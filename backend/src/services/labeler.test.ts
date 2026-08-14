import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockGenerateContent } = vi.hoisted(() => ({ mockGenerateContent: vi.fn() }))

vi.mock('@google/genai', async () => {
  const actual = await vi.importActual<typeof import('@google/genai')>('@google/genai')
  return {
    GoogleGenAI: class {
      models = { generateContent: mockGenerateContent }
    },
    // Real enums, not stand-ins: assertions on these are only worth anything if they pin the
    // values the SDK actually puts on the wire.
    ThinkingLevel: actual.ThinkingLevel,
    Type: actual.Type,
  }
})

import { generateLabels, LabelerUnavailableError } from './labeler'

const originalKey = process.env.GEMINI_API_KEY

beforeEach(() => {
  vi.clearAllMocks()
  process.env.GEMINI_API_KEY = 'test-key'
})

afterEach(() => {
  if (originalKey === undefined) delete process.env.GEMINI_API_KEY
  else process.env.GEMINI_API_KEY = originalKey
})

describe('generateLabels', () => {
  it('returns the parsed labels', async () => {
    mockGenerateContent.mockResolvedValue({ text: '["typescript", "testing"]' })
    await expect(generateLabels('Title', 'Body', [])).resolves.toEqual(['typescript', 'testing'])
  })

  it('calls the flash-lite model with JSON output and minimal thinking', async () => {
    mockGenerateContent.mockResolvedValue({ text: '["a"]' })
    await generateLabels('Title', 'Body', [])
    const call = mockGenerateContent.mock.calls[0][0]
    expect(call.model).toBe('gemini-3.6-flash-lite')
    expect(call.config.responseMimeType).toBe('application/json')
    expect(call.config.responseSchema).toEqual({ type: 'ARRAY', items: { type: 'STRING' } })
    expect(call.config.thinkingConfig).toEqual({ thinkingLevel: 'MINIMAL' })
    expect(call.config.maxOutputTokens).toBe(4096)
    expect(call.config.abortSignal).toBeInstanceOf(AbortSignal)
  })

  it('puts the trusted rules in systemInstruction, asking for lowercase English labels', async () => {
    mockGenerateContent.mockResolvedValue({ text: '["a"]' })
    await generateLabels('Title', 'Body', [])
    const systemInstruction = mockGenerateContent.mock.calls[0][0].config
      .systemInstruction as string
    expect(systemInstruction).toContain('English')
    expect(systemInstruction).toContain('lowercase')
  })

  it('includes the existing labels in the user turn and fences the untrusted title and body', async () => {
    mockGenerateContent.mockResolvedValue({ text: '["a"]' })
    await generateLabels('My Title', 'The body', ['react', 'testing'])
    const contents = mockGenerateContent.mock.calls[0][0].contents as string
    expect(contents).toMatch(/"""\s*react, testing\s*"""/)
    expect(contents).toMatch(/"""\s*My Title\s*"""/)
    expect(contents).toMatch(/"""\s*The body\s*"""/)
    expect(contents).not.toContain('Rules:')
  })

  it('fences the existing-labels list too, and drops labels that could escape the fence', async () => {
    mockGenerateContent.mockResolvedValue({ text: '["a"]' })
    await generateLabels('Title', 'Body', ['ok-label', 'bad"label'])
    const contents = mockGenerateContent.mock.calls[0][0].contents as string
    expect(contents).toContain('ok-label')
    expect(contents).not.toContain('bad"label')
  })

  it('says the existing-label list is empty rather than omitting the section', async () => {
    mockGenerateContent.mockResolvedValue({ text: '["a"]' })
    await generateLabels('Title', 'Body', [])
    const contents = mockGenerateContent.mock.calls[0][0].contents as string
    expect(contents).toContain('(none yet)')
  })

  it('normalizes: lowercases, trims, dedupes, drops empties and >40-char labels, caps at 5', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify([
        '  TypeScript ',
        'typescript',
        '',
        'x'.repeat(41),
        'a',
        'b',
        'c',
        'd',
        'e',
      ]),
    })
    await expect(generateLabels('Title', 'Body', [])).resolves.toEqual([
      'typescript',
      'a',
      'b',
      'c',
      'd',
    ])
  })

  it('normalizes: rejects labels outside the allowed charset (newlines, quotes, control characters, markup) while keeping punctuation used in real tech labels', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify([
        'good label',
        'bad\nlabel',
        'bad"label',
        '<markup>',
        '\x07',
        '.net',
        'c++',
        'ci/cd',
      ]),
    })
    await expect(generateLabels('Title', 'Body', [])).resolves.toEqual([
      'good label',
      '.net',
      'c++',
      'ci/cd',
    ])
  })

  it('throws when every label is dropped by normalization', async () => {
    mockGenerateContent.mockResolvedValue({ text: '["", "   "]' })
    await expect(generateLabels('Title', 'Body', [])).rejects.toThrow()
  })

  it('throws when the response is not valid JSON', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'not json' })
    await expect(generateLabels('Title', 'Body', [])).rejects.toThrow()
  })

  it('throws when the response JSON is not an array of strings', async () => {
    mockGenerateContent.mockResolvedValue({ text: '{"labels": ["a"]}' })
    await expect(generateLabels('Title', 'Body', [])).rejects.toThrow()
  })

  it('throws when generation stopped early because it hit the token cap', async () => {
    mockGenerateContent.mockResolvedValue({
      text: '["typescript", "tes',
      candidates: [{ finishReason: 'MAX_TOKENS' }],
    })
    await expect(generateLabels('Title', 'Body', [])).rejects.toThrow()
  })

  it('throws LabelerUnavailableError when the API key is not configured', async () => {
    delete process.env.GEMINI_API_KEY
    await expect(generateLabels('Title', 'Body', [])).rejects.toBeInstanceOf(
      LabelerUnavailableError
    )
    expect(mockGenerateContent).not.toHaveBeenCalled()
  })

  it('throws when the API call fails', async () => {
    mockGenerateContent.mockRejectedValue(new Error('429 rate limited'))
    await expect(generateLabels('Title', 'Body', [])).rejects.toThrow()
  })
})
