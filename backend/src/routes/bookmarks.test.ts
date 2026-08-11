import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../services/firestore', () => ({
  listBookmarks: vi.fn(),
  createBookmark: vi.fn(),
}))
vi.mock('../services/metadataFetcher', () => ({
  fetchMetadata: vi.fn(),
}))

import { createBookmarksRouter } from './bookmarks'
import * as db from '../services/firestore'
import { fetchMetadata } from '../services/metadataFetcher'

const app = express()
app.use(express.json())
app.use('/api/bookmarks', createBookmarksRouter())

describe('GET /api/bookmarks', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the list of bookmarks', async () => {
    vi.mocked(db.listBookmarks).mockResolvedValue([
      {
        id: '1',
        url: 'https://example.com',
        title: 'Example',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ])
    const res = await request(app).get('/api/bookmarks')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].title).toBe('Example')
  })

  it('returns 500 when listBookmarks rejects', async () => {
    vi.mocked(db.listBookmarks).mockRejectedValue(new Error('firestore down'))
    const res = await request(app).get('/api/bookmarks')
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: expect.any(String) })
  })
})

describe('POST /api/bookmarks', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a bookmark using the fetched title', async () => {
    vi.mocked(fetchMetadata).mockResolvedValue({ title: 'Example', faviconUrl: null })
    vi.mocked(db.createBookmark).mockResolvedValue({
      id: '1',
      url: 'https://example.com',
      title: 'Example',
      createdAt: '2024-01-01T00:00:00.000Z',
    })
    const res = await request(app).post('/api/bookmarks').send({ url: 'https://example.com' })
    expect(res.status).toBe(201)
    expect(fetchMetadata).toHaveBeenCalledWith('https://example.com')
    expect(db.createBookmark).toHaveBeenCalledWith('https://example.com', 'Example', null)
    expect(res.body.title).toBe('Example')
  })

  it('falls back to the URL as the title when fetchMetadata returns a null title', async () => {
    vi.mocked(fetchMetadata).mockResolvedValue({ title: null, faviconUrl: null })
    vi.mocked(db.createBookmark).mockResolvedValue({
      id: '1',
      url: 'https://example.com',
      title: 'https://example.com',
      createdAt: '2024-01-01T00:00:00.000Z',
    })
    const res = await request(app).post('/api/bookmarks').send({ url: 'https://example.com' })
    expect(res.status).toBe(201)
    expect(db.createBookmark).toHaveBeenCalledWith(
      'https://example.com',
      'https://example.com',
      null
    )
  })

  it('returns 400 when the request body is null', async () => {
    const res = await request(app)
      .post('/api/bookmarks')
      .set('Content-Type', 'application/json')
      .send('null')
    expect(res.status).toBe(400)
    expect(db.createBookmark).not.toHaveBeenCalled()
  })

  it('returns 400 when url is missing', async () => {
    const res = await request(app).post('/api/bookmarks').send({})
    expect(res.status).toBe(400)
    expect(db.createBookmark).not.toHaveBeenCalled()
  })

  it('returns 400 when url is not a string', async () => {
    const res = await request(app)
      .post('/api/bookmarks')
      .send({ url: { a: 1 } })
    expect(res.status).toBe(400)
    expect(db.createBookmark).not.toHaveBeenCalled()
  })

  it('returns 400 when url is not an http(s) URL', async () => {
    const res = await request(app).post('/api/bookmarks').send({ url: 'javascript:alert(1)' })
    expect(res.status).toBe(400)
    expect(db.createBookmark).not.toHaveBeenCalled()
  })

  it('returns 500 when createBookmark rejects', async () => {
    vi.mocked(fetchMetadata).mockResolvedValue({ title: 'Example', faviconUrl: null })
    vi.mocked(db.createBookmark).mockRejectedValue(new Error('firestore down'))
    const res = await request(app).post('/api/bookmarks').send({ url: 'https://example.com' })
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: expect.any(String) })
  })

  it('passes the fetched faviconUrl through to createBookmark', async () => {
    vi.mocked(fetchMetadata).mockResolvedValue({
      title: 'Example',
      faviconUrl: 'https://example.com/f.ico',
    })
    vi.mocked(db.createBookmark).mockResolvedValue({
      id: '1',
      url: 'https://example.com',
      title: 'Example',
      faviconUrl: 'https://example.com/f.ico',
      createdAt: '2024-01-01T00:00:00.000Z',
    })

    const res = await request(app).post('/api/bookmarks').send({ url: 'https://example.com' })

    expect(res.status).toBe(201)
    expect(db.createBookmark).toHaveBeenCalledWith(
      'https://example.com',
      'Example',
      'https://example.com/f.ico'
    )
    expect(res.body.faviconUrl).toBe('https://example.com/f.ico')
  })
})
