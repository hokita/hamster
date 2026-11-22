import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./firebase', () => ({
  auth: { currentUser: { getIdToken: vi.fn().mockResolvedValue('fake-token') } },
}))

import { api, ApiError } from './api'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const emptyBody = async () => {
  throw new SyntaxError('Unexpected end of JSON input')
}

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
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: emptyBody })
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
    mockFetch.mockResolvedValue({ ok: false, status: 404, json: emptyBody })
    await expect(api.getBookmark('nope')).rejects.toThrow('API error: 404')
  })
})

describe('api.deleteBookmark', () => {
  it('sends a DELETE for the bookmark', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 204 })

    await api.deleteBookmark('1')

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/bookmarks/1'),
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({ Authorization: 'Bearer fake-token' }),
      })
    )
  })

  it('resolves on a 204 without trying to parse a body', async () => {
    // The backend answers 204 with nothing at all; calling json() on that response rejects, which
    // would surface a successful delete as a failure. The mock has no json() on purpose — the
    // request helper must not reach for one.
    mockFetch.mockResolvedValue({ ok: true, status: 204 })

    await expect(api.deleteBookmark('1')).resolves.toBeUndefined()
  })

  it('throws when the delete fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: emptyBody })
    await expect(api.deleteBookmark('1')).rejects.toThrow('API error: 500')
  })
})

describe('api.askQuestion', () => {
  it('posts the conversation to the chat endpoint and returns the answer', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ answer: 'The article says X.' }) })
    const messages = [{ role: 'user' as const, text: 'What does it say?' }]
    const result = await api.askQuestion('1', messages)
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/bookmarks/1/chat'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ messages }),
      })
    )
    expect(result.answer).toBe('The article says X.')
  })

  it('throws when answering fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 502, json: emptyBody })
    await expect(
      api.askQuestion('1', [{ role: 'user', text: 'Question?' }])
    ).rejects.toThrow('API error: 502')
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
    mockFetch.mockResolvedValue({ ok: false, status: 502, json: emptyBody })
    await expect(api.generateSummary('1')).rejects.toThrow('API error: 502')
  })

  it('carries the status and machine-readable code from the error body', async () => {
    // The bookmark page picks its message from the code; the `error` text stays vague on purpose.
    mockFetch.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: 'Video summary refused', code: 'video_too_long' }),
    })
    const error = await api.generateSummary('1').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 422, code: 'video_too_long' })
    expect((error as ApiError).message).toBe('API error: 422')
  })

  it('throws an ApiError with no code when the error body is not JSON', async () => {
    // A proxy or Cloud Run itself can answer with an HTML page; that must still surface as the
    // status, not as a JSON parse error.
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError('Unexpected token <')
      },
    })
    const error = await api.generateSummary('1').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 502, message: 'API error: 502' })
    expect((error as ApiError).code).toBeUndefined()
  })
})

describe('api.translateSummary', () => {
  it('posts to the translation endpoint and returns the translation', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ translation: '概要。' }) })
    const result = await api.translateSummary('1')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/bookmarks/1/translation'),
      expect.objectContaining({ method: 'POST' })
    )
    expect(result.translation).toBe('概要。')
  })

  it('sends no body: the backend translates the summary it has stored', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ translation: '概要。' }) })
    await api.translateSummary('1')
    expect(mockFetch.mock.calls[0][1].body).toBeUndefined()
  })

  it('throws when the translation fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 502, json: emptyBody })
    await expect(api.translateSummary('1')).rejects.toThrow('API error: 502')
  })
})

describe('api.setReadState', () => {
  it('puts the desired state and resolves on a 204 with no body', async () => {
    // A 204 carries nothing to parse; res.json() on an empty body would reject and turn a
    // successful write into a thrown error at the call site.
    mockFetch.mockResolvedValue({ ok: true, status: 204 })

    await expect(api.setReadState('1', true)).resolves.toBeUndefined()

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/bookmarks/1/read'),
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ isRead: true }) })
    )
  })

  it('sends the state to store rather than a bare toggle', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 204 })

    await api.setReadState('1', false)

    expect(mockFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ body: JSON.stringify({ isRead: false }) })
    )
  })

  it('throws when the response is not ok', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404, json: emptyBody })

    await expect(api.setReadState('gone', true)).rejects.toThrow('API error: 404')
  })
})
