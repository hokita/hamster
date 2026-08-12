import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../services/firestore', () => ({
  listBookmarks: vi.fn(),
  createBookmark: vi.fn(),
  getBookmark: vi.fn(),
  updateSummary: vi.fn(),
}))
vi.mock('../services/metadataFetcher', () => ({
  fetchMetadata: vi.fn(),
}))
vi.mock('../services/articleFetcher', () => ({
  fetchArticleText: vi.fn(),
}))
vi.mock('../services/summarizer', async () => {
  const actual =
    await vi.importActual<typeof import('../services/summarizer')>('../services/summarizer')
  return { summarize: vi.fn(), SummarizerUnavailableError: actual.SummarizerUnavailableError }
})

import { createBookmarksRouter } from './bookmarks'
import * as db from '../services/firestore'
import { fetchMetadata } from '../services/metadataFetcher'
import { fetchArticleText } from '../services/articleFetcher'
import { summarize, SummarizerUnavailableError } from '../services/summarizer'

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

const bookmark = {
  id: '1',
  url: 'https://example.com',
  title: 'Example',
  createdAt: '2024-01-01T00:00:00.000Z',
}

describe('GET /api/bookmarks/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the bookmark', async () => {
    vi.mocked(db.getBookmark).mockResolvedValue(bookmark)
    const res = await request(app).get('/api/bookmarks/1')
    expect(res.status).toBe(200)
    expect(res.body).toEqual(bookmark)
    expect(db.getBookmark).toHaveBeenCalledWith('1')
  })

  it('returns 404 for an unknown id', async () => {
    vi.mocked(db.getBookmark).mockResolvedValue(null)
    const res = await request(app).get('/api/bookmarks/nope')
    expect(res.status).toBe(404)
  })

  it('returns 500 when Firestore rejects', async () => {
    vi.mocked(db.getBookmark).mockRejectedValue(new Error('firestore down'))
    const res = await request(app).get('/api/bookmarks/1')
    expect(res.status).toBe(500)
  })
})

describe('POST /api/bookmarks/:id/summary', () => {
  beforeEach(() => vi.clearAllMocks())

  it('generates, stores, and returns the summary', async () => {
    vi.mocked(db.getBookmark).mockResolvedValue(bookmark)
    vi.mocked(fetchArticleText).mockResolvedValue('Article body')
    vi.mocked(summarize).mockResolvedValue('A summary.\n- one\n- two\n- three')

    const res = await request(app).post('/api/bookmarks/1/summary')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ summary: 'A summary.\n- one\n- two\n- three' })
    expect(fetchArticleText).toHaveBeenCalledWith('https://example.com')
    expect(summarize).toHaveBeenCalledWith('Example', 'Article body')
    expect(db.updateSummary).toHaveBeenCalledWith('1', 'A summary.\n- one\n- two\n- three')
  })

  it('regenerates even when a summary already exists', async () => {
    vi.mocked(db.getBookmark).mockResolvedValue({ ...bookmark, summary: 'Old summary.' })
    vi.mocked(fetchArticleText).mockResolvedValue('Article body')
    vi.mocked(summarize).mockResolvedValue('New summary.')

    const res = await request(app).post('/api/bookmarks/1/summary')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ summary: 'New summary.' })
    expect(db.updateSummary).toHaveBeenCalledWith('1', 'New summary.')
  })

  it('returns 404 for an unknown id', async () => {
    vi.mocked(db.getBookmark).mockResolvedValue(null)
    const res = await request(app).post('/api/bookmarks/nope/summary')
    expect(res.status).toBe(404)
    expect(fetchArticleText).not.toHaveBeenCalled()
  })

  it('returns 502 when the article cannot be fetched', async () => {
    vi.mocked(db.getBookmark).mockResolvedValue(bookmark)
    vi.mocked(fetchArticleText).mockResolvedValue(null)
    const res = await request(app).post('/api/bookmarks/1/summary')
    expect(res.status).toBe(502)
    expect(summarize).not.toHaveBeenCalled()
    expect(db.updateSummary).not.toHaveBeenCalled()
  })

  it('returns 502 when Gemini fails', async () => {
    vi.mocked(db.getBookmark).mockResolvedValue(bookmark)
    vi.mocked(fetchArticleText).mockResolvedValue('Article body')
    vi.mocked(summarize).mockRejectedValue(new Error('429 rate limited'))
    const res = await request(app).post('/api/bookmarks/1/summary')
    expect(res.status).toBe(502)
    expect(db.updateSummary).not.toHaveBeenCalled()
  })

  it('returns 503 when the API key is not configured', async () => {
    vi.mocked(db.getBookmark).mockResolvedValue(bookmark)
    vi.mocked(fetchArticleText).mockResolvedValue('Article body')
    vi.mocked(summarize).mockRejectedValue(new SummarizerUnavailableError())
    const res = await request(app).post('/api/bookmarks/1/summary')
    expect(res.status).toBe(503)
  })

  it('returns 500 when storing the summary fails', async () => {
    vi.mocked(db.getBookmark).mockResolvedValue(bookmark)
    vi.mocked(fetchArticleText).mockResolvedValue('Article body')
    vi.mocked(summarize).mockResolvedValue('A summary.')
    vi.mocked(db.updateSummary).mockRejectedValue(new Error('firestore down'))
    const res = await request(app).post('/api/bookmarks/1/summary')
    expect(res.status).toBe(500)
  })
})
