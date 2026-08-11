import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./safeFetch', async () => {
  const actual = await vi.importActual<typeof import('./safeFetch')>('./safeFetch')
  return { ...actual, fetchAllowedUrl: vi.fn() }
})

import { fetchAllowedUrl } from './safeFetch'
import { fetchArticleText } from './articleFetcher'

function htmlResponse(html: string, contentType = 'text/html; charset=utf-8') {
  const bytes = new TextEncoder().encode(html)
  let sent = false
  return {
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null),
    },
    body: {
      getReader: () => ({
        read: async () => {
          if (sent) return { done: true, value: undefined }
          sent = true
          return { done: false, value: bytes }
        },
        cancel: async () => {},
      }),
    },
  }
}

function allow(html: string, contentType?: string) {
  vi.mocked(fetchAllowedUrl).mockResolvedValue({
    response: htmlResponse(html, contentType) as unknown as Response,
    finalUrl: 'https://example.com',
  })
}

beforeEach(() => vi.clearAllMocks())

describe('fetchArticleText', () => {
  it('returns the visible text of the page', async () => {
    allow('<html><body><h1>Title</h1><p>Hello world.</p></body></html>')
    await expect(fetchArticleText('https://example.com')).resolves.toBe('Title Hello world.')
  })

  it('drops script and style content', async () => {
    allow(
      '<body><script>var a = "SECRET";</script><style>.x{color:red}</style><p>Visible</p></body>'
    )
    const text = await fetchArticleText('https://example.com')
    expect(text).toBe('Visible')
  })

  it('drops HTML comments', async () => {
    allow('<body><!-- hidden note --><p>Shown</p></body>')
    await expect(fetchArticleText('https://example.com')).resolves.toBe('Shown')
  })

  it('decodes HTML entities', async () => {
    allow('<body><p>Tom &amp; Jerry &#39;95</p></body>')
    await expect(fetchArticleText('https://example.com')).resolves.toBe("Tom & Jerry '95")
  })

  it('collapses runs of whitespace and newlines into single spaces', async () => {
    allow('<body><p>one</p>\n\n   <p>two</p></body>')
    await expect(fetchArticleText('https://example.com')).resolves.toBe('one two')
  })

  it('truncates the text to 20000 characters', async () => {
    allow(`<body><p>${'a'.repeat(30000)}</p></body>`)
    const text = await fetchArticleText('https://example.com')
    expect(text).toHaveLength(20000)
  })

  it('returns null when the content type is not HTML', async () => {
    allow('{"not":"html"}', 'application/json')
    await expect(fetchArticleText('https://example.com')).resolves.toBeNull()
  })

  it('returns null when the page has no visible text', async () => {
    allow('<body>   <script>x()</script>  </body>')
    await expect(fetchArticleText('https://example.com')).resolves.toBeNull()
  })

  it('returns null when the URL is not fetchable', async () => {
    vi.mocked(fetchAllowedUrl).mockResolvedValue(null)
    await expect(fetchArticleText('https://blocked.test')).resolves.toBeNull()
  })

  it('returns null instead of throwing when the fetch rejects', async () => {
    vi.mocked(fetchAllowedUrl).mockRejectedValue(new Error('network down'))
    await expect(fetchArticleText('https://example.com')).resolves.toBeNull()
  })

  it('handles > in double-quoted attribute values', async () => {
    allow('<div title="5 > 3">Some text</div>')
    await expect(fetchArticleText('https://example.com')).resolves.toBe('Some text')
  })

  it('handles > in single-quoted attribute values', async () => {
    allow('<div title=\'a > b\'>Text</div>')
    await expect(fetchArticleText('https://example.com')).resolves.toBe('Text')
  })

  it('handles unterminated quotes gracefully', async () => {
    allow('<body><p>Normal</p><div title="unterminated>rest of page</div>')
    const text = await fetchArticleText('https://example.com')
    expect(text).toBeTruthy()
    // Properly-formed closing tags are still stripped even when opening is malformed
    expect(text).not.toContain('</div>')
  })
})
