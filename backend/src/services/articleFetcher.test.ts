import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./safeFetch', async () => {
  const actual = await vi.importActual<typeof import('./safeFetch')>('./safeFetch')
  return { ...actual, fetchAllowedUrl: vi.fn() }
})

import { fetchAllowedUrl } from './safeFetch'
import { fetchArticleText } from './articleFetcher'

function htmlResponse(html: string, contentType = 'text/html; charset=utf-8', status = 200) {
  const bytes = new TextEncoder().encode(html)
  let sent = false
  return {
    status,
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

function allow(html: string, contentType?: string, status?: number) {
  vi.mocked(fetchAllowedUrl).mockResolvedValue({
    response: htmlResponse(html, contentType, status) as unknown as Response,
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

  it('truncates the text to 200000 characters', async () => {
    allow(`<body><p>${'a'.repeat(250_000)}</p></body>`)
    const text = await fetchArticleText('https://example.com')
    expect(text).toHaveLength(200_000)
  })

  it('keeps the bytes already read when the stream dies mid-body', async () => {
    // Raising MAX_BYTES means a slow large page can still be mid-read when the 8s fetch deadline
    // aborts the stream. The bytes already delivered are a perfectly good truncated article — they
    // must survive as a truncation (which the two-pass strip already handles), not be discarded
    // wholesale by the outer catch.
    const bytes = new TextEncoder().encode(
      '<body><p>Delivered before the deadline</p><div class="rest'
    )
    let calls = 0
    vi.mocked(fetchAllowedUrl).mockResolvedValue({
      response: {
        status: 200,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null,
        },
        body: {
          getReader: () => ({
            read: async () => {
              calls++
              if (calls === 1) return { done: false, value: bytes }
              throw new DOMException('The operation was aborted.', 'AbortError')
            },
            cancel: async () => {},
          }),
        },
      } as unknown as Response,
      finalUrl: 'https://example.com',
    })
    await expect(fetchArticleText('https://example.com')).resolves.toBe(
      'Delivered before the deadline'
    )
  })

  it('returns null when the content type is not HTML', async () => {
    allow('{"not":"html"}', 'application/json')
    await expect(fetchArticleText('https://example.com')).resolves.toBeNull()
  })

  it('returns null when the page has no visible text', async () => {
    allow('<body>   <script>x()</script>  </body>')
    await expect(fetchArticleText('https://example.com')).resolves.toBeNull()
  })

  it('returns null when the response status is a 404 error page', async () => {
    allow('<html><body><h1>404 Not Found</h1></body></html>', undefined, 404)
    await expect(fetchArticleText('https://example.com')).resolves.toBeNull()
  })

  it('returns null when the response status is a 500 error page', async () => {
    allow('<html><body>Internal Server Error</body></html>', undefined, 500)
    await expect(fetchArticleText('https://example.com')).resolves.toBeNull()
  })

  it('returns the text when the response status is 200', async () => {
    allow('<body><p>Hello</p></body>', undefined, 200)
    await expect(fetchArticleText('https://example.com')).resolves.toBe('Hello')
  })

  it('returns null, not throws, for a 2xx response with no body', async () => {
    allow('', undefined, 204)
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

  it('does not let an apostrophe in later prose close a single-quoted attribute early', async () => {
    // A quote only opens an attribute value when it is the first non-whitespace character after
    // '='. The unescaped apostrophe in "it's a test" must not be treated as an attribute-value
    // opener, or the next apostrophe in "don't" would wrongly close it and swallow the sentence.
    allow(
      "<div title='it's a test'>IMPORTANT TEXT HERE, don't miss this</div><p>foo</p>"
    )
    await expect(fetchArticleText('https://example.com')).resolves.toBe(
      "IMPORTANT TEXT HERE, don't miss this foo"
    )
  })

  it('allows whitespace around = before a quoted attribute value', async () => {
    allow('<a href = "x">text</a>')
    await expect(fetchArticleText('https://example.com')).resolves.toBe('text')
  })

  it('handles an unquoted attribute value', async () => {
    allow('<img src=foo.jpg>text')
    await expect(fetchArticleText('https://example.com')).resolves.toBe('text')
  })

  it('recovers from unterminated quotes with content after', async () => {
    allow(
      '<body><p>Normal</p><div title="oops>middle text<p>More article content here</p></div><p>Final para</p></body>'
    )
    const text = await fetchArticleText('https://example.com')
    // Two-pass strip: quote-aware pass aborts on the unterminated attribute; the quote-blind
    // fallback recovers everything from that tag onward, including the well-formed content after it.
    expect(text).toBe('Normal middle text More article content here Final para')
  })

  it('keeps the quote-aware prefix parse when a page is truncated mid-tag', async () => {
    // Simulates the ordinary MAX_BYTES truncation case: a well-formed quoted '>' earlier in the
    // document, followed by a tag cut off entirely by the byte cap. The quote-aware parse of the
    // prefix must survive — only the truncated tail is reprocessed quote-blind.
    allow('<p title="5 > 3">Hello world</p><div class="trunc')
    const text = await fetchArticleText('https://example.com')
    expect(text).toBe('Hello world')
  })

  it('handles unterminated quotes gracefully', async () => {
    allow('<body><p>Normal</p><div title="unterminated>rest of page</div>')
    const text = await fetchArticleText('https://example.com')
    expect(text).toBe('Normal rest of page')
  })

  it('keeps a literal < in prose that is followed by a space and a real comparison', async () => {
    // A bare '<' in visible text (not the start of a tag) must survive as ordinary text, exactly
    // as a browser renders it. Only a '<' immediately followed by a letter, '/', '!' or '?' opens
    // a tag per the HTML tokenizer's tag-open state.
    allow('<p>x < y and z > q</p>')
    await expect(fetchArticleText('https://example.com')).resolves.toBe('x < y and z > q')
  })

  it('treats < followed by a space or a digit as text, not a tag', async () => {
    allow('<p>under <5 minutes</p>')
    await expect(fetchArticleText('https://example.com')).resolves.toBe('under <5 minutes')
    allow('<p>a < b</p>')
    await expect(fetchArticleText('https://example.com')).resolves.toBe('a < b')
  })

  it('treats a trailing bare < at end of input as text', async () => {
    allow('<p>trailing <')
    await expect(fetchArticleText('https://example.com')).resolves.toBe('trailing <')
  })

  it('still strips real tags: elements, comments, doctype and uppercase tags', async () => {
    allow('<!DOCTYPE html><!-- comment --><P>Hello</P>')
    await expect(fetchArticleText('https://example.com')).resolves.toBe('Hello')
  })

  it('tag stripping is linear time, not quadratic', async () => {
    // Build 300KB of pathological input: unterminated quotes cause O(n^2) in regex engines.
    // A linear scanner should process this in well under 2 seconds even on slow hardware.
    const malicious = '<a b="'.repeat(50000)
    allow(`<body><p>Before</p>${malicious}<p>After</p></body>`)
    const start = performance.now()
    const text = await fetchArticleText('https://example.com')
    const elapsed = performance.now() - start
    expect(text).toContain('Before')
    expect(elapsed).toBeLessThan(2000)
  })

  it('handles 300KB of bare < characters in linear time, not quadratic', async () => {
    // Bare '<' characters that never open a tag are exactly what could make the new
    // skip-past-false-starts loop quadratic if it rescanned from the same position instead of
    // advancing monotonically. Each '<' is followed by a space, so none of them open a tag.
    const malicious = '< '.repeat(150000)
    allow(`<body><p>Before</p>${malicious}<p>After</p></body>`)
    const start = performance.now()
    const text = await fetchArticleText('https://example.com')
    const elapsed = performance.now() - start
    expect(text).toContain('Before')
    expect(elapsed).toBeLessThan(2000)
  })
})
