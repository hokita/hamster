import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}))

import { lookup } from 'node:dns/promises'
import { fetchTitle } from './titleFetcher'

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

describe('fetchTitle', () => {
  it('extracts and decodes the page title from a successful HTML response', async () => {
    mockFetch.mockResolvedValue(
      mockResponse(['<html><head><title>Tom &amp; Jerry</title></head></html>'])
    )
    const result = await fetchTitle('https://example.com')
    expect(result).toBe('Tom & Jerry')
  })

  it('returns null when the response has no title tag', async () => {
    mockFetch.mockResolvedValue(mockResponse(['<html><head></head></html>']))
    const result = await fetchTitle('https://example.com')
    expect(result).toBeNull()
  })

  it('returns null when the content type is not HTML', async () => {
    mockFetch.mockResolvedValue(mockResponse(['%PDF-1.4'], { contentType: 'application/pdf' }))
    const result = await fetchTitle('https://example.com/file.pdf')
    expect(result).toBeNull()
  })

  it('returns null when the resolved host is a private/loopback/link-local address', async () => {
    vi.mocked(lookup).mockResolvedValue({ address: '127.0.0.1', family: 4 } as never)
    const result = await fetchTitle('http://sneaky.example/')
    expect(result).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('stops reading once the body exceeds the size cap without finding a title', async () => {
    const padding = 'x'.repeat(100_001)
    mockFetch.mockResolvedValue(mockResponse([padding, '<title>Too Late</title>']))
    const result = await fetchTitle('https://example.com')
    expect(result).toBeNull()
  })

  it('follows a redirect and extracts the title from the final response', async () => {
    mockFetch
      .mockResolvedValueOnce(mockRedirect('https://example.com/final'))
      .mockResolvedValueOnce(mockResponse(['<title>Final Page</title>']))
    const result = await fetchTitle('https://example.com/redirect')
    expect(result).toBe('Final Page')
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockFetch).toHaveBeenNthCalledWith(2, 'https://example.com/final', expect.any(Object))
  })

  it('returns null when the redirect chain exceeds the hop cap', async () => {
    mockFetch
      .mockResolvedValueOnce(mockRedirect('https://example.com/1'))
      .mockResolvedValueOnce(mockRedirect('https://example.com/2'))
      .mockResolvedValueOnce(mockRedirect('https://example.com/3'))
      .mockResolvedValueOnce(mockRedirect('https://example.com/4'))
    const result = await fetchTitle('https://example.com/start')
    expect(result).toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(4)
  })

  it('returns null when a redirect target resolves to a disallowed host', async () => {
    vi.mocked(lookup)
      .mockResolvedValueOnce({ address: '93.184.216.34', family: 4 } as never)
      .mockResolvedValueOnce({ address: '169.254.169.254', family: 4 } as never)
    mockFetch.mockResolvedValueOnce(mockRedirect('http://internal.example/metadata'))
    const result = await fetchTitle('https://example.com/redirect')
    expect(result).toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('returns null when the request times out', async () => {
    mockFetch.mockRejectedValue(new DOMException('The operation was aborted.', 'TimeoutError'))
    const result = await fetchTitle('https://example.com')
    expect(result).toBeNull()
  })

  it('returns null when fetch throws a network error', async () => {
    mockFetch.mockRejectedValue(new TypeError('fetch failed'))
    const result = await fetchTitle('https://example.com')
    expect(result).toBeNull()
  })

  it('returns null when the URL is malformed (e.g. missing host)', async () => {
    const result = await fetchTitle('https://')
    expect(result).toBeNull()
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
    const result = await fetchTitle('https://example.com')
    expect(result).toBeNull()
  })

  it('rejects a redirect target that is not http(s)', async () => {
    mockFetch.mockResolvedValueOnce(mockRedirect('ftp://ftp.example.com/'))
    const result = await fetchTitle('https://example.com/redirect')
    expect(result).toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('shares one timeout budget across all hops rather than resetting it per redirect', async () => {
    mockFetch.mockResolvedValueOnce(mockRedirect('https://example.com/final'))
    mockFetch.mockResolvedValueOnce(mockResponse(['<title>Final Page</title>']))
    await fetchTitle('https://example.com/redirect')
    const firstSignal = mockFetch.mock.calls[0][1].signal
    const secondSignal = mockFetch.mock.calls[1][1].signal
    expect(firstSignal).toBe(secondSignal)
  })
})
