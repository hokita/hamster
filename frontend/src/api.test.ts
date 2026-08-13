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

describe('api.getBookmark', () => {
  it('fetches a single bookmark by id', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: '1',
        url: 'https://example.com',
        title: 'Example',
        summary: 'A summary.',
        createdAt: '2024-01-01',
      }),
    })
    const result = await api.getBookmark('1')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/bookmarks/1'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer fake-token' }),
      })
    )
    expect(result.summary).toBe('A summary.')
  })

  it('throws when the bookmark is not found', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 })
    await expect(api.getBookmark('nope')).rejects.toThrow('API error: 404')
  })
})

describe('api.generateSummary', () => {
  it('posts to the summary endpoint and returns the summary', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ summary: 'A summary.' }) })
    const result = await api.generateSummary('1')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/bookmarks/1/summary'),
      expect.objectContaining({ method: 'POST' })
    )
    expect(result.summary).toBe('A summary.')
  })

  it('throws when generation fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 502 })
    await expect(api.generateSummary('1')).rejects.toThrow('API error: 502')
  })
})
