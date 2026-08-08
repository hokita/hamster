import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../services/firestore', () => ({
  listBookmarks: vi.fn(),
  createBookmark: vi.fn(),
}))

import { createBookmarksRouter } from './bookmarks'
import * as db from '../services/firestore'

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

  it('creates a bookmark and returns it', async () => {
    vi.mocked(db.createBookmark).mockResolvedValue({
      id: '1',
      url: 'https://example.com',
      title: 'Example',
      createdAt: '2024-01-01T00:00:00.000Z',
    })
    const res = await request(app)
      .post('/api/bookmarks')
      .send({ url: 'https://example.com', title: 'Example' })
    expect(res.status).toBe(201)
    expect(db.createBookmark).toHaveBeenCalledWith('https://example.com', 'Example')
    expect(res.body.title).toBe('Example')
  })

  it('returns 400 when url is missing', async () => {
    const res = await request(app).post('/api/bookmarks').send({ title: 'Example' })
    expect(res.status).toBe(400)
    expect(db.createBookmark).not.toHaveBeenCalled()
  })

  it('returns 400 when title is missing', async () => {
    const res = await request(app).post('/api/bookmarks').send({ url: 'https://example.com' })
    expect(res.status).toBe(400)
    expect(db.createBookmark).not.toHaveBeenCalled()
  })

  it('returns 500 when createBookmark rejects', async () => {
    vi.mocked(db.createBookmark).mockRejectedValue(new Error('firestore down'))
    const res = await request(app)
      .post('/api/bookmarks')
      .send({ url: 'https://example.com', title: 'Example' })
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: expect.any(String) })
  })
})
