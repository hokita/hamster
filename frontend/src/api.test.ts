import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./firebase', () => ({
  auth: { currentUser: { getIdToken: vi.fn().mockResolvedValue('fake-token') } },
}))

import { api } from './api'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

beforeEach(() => {
  mockFetch.mockReset()
})

describe('api.listBookmarks', () => {
  it('fetches bookmarks with an auth header', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [
        { id: '1', url: 'https://example.com', title: 'Example', createdAt: '2024-01-01' },
      ],
    })
    const result = await api.listBookmarks()
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/bookmarks'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer fake-token' }),
      })
    )
    expect(result).toHaveLength(1)
  })

  it('throws when the response is not ok', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 })
    await expect(api.listBookmarks()).rejects.toThrow('API error: 500')
  })
})

describe('api.createBookmark', () => {
  it('posts the bookmark and returns the created record', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: '1',
        url: 'https://example.com',
        title: 'Example',
        createdAt: '2024-01-01',
      }),
    })
    const result = await api.createBookmark({ url: 'https://example.com' })
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/bookmarks'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ url: 'https://example.com' }),
      })
    )
    expect(result.title).toBe('Example')
  })
})
