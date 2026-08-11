import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}))

import { lookup } from 'node:dns/promises'
import { fetchMetadata, withSignal } from './metadataFetcher'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function mockResponse(
  chunks: string[],
  { contentType = 'text/html; charset=utf-8', status = 200 } = {}
) {
  const encoder = new TextEncoder()
  let index = 0
  return {
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null),
    },
    body: {
      getReader: () => ({
        read: async () => {
          if (index < chunks.length) {
            const value = encoder.encode(chunks[index])
            index += 1
            return { done: false, value }
          }
          return { done: true, value: undefined }
        },
        cancel: async () => {},
      }),
    },
  }
}

function mockResponseBytes(
  chunks: Uint8Array[],
  { contentType = 'text/html; charset=utf-8', status = 200 } = {}
) {
  let index = 0
  return {
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null),
    },
    body: {
      getReader: () => ({
        read: async () => {
          if (index < chunks.length) {
            const value = chunks[index]
            index += 1
            return { done: false, value }
          }
          return { done: true, value: undefined }
        },
        cancel: async () => {},
      }),
    },
  }
}

function mockRedirect(location: string, status = 302) {
  return {
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'location' ? location : null),
    },
    body: null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(lookup).mockResolvedValue({ address: '93.184.216.34', family: 4 } as never)
})

describe('fetchMetadata', () => {
  it('extracts and decodes the page title from a successful HTML response', async () => {
    mockFetch.mockResolvedValue(
      mockResponse(['<html><head><title>Tom &amp; Jerry</title></head></html>'])
    )
    const result = await fetchMetadata('https://example.com')
    expect(result.title).toBe('Tom & Jerry')
  })

  it('returns null when the response has no title tag', async () => {
    mockFetch.mockResolvedValue(mockResponse(['<html><head></head></html>']))
    const result = await fetchMetadata('https://example.com')
    expect(result.title).toBeNull()
  })

  it('returns null when the content type is not HTML', async () => {
    mockFetch.mockResolvedValue(mockResponse(['%PDF-1.4'], { contentType: 'application/pdf' }))
    const result = await fetchMetadata('https://example.com/file.pdf')
    expect(result.title).toBeNull()
  })

  it('returns null when the resolved host is a private/loopback/link-local address', async () => {
    vi.mocked(lookup).mockResolvedValue({ address: '127.0.0.1', family: 4 } as never)
    const result = await fetchMetadata('http://sneaky.example/')
    expect(result.title).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('stops reading once the size cap is exceeded across chunks, without finding a title', async () => {
    const padding = 'x'.repeat(100_001)
    mockFetch.mockResolvedValue(mockResponse([padding, '<title>Too Late</title>']))
    const result = await fetchMetadata('https://example.com')
    expect(result.title).toBeNull()
  })

  it('truncates a single chunk at the byte cap even when it straddles the boundary and contains a title past it', async () => {
    const padding = 'x'.repeat(100_000)
    const straddlingChunk = padding + '<title>Should Not Be Found</title>'
    mockFetch.mockResolvedValue(mockResponse([straddlingChunk]))
    const result = await fetchMetadata('https://example.com')
    expect(result.title).toBeNull()
  })

  it("decodes the title using the response's declared charset", async () => {
    const latin1Bytes = Buffer.from('<title>Caf\xe9</title>', 'latin1')
    mockFetch.mockResolvedValue(
      mockResponseBytes([latin1Bytes], { contentType: 'text/html; charset=iso-8859-1' })
    )
    const result = await fetchMetadata('https://example.com')
    expect(result.title).toBe('Café')
  })

  it('falls back to UTF-8 when the declared charset is unrecognized', async () => {
    mockFetch.mockResolvedValue(
      mockResponse(['<title>Fallback</title>'], { contentType: 'text/html; charset=bogus-charset' })
    )
    const result = await fetchMetadata('https://example.com')
    expect(result.title).toBe('Fallback')
  })

  it("decodes the title using an in-document <meta charset> when the HTTP header doesn't declare one", async () => {
    const html = '<html><head><meta charset="iso-8859-1"><title>Caf\xe9</title></head></html>'
    const latin1Bytes = Buffer.from(html, 'latin1')
    mockFetch.mockResolvedValue(mockResponseBytes([latin1Bytes], { contentType: 'text/html' }))
    const result = await fetchMetadata('https://example.com')
    expect(result.title).toBe('Café')
  })

  it('prefers the HTTP header charset over an in-document meta charset when both are present', async () => {
    // meta claims iso-8859-1, but the header (the real source of truth here) says utf-8;
    // encoding the title as genuine UTF-8 bytes proves the header's declaration wins,
    // since decoding UTF-8 bytes as iso-8859-1 would produce mojibake instead of 'Café'.
    const html = '<html><head><meta charset="iso-8859-1"><title>Café</title></head></html>'
    const utf8Bytes = new TextEncoder().encode(html)
    mockFetch.mockResolvedValue(
      mockResponseBytes([utf8Bytes], { contentType: 'text/html; charset=utf-8' })
    )
    const result = await fetchMetadata('https://example.com')
    expect(result.title).toBe('Café')
  })

  it('follows a redirect and extracts the title from the final response', async () => {
    mockFetch
      .mockResolvedValueOnce(mockRedirect('https://example.com/final'))
      .mockResolvedValueOnce(mockResponse(['<title>Final Page</title>']))
    const result = await fetchMetadata('https://example.com/redirect')
    expect(result.title).toBe('Final Page')
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockFetch).toHaveBeenNthCalledWith(2, 'https://example.com/final', expect.any(Object))
  })

  it('returns null when the redirect chain exceeds the hop cap', async () => {
    mockFetch
      .mockResolvedValueOnce(mockRedirect('https://example.com/1'))
      .mockResolvedValueOnce(mockRedirect('https://example.com/2'))
      .mockResolvedValueOnce(mockRedirect('https://example.com/3'))
      .mockResolvedValueOnce(mockRedirect('https://example.com/4'))
    const result = await fetchMetadata('https://example.com/start')
    expect(result.title).toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(4)
  })

  it('returns null when a redirect target resolves to a disallowed host', async () => {
    vi.mocked(lookup)
      .mockResolvedValueOnce({ address: '93.184.216.34', family: 4 } as never)
      .mockResolvedValueOnce({ address: '169.254.169.254', family: 4 } as never)
    mockFetch.mockResolvedValueOnce(mockRedirect('http://internal.example/metadata'))
    const result = await fetchMetadata('https://example.com/redirect')
    expect(result.title).toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('returns null when the request times out', async () => {
    mockFetch.mockRejectedValue(new DOMException('The operation was aborted.', 'TimeoutError'))
    const result = await fetchMetadata('https://example.com')
    expect(result.title).toBeNull()
  })

  it('returns null when fetch throws a network error', async () => {
    mockFetch.mockRejectedValue(new TypeError('fetch failed'))
    const result = await fetchMetadata('https://example.com')
    expect(result.title).toBeNull()
  })

  it('returns null when the URL is malformed (e.g. missing host)', async () => {
    const result = await fetchMetadata('https://')
    expect(result.title).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns null when reading the response body rejects mid-stream', async () => {
    mockFetch.mockResolvedValue({
      status: 200,
      headers: {
        get: (name: string) => (name.toLowerCase() === 'content-type' ? 'text/html' : null),
      },
      body: {
        getReader: () => ({
          read: async () => {
            throw new TypeError('terminated')
          },
          cancel: async () => {},
        }),
      },
    })
    const result = await fetchMetadata('https://example.com')
    expect(result.title).toBeNull()
  })

  it('rejects a redirect target that is not http(s)', async () => {
    mockFetch.mockResolvedValueOnce(mockRedirect('ftp://ftp.example.com/'))
    const result = await fetchMetadata('https://example.com/redirect')
    expect(result.title).toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('shares one timeout budget across all hops rather than resetting it per redirect', async () => {
    mockFetch.mockResolvedValueOnce(mockRedirect('https://example.com/final'))
    mockFetch.mockResolvedValueOnce(mockResponse(['<title>Final Page</title>']))
    await fetchMetadata('https://example.com/redirect')
    const firstSignal = mockFetch.mock.calls[0][1].signal
    const secondSignal = mockFetch.mock.calls[1][1].signal
    expect(firstSignal).toBe(secondSignal)
  })

  it('resolves a bracketed IPv6 literal host directly without a DNS lookup', async () => {
    mockFetch.mockResolvedValue(mockResponse(['<title>V6 Page</title>']))
    const result = await fetchMetadata('https://[2606:2800:220:1:248:1893:25c8:1946]/')
    expect(result.title).toBe('V6 Page')
    expect(lookup).not.toHaveBeenCalled()
  })

  it('rejects a bracketed IPv6 literal host that is disallowed, without a DNS lookup', async () => {
    const result = await fetchMetadata('https://[::1]/')
    expect(result.title).toBeNull()
    expect(lookup).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('defaults faviconUrl to /favicon.ico on the origin when the page declares no icon', async () => {
    mockFetch.mockResolvedValue(mockResponse(['<html><head><title>T</title></head></html>']))
    const result = await fetchMetadata('https://example.com/some/deep/page?q=1')
    expect(result.faviconUrl).toBe('https://example.com/favicon.ico')
  })

  it('still returns the origin favicon when the content type is not HTML', async () => {
    mockFetch.mockResolvedValue(mockResponse(['%PDF-1.4'], { contentType: 'application/pdf' }))
    const result = await fetchMetadata('https://example.com/file.pdf')
    expect(result.title).toBeNull()
    expect(result.faviconUrl).toBe('https://example.com/favicon.ico')
  })

  it('takes the origin favicon from the final URL after a redirect, not the original', async () => {
    mockFetch
      .mockResolvedValueOnce(mockRedirect('https://final.example.org/page'))
      .mockResolvedValueOnce(mockResponse(['<title>Final Page</title>']))
    const result = await fetchMetadata('https://short.example.com/abc')
    expect(result.faviconUrl).toBe('https://final.example.org/favicon.ico')
  })

  it('returns a null faviconUrl when the host is disallowed', async () => {
    vi.mocked(lookup).mockResolvedValue({ address: '127.0.0.1', family: 4 } as never)
    const result = await fetchMetadata('http://sneaky.example/')
    expect(result).toEqual({ title: null, faviconUrl: null })
  })

  it('returns a null faviconUrl when the fetch throws', async () => {
    mockFetch.mockRejectedValue(new TypeError('fetch failed'))
    const result = await fetchMetadata('https://example.com')
    expect(result).toEqual({ title: null, faviconUrl: null })
  })

  it('returns a null faviconUrl when the redirect chain exceeds the hop cap', async () => {
    mockFetch
      .mockResolvedValueOnce(mockRedirect('https://example.com/1'))
      .mockResolvedValueOnce(mockRedirect('https://example.com/2'))
      .mockResolvedValueOnce(mockRedirect('https://example.com/3'))
      .mockResolvedValueOnce(mockRedirect('https://example.com/4'))
    const result = await fetchMetadata('https://example.com/start')
    expect(result).toEqual({ title: null, faviconUrl: null })
  })

  it('finds an icon link that appears after the title', async () => {
    mockFetch.mockResolvedValue(
      mockResponse([
        '<html><head><title>T</title><link rel="icon" href="/i.png"></head><body></body></html>',
      ])
    )
    const result = await fetchMetadata('https://example.com')
    expect(result.title).toBe('T')
    expect(result.faviconUrl).toBe('https://example.com/i.png')
  })

  it('finds an icon link split across chunks after the title', async () => {
    mockFetch.mockResolvedValue(
      mockResponse([
        '<html><head><title>T</title>',
        '<link rel="icon" href="/late.png">',
        '</head><body></body></html>',
      ])
    )
    const result = await fetchMetadata('https://example.com')
    expect(result.faviconUrl).toBe('https://example.com/late.png')
  })

  it('resolves a relative icon href against the page URL', async () => {
    mockFetch.mockResolvedValue(
      mockResponse(['<head><link rel="icon" href="icons/fav.png"></head>'])
    )
    const result = await fetchMetadata('https://example.com/blog/post')
    expect(result.faviconUrl).toBe('https://example.com/blog/icons/fav.png')
  })

  it('keeps an absolute icon href on another origin', async () => {
    mockFetch.mockResolvedValue(
      mockResponse(['<head><link rel="icon" href="https://cdn.example.net/f.ico"></head>'])
    )
    const result = await fetchMetadata('https://example.com')
    expect(result.faviconUrl).toBe('https://cdn.example.net/f.ico')
  })

  it('accepts rel="shortcut icon"', async () => {
    mockFetch.mockResolvedValue(
      mockResponse(['<head><link rel="shortcut icon" href="/s.ico"></head>'])
    )
    const result = await fetchMetadata('https://example.com')
    expect(result.faviconUrl).toBe('https://example.com/s.ico')
  })

  it('accepts a link tag with href before rel', async () => {
    mockFetch.mockResolvedValue(mockResponse(["<head><link href='/order.ico' rel='icon'></head>"]))
    const result = await fetchMetadata('https://example.com')
    expect(result.faviconUrl).toBe('https://example.com/order.ico')
  })

  it('falls back to apple-touch-icon when no icon link is declared', async () => {
    mockFetch.mockResolvedValue(
      mockResponse(['<head><link rel="apple-touch-icon" href="/apple.png"></head>'])
    )
    const result = await fetchMetadata('https://example.com')
    expect(result.faviconUrl).toBe('https://example.com/apple.png')
  })

  it('prefers a plain icon link over an apple-touch-icon declared earlier', async () => {
    mockFetch.mockResolvedValue(
      mockResponse([
        '<head><link rel="apple-touch-icon" href="/apple.png"><link rel="icon" href="/real.ico"></head>',
      ])
    )
    const result = await fetchMetadata('https://example.com')
    expect(result.faviconUrl).toBe('https://example.com/real.ico')
  })

  it('decodes HTML entities in the icon href', async () => {
    mockFetch.mockResolvedValue(
      mockResponse(['<head><link rel="icon" href="/i.ico?a=1&amp;b=2"></head>'])
    )
    const result = await fetchMetadata('https://example.com')
    expect(result.faviconUrl).toBe('https://example.com/i.ico?a=1&b=2')
  })

  it('decodes a decimal numeric character reference in the icon href', async () => {
    // Regression (Codex round 4, Finding B): "&#47;" must decode to "/" like a browser would,
    // otherwise new URL() misparses the literal "&" and "#" as query/fragment syntax.
    mockFetch.mockResolvedValue(
      mockResponse(['<head><link rel="icon" href="&#47;favicon-num.ico"></head>'])
    )
    const result = await fetchMetadata('https://example.com')
    expect(result.faviconUrl).toBe('https://example.com/favicon-num.ico')
  })

  it('decodes a hexadecimal numeric character reference in the icon href', async () => {
    mockFetch.mockResolvedValue(
      mockResponse(['<head><link rel="icon" href="&#x2F;favicon-hex.ico"></head>'])
    )
    const result = await fetchMetadata('https://example.com')
    expect(result.faviconUrl).toBe('https://example.com/favicon-hex.ico')
  })

  it('decodes a numeric character reference in the icon href even without a trailing semicolon', async () => {
    mockFetch.mockResolvedValue(
      mockResponse(['<head><link rel="icon" href="&#47icon-no-semi.ico"></head>'])
    )
    const result = await fetchMetadata('https://example.com')
    expect(result.faviconUrl).toBe('https://example.com/icon-no-semi.ico')
  })

  it('ignores a javascript: icon href and uses the origin default', async () => {
    mockFetch.mockResolvedValue(
      mockResponse(['<head><link rel="icon" href="javascript:alert(1)"></head>'])
    )
    const result = await fetchMetadata('https://example.com')
    expect(result.faviconUrl).toBe('https://example.com/favicon.ico')
  })

  it('ignores a data: icon href and uses the origin default', async () => {
    mockFetch.mockResolvedValue(
      mockResponse(['<head><link rel="icon" href="data:image/png;base64,AAAA"></head>'])
    )
    const result = await fetchMetadata('https://example.com')
    expect(result.faviconUrl).toBe('https://example.com/favicon.ico')
  })

  it('ignores a stylesheet link and uses the origin default', async () => {
    mockFetch.mockResolvedValue(
      mockResponse(['<head><link rel="stylesheet" href="/app.css"></head>'])
    )
    const result = await fetchMetadata('https://example.com')
    expect(result.faviconUrl).toBe('https://example.com/favicon.ico')
  })

  it('uses the declared icon from the final page after a redirect', async () => {
    mockFetch
      .mockResolvedValueOnce(mockRedirect('https://final.example.org/page'))
      .mockResolvedValueOnce(mockResponse(['<head><link rel="icon" href="/f.png"></head>']))
    const result = await fetchMetadata('https://short.example.com/abc')
    expect(result.faviconUrl).toBe('https://final.example.org/f.png')
  })

  it('falls back to the origin favicon when the declared icon href resolves to a disallowed host', async () => {
    vi.mocked(lookup)
      .mockResolvedValueOnce({ address: '93.184.216.34', family: 4 } as never) // page host
      .mockResolvedValueOnce({ address: '169.254.169.254', family: 4 } as never) // icon host
    mockFetch.mockResolvedValue(
      mockResponse(['<head><link rel="icon" href="http://internal.example/meta"></head>'])
    )
    const result = await fetchMetadata('https://example.com')
    expect(result.faviconUrl).toBe('https://example.com/favicon.ico')
  })

  it('still uses a declared icon on a different but public host after the SSRF guard check', async () => {
    vi.mocked(lookup)
      .mockResolvedValueOnce({ address: '93.184.216.34', family: 4 } as never) // page host
      .mockResolvedValueOnce({ address: '151.101.1.140', family: 4 } as never) // public CDN host
    mockFetch.mockResolvedValue(
      mockResponse(['<head><link rel="icon" href="https://cdn.example.net/f.ico"></head>'])
    )
    const result = await fetchMetadata('https://example.com')
    expect(result.faviconUrl).toBe('https://cdn.example.net/f.ico')
  })

  it('does not treat <body> written inside a script string as the end of head, still finding the title and icon', async () => {
    mockFetch.mockResolvedValue(
      mockResponse([
        '<head>\n  <script>document.write("<body class=x>");</script>\n',
        '  <title>Example Site</title>\n  <link rel="icon" href="/real-favicon.png">\n</head>',
      ])
    )
    const result = await fetchMetadata('https://example.com')
    expect(result.title).toBe('Example Site')
    expect(result.faviconUrl).toBe('https://example.com/real-favicon.png')
  })

  it('does not treat </head> or <body inside an HTML comment as the end of head', async () => {
    mockFetch.mockResolvedValue(
      mockResponse([
        '<head><!-- </head> <body> fake --><title>T</title>',
        '<link rel="icon" href="/x.ico"></head>',
      ])
    )
    const result = await fetchMetadata('https://example.com')
    expect(result.title).toBe('T')
    expect(result.faviconUrl).toBe('https://example.com/x.ico')
  })

  it('still exits the read loop early at a real </head> without reading further chunks', async () => {
    let readCalls = 0
    const chunks = ['<head><title>T</title></head>', '<link rel="icon" href="/late.ico">']
    const encoder = new TextEncoder()
    mockFetch.mockResolvedValue({
      status: 200,
      headers: {
        get: (name: string) => (name.toLowerCase() === 'content-type' ? 'text/html' : null),
      },
      body: {
        getReader: () => ({
          read: async () => {
            readCalls += 1
            if (readCalls > chunks.length) throw new Error('should not read past </head>')
            const value = encoder.encode(chunks[readCalls - 1])
            return { done: false, value }
          },
          cancel: async () => {},
        }),
      },
    })
    const result = await fetchMetadata('https://example.com')
    expect(result.title).toBe('T')
    expect(readCalls).toBe(1)
  })

  it('does not treat "</script-x>" as closing the script element, still finding a later title and icon', async () => {
    // Regression (Codex round 4, Finding A): only whitespace, '/', or '>' may delimit a raw-text
    // end tag per the HTML spec. A '-' (or any other non-word character) must NOT be accepted as a
    // delimiter, so this literal "</script-x><body>" text inside the script element's content must
    // not be mistaken for the element's real close tag. The real </title>/<link> arrive in the next
    // chunk, after the genuine </script>; if the scanner wrongly exits early, they're never read.
    mockFetch.mockResolvedValue(
      mockResponse([
        '<head><script>var x = "</script-x><body>";',
        '</script><title>Real Title</title><link rel="icon" href="/real-favicon.png"></head>',
      ])
    )
    const result = await fetchMetadata('https://example.com')
    expect(result.title).toBe('Real Title')
    expect(result.faviconUrl).toBe('https://example.com/real-favicon.png')
  })

  it('does not let a fake <link rel="icon"> inside an inline script win over the real icon that follows', async () => {
    mockFetch.mockResolvedValue(
      mockResponse([
        '<head><script>var tpl = \'<link rel="icon" href="https://evil.example/beacon?id=1">\';</script>\n' +
          '<link rel="icon" href="/real.png"></head>',
      ])
    )
    const result = await fetchMetadata('https://example.com')
    expect(result.faviconUrl).toBe('https://example.com/real.png')
  })

  it('does not let a <link rel="icon"> inside an HTML comment win over the real icon that follows', async () => {
    mockFetch.mockResolvedValue(
      mockResponse([
        '<head><!-- <link rel="icon" href="https://evil.example/beacon"> -->' +
          '<link rel="icon" href="/real.png"></head>',
      ])
    )
    const result = await fetchMetadata('https://example.com')
    expect(result.faviconUrl).toBe('https://example.com/real.png')
  })

  it('does not treat </head> or <body written inside a double-quoted attribute value as the end of head', async () => {
    // Regression: a legitimate quoted attribute (e.g. a page documenting HTML) containing the
    // literal text "<body" must not be mistaken for a real end-of-head marker. The split across
    // chunks matters: chunk 1 ends mid-head, right after the offending quoted text, so the old
    // buggy check (which ran on every chunk) would fire before the title/icon ever arrived.
    mockFetch.mockResolvedValue(
      mockResponse([
        '<head><meta name="description" content="All about the <body tag">',
        '<title>HTML Guide</title><link rel="icon" href="/real.png"></head>',
      ])
    )
    const result = await fetchMetadata('https://example.com')
    expect(result.title).toBe('HTML Guide')
    expect(result.faviconUrl).toBe('https://example.com/real.png')
  })

  it('does not treat </head> or <body written inside a single-quoted attribute value as the end of head', async () => {
    mockFetch.mockResolvedValue(
      mockResponse([
        "<head><meta name='description' content='All about the <body tag'>",
        '<title>HTML Guide</title><link rel="icon" href="/real.png"></head>',
      ])
    )
    const result = await fetchMetadata('https://example.com')
    expect(result.title).toBe('HTML Guide')
    expect(result.faviconUrl).toBe('https://example.com/real.png')
  })

  it('does not hang or read past the byte cap when a quoted attribute value is never terminated', async () => {
    // An attribute value that opens a quote and never closes it must not let the head-end scanner
    // get stuck, and MAX_BYTES must still be the thing that stops the read.
    const padding = 'x'.repeat(100_000)
    mockFetch.mockResolvedValue(
      mockResponse([`<head><meta content="${padding}`, '<title>Should Not Be Found</title>'])
    )
    const result = await fetchMetadata('https://example.com')
    expect(result.title).toBeNull()
  })

  it('still extracts a real, unmasked icon link on a normal page (guard against over-masking)', async () => {
    mockFetch.mockResolvedValue(
      mockResponse(['<head><title>T</title><link rel="icon" href="/plain.ico"></head>'])
    )
    const result = await fetchMetadata('https://example.com')
    expect(result.faviconUrl).toBe('https://example.com/plain.ico')
  })

  it('resolves a relative icon href against a declared <base href>', async () => {
    mockFetch.mockResolvedValue(
      mockResponse([
        '<head><base href="https://cdn.example/assets/"><link rel="icon" href="icon.png"></head>',
      ])
    )
    const result = await fetchMetadata('https://example.com/blog/post')
    expect(result.faviconUrl).toBe('https://cdn.example/assets/icon.png')
  })

  it('resolves a relative <base href> against the page URL first, then the icon against that', async () => {
    mockFetch.mockResolvedValue(
      mockResponse(['<head><base href="/assets/"><link rel="icon" href="icon.png"></head>'])
    )
    const result = await fetchMetadata('https://example.com/blog/post')
    expect(result.faviconUrl).toBe('https://example.com/assets/icon.png')
  })

  it('resolves the icon against the page URL as before when there is no <base> tag', async () => {
    mockFetch.mockResolvedValue(mockResponse(['<head><link rel="icon" href="icon.png"></head>']))
    const result = await fetchMetadata('https://example.com/blog/post')
    expect(result.faviconUrl).toBe('https://example.com/blog/icon.png')
  })

  it('leaves an absolute icon href unaffected by a declared <base href>', async () => {
    mockFetch.mockResolvedValue(
      mockResponse([
        '<head><base href="https://cdn.example/assets/">' +
          '<link rel="icon" href="https://other.example/icon.png"></head>',
      ])
    )
    const result = await fetchMetadata('https://example.com')
    expect(result.faviconUrl).toBe('https://other.example/icon.png')
  })

  it('only honors the first <base href> when two are present', async () => {
    mockFetch.mockResolvedValue(
      mockResponse([
        '<head><base href="https://first.example/"><base href="https://second.example/">' +
          '<link rel="icon" href="icon.png"></head>',
      ])
    )
    const result = await fetchMetadata('https://example.com')
    expect(result.faviconUrl).toBe('https://first.example/icon.png')
  })

  it('skips a <base> element without an href and uses the next one that has one', async () => {
    // Regression (Codex round 4, Finding C): per spec the effective base is the first <base>
    // element that HAS an href, not simply the first <base> element.
    mockFetch.mockResolvedValue(
      mockResponse([
        '<head><base target="_blank"><base href="https://cdn.example/assets/">' +
          '<link rel="icon" href="icon.png"></head>',
      ])
    )
    const result = await fetchMetadata('https://example.com')
    expect(result.faviconUrl).toBe('https://cdn.example/assets/icon.png')
  })

  it('does not let a <base href> written inside a script string affect icon resolution', async () => {
    mockFetch.mockResolvedValue(
      mockResponse([
        '<head><script>var tpl = \'<base href="https://evil.example/">\';</script>' +
          '<link rel="icon" href="icon.png"></head>',
      ])
    )
    const result = await fetchMetadata('https://example.com/blog/post')
    expect(result.faviconUrl).toBe('https://example.com/blog/icon.png')
  })

  it('falls back to the origin favicon when a declared <base href> points at a private host', async () => {
    mockFetch.mockResolvedValue(
      mockResponse([
        '<head><base href="http://169.254.169.254/"><link rel="icon" href="icon.png"></head>',
      ])
    )
    const result = await fetchMetadata('https://example.com')
    expect(result.faviconUrl).toBe('https://example.com/favicon.ico')
  })

  it('withSignal rejects as soon as the signal aborts, even if the wrapped promise never settles', async () => {
    // isDisallowedHost races dns.lookup() against fetchMetadata's shared deadline via this
    // helper, so a hanging DNS resolution can no longer stall past the deadline. Node's
    // AbortSignal.timeout() isn't fake-timer-controllable, so this is tested directly
    // against an AbortController instead of waiting out a real 5s deadline end-to-end.
    const controller = new AbortController()
    const hanging = new Promise<never>(() => {})
    const resultPromise = withSignal(hanging, controller.signal)
    controller.abort(new Error('boom'))
    await expect(resultPromise).rejects.toThrow('boom')
  })
})
