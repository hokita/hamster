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
      cancel: vi.fn(async () => {}),
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
  it('cancels the body of a rejected article response', async () => {
    const response = htmlResponse('<p>Forbidden</p>', undefined, 403)
    vi.mocked(fetchAllowedUrl).mockResolvedValue({
      response: response as unknown as Response,
      finalUrl: 'https://example.com',
    })
    await expect(fetchArticleText('https://example.com')).resolves.toBeNull()
    expect(response.body.cancel).toHaveBeenCalledTimes(1)
  })

  it('falls back to the matching Medium RSS article when the page is blocked', async () => {
    const url = 'https://copyconstruct.medium.com/article-bd3dcb2c5f7b'
    vi.mocked(fetchAllowedUrl)
      .mockResolvedValueOnce({ response: new Response('Blocked', { status: 403 }), finalUrl: url })
      .mockResolvedValueOnce({
        response: new Response(
          `<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item><title>Article</title><link>${url}</link><content:encoded><![CDATA[<p>The article &amp; its conclusion.</p><script>hidden</script>]]></content:encoded></item></channel></rss>`
        ),
        finalUrl: 'https://copyconstruct.medium.com/feed',
      })
    await expect(fetchArticleText(url)).resolves.toBe('The article & its conclusion.')
  })

  it('does not request RSS when the original Medium article is readable', async () => {
    allow('<p>Original content</p>')
    await expect(
      fetchArticleText('https://copyconstruct.medium.com/article-bd3dcb2c5f7b')
    ).resolves.toBe('Original content')
    expect(fetchAllowedUrl).toHaveBeenCalledTimes(1)
  })

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
    allow("<div title='a > b'>Text</div>")
    await expect(fetchArticleText('https://example.com')).resolves.toBe('Text')
  })

  it('does not let an apostrophe in later prose close a single-quoted attribute early', async () => {
    allow("<div title='it's a test'>IMPORTANT TEXT HERE, don't miss this</div><p>foo</p>")
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
    expect(text).toBe('Normal middle text More article content here Final para')
  })

  it('keeps the quote-aware prefix parse when a page is truncated mid-tag', async () => {
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
    const malicious = '<a b="'.repeat(50000)
    allow(`<body><p>Before</p>${malicious}<p>After</p></body>`)
    const start = performance.now()
    const text = await fetchArticleText('https://example.com')
    const elapsed = performance.now() - start
    expect(text).toContain('Before')
    expect(elapsed).toBeLessThan(2000)
  })

  it('handles 300KB of bare < characters in linear time, not quadratic', async () => {
    const malicious = '< '.repeat(150000)
    allow(`<body><p>Before</p>${malicious}<p>After</p></body>`)
    const start = performance.now()
    const text = await fetchArticleText('https://example.com')
    const elapsed = performance.now() - start
    expect(text).toContain('Before')
    expect(elapsed).toBeLessThan(2000)
  })
})
