import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}))

import { lookup } from 'node:dns/promises'
import { fetchTitle } from './titleFetcher'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function mockResponse(body: string, contentType = 'text/html; charset=utf-8') {
  return {
    status: 200,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null),
    },
    text: async () => body,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(lookup).mockResolvedValue({ address: '93.184.216.34', family: 4 } as never)
})

describe('fetchTitle', () => {
  it('extracts and decodes the page title from a successful HTML response', async () => {
    mockFetch.mockResolvedValue(
      mockResponse('<html><head><title>Tom &amp; Jerry</title></head></html>')
    )
    const result = await fetchTitle('https://example.com')
    expect(result).toBe('Tom & Jerry')
  })

  it('returns null when the response has no title tag', async () => {
    mockFetch.mockResolvedValue(mockResponse('<html><head></head></html>'))
    const result = await fetchTitle('https://example.com')
    expect(result).toBeNull()
  })

  it('returns null when the content type is not HTML', async () => {
    mockFetch.mockResolvedValue(mockResponse('%PDF-1.4', 'application/pdf'))
    const result = await fetchTitle('https://example.com/file.pdf')
    expect(result).toBeNull()
  })

  it('returns null when the resolved host is a private/loopback/link-local address', async () => {
    vi.mocked(lookup).mockResolvedValue({ address: '127.0.0.1', family: 4 } as never)
    const result = await fetchTitle('http://sneaky.example/')
    expect(result).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
