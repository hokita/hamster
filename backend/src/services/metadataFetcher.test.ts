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

  it('withSignal rejects as soon as the signal aborts, even if the wrapped promise never settles', async () => {
    // isDisallowedHost races dns.lookup() against fetchTitle's shared deadline via this
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
