import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}))

import { lookup } from 'node:dns/promises'
import { withSignal, isDisallowedHost, fetchAllowedUrl } from './safeFetch'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function response({ status = 200, location = null as string | null } = {}) {
  return {
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'location' ? location : null),
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(lookup).mockResolvedValue({ address: '93.184.216.34', family: 4 } as never)
})

describe('withSignal', () => {
  it('resolves with the promise value when the signal never aborts', async () => {
    const controller = new AbortController()
    await expect(withSignal(Promise.resolve('ok'), controller.signal)).resolves.toBe('ok')
  })

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort(new Error('already aborted'))
    await expect(withSignal(new Promise(() => {}), controller.signal)).rejects.toThrow(
      'already aborted'
    )
  })

  it('rejects when the signal aborts before the promise settles', async () => {
    const controller = new AbortController()
    const pending = withSignal(new Promise(() => {}), controller.signal)
    controller.abort(new Error('aborted later'))
    await expect(pending).rejects.toThrow('aborted later')
  })
})

describe('isDisallowedHost', () => {
  it('allows a public host', async () => {
    await expect(isDisallowedHost('example.com', AbortSignal.timeout(1000))).resolves.toBe(false)
  })

  it('blocks a hostname that resolves to a loopback address', async () => {
    vi.mocked(lookup).mockResolvedValue({ address: '127.0.0.1', family: 4 } as never)
    await expect(isDisallowedHost('evil.test', AbortSignal.timeout(1000))).resolves.toBe(true)
  })

  it('blocks a bracketed IPv6 loopback literal without doing a DNS lookup', async () => {
    await expect(isDisallowedHost('[::1]', AbortSignal.timeout(1000))).resolves.toBe(true)
    expect(lookup).not.toHaveBeenCalled()
  })

  it('blocks the host when DNS resolution fails', async () => {
    vi.mocked(lookup).mockRejectedValue(new Error('ENOTFOUND'))
    await expect(isDisallowedHost('nope.test', AbortSignal.timeout(1000))).resolves.toBe(true)
  })
})

describe('fetchAllowedUrl', () => {
  it('returns the response and the final URL for a direct 200', async () => {
    mockFetch.mockResolvedValue(response())
    const result = await fetchAllowedUrl('https://example.com/a', AbortSignal.timeout(1000))
    expect(result?.finalUrl).toBe('https://example.com/a')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/a',
      expect.objectContaining({ redirect: 'manual' })
    )
  })

  it('follows a redirect and reports the destination as the final URL', async () => {
    mockFetch
      .mockResolvedValueOnce(response({ status: 301, location: '/moved' }))
      .mockResolvedValueOnce(response())
    const result = await fetchAllowedUrl('https://example.com/a', AbortSignal.timeout(1000))
    expect(result?.finalUrl).toBe('https://example.com/moved')
  })

  it('returns null after more than three redirects', async () => {
    mockFetch.mockResolvedValue(response({ status: 302, location: '/next' }))
    const result = await fetchAllowedUrl('https://example.com/a', AbortSignal.timeout(1000))
    expect(result).toBeNull()
  })

  it('returns null when a redirect has no Location header', async () => {
    mockFetch.mockResolvedValue(response({ status: 302, location: null }))
    await expect(
      fetchAllowedUrl('https://example.com', AbortSignal.timeout(1000))
    ).resolves.toBeNull()
  })

  it('returns null for a non-http(s) protocol without fetching', async () => {
    await expect(
      fetchAllowedUrl('file:///etc/passwd', AbortSignal.timeout(1000))
    ).resolves.toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns null without fetching when the host is disallowed', async () => {
    vi.mocked(lookup).mockResolvedValue({ address: '10.0.0.5', family: 4 } as never)
    await expect(
      fetchAllowedUrl('https://internal.test', AbortSignal.timeout(1000))
    ).resolves.toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('re-checks the host after a redirect to a different origin', async () => {
    mockFetch.mockResolvedValueOnce(response({ status: 302, location: 'https://internal.test/x' }))
    vi.mocked(lookup)
      .mockResolvedValueOnce({ address: '93.184.216.34', family: 4 } as never)
      .mockResolvedValueOnce({ address: '169.254.169.254', family: 4 } as never)
    await expect(
      fetchAllowedUrl('https://example.com', AbortSignal.timeout(1000))
    ).resolves.toBeNull()
  })
})
