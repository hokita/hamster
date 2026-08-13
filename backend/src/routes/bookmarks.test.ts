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
  return {
    summarize: vi.fn(),
    isSummarizerConfigured: vi.fn(),
    SummarizerUnavailableError: actual.SummarizerUnavailableError,
  }
})

import { createBookmarksRouter } from './bookmarks'
import * as db from '../services/firestore'
import { fetchMetadata } from '../services/metadataFetcher'
import { fetchArticleText } from '../services/articleFetcher'
import { summarize, isSummarizerConfigured, SummarizerUnavailableError } from '../services/summarizer'

const app = express()
app.use(express.json())
app.use('/api/bookmarks', createBookmarksRouter())

// The summary route logs the cause of every failure, and several tests below deliberately provoke
// one. Silence it here so a passing run stays readable; the test that asserts on the log reads this
// spy. Safe under the per-suite vi.clearAllMocks(), which clears recorded calls but keeps the
// implementation.
const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

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
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isSummarizerConfigured).mockReturnValue(true)
  })

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

  it('logs the underlying cause when generation fails, instead of swallowing it', async () => {
    // The 502 body is deliberately vague, so without this the only trace a failed summary leaves
    // is a bare status code in the Cloud Run request log — which is exactly what made the
    // gemini-3.6-flash token-budget regression take a revision-by-revision bisect to diagnose.
    vi.mocked(db.getBookmark).mockResolvedValue(bookmark)
    vi.mocked(fetchArticleText).mockResolvedValue('Article body')
    vi.mocked(summarize).mockRejectedValue(new Error('gemini response was truncated'))

    const res = await request(app).post('/api/bookmarks/1/summary')

    expect(res.status).toBe(502)
    expect(consoleError).toHaveBeenCalled()
    const logged = consoleError.mock.calls[0].map(String).join(' ')
    expect(logged).toContain('gemini response was truncated')
    expect(logged).toContain('1') // the bookmark id, so a failure can be tied to its bookmark
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

  it('keeps the underlying write failure as the cause, so the log names it', async () => {
    // Codex caught that SummaryStorageError replaced the Firestore exception outright, so the
    // failure log said only "Failed to save the summary" — it could not distinguish a permission
    // problem from an outage from a bad document, which is the whole point of logging it.
    vi.mocked(db.getBookmark).mockResolvedValue(bookmark)
    vi.mocked(fetchArticleText).mockResolvedValue('Article body')
    vi.mocked(summarize).mockResolvedValue('A summary.')
    vi.mocked(db.updateSummary).mockRejectedValue(new Error('7 PERMISSION_DENIED'))

    const res = await request(app).post('/api/bookmarks/1/summary')

    expect(res.status).toBe(500)
    const logged = consoleError.mock.calls[0][1] as { cause?: unknown }
    expect((logged.cause as Error | undefined)?.message).toBe('7 PERMISSION_DENIED')
  })

  // Codex identified that checking configuration only inside summarize() meant an unconfigured
  // deployment still paid for fetchArticleText (up to 8s) before failing, and — worse — that a
  // fetch failure on top of being unconfigured produced a misleading 502 instead of the
  // deterministic 503 callers should always get when there is no key. These two tests cover the
  // fix: the configuration check happens before any network work.
  it('returns 503 without fetching the article when the summarizer is not configured', async () => {
    vi.mocked(db.getBookmark).mockResolvedValue(bookmark)
    vi.mocked(isSummarizerConfigured).mockReturnValue(false)

    const res = await request(app).post('/api/bookmarks/1/summary')

    expect(res.status).toBe(503)
    expect(fetchArticleText).not.toHaveBeenCalled()
  })

  it('returns 503, not 502, when unconfigured even though the page would be unreadable', async () => {
    vi.mocked(db.getBookmark).mockResolvedValue(bookmark)
    vi.mocked(isSummarizerConfigured).mockReturnValue(false)
    vi.mocked(fetchArticleText).mockResolvedValue(null)

    const res = await request(app).post('/api/bookmarks/1/summary')

    expect(res.status).toBe(503)
  })
})

// A generation calls the paid Gemini API. Adding a bookmark starts a generation in the background,
// and the page for that bookmark opens with an enabled "Generate summary" button that knows nothing
// about it — so two concurrent, separately billed requests for the same bookmark are easy to trigger
// by accident. These tests cover the dedup that prevents that.
describe('POST /api/bookmarks/:id/summary — concurrent dedup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.updateSummary).mockResolvedValue(undefined)
    vi.mocked(isSummarizerConfigured).mockReturnValue(true)
  })

  function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  const bookmark2 = {
    id: '2',
    url: 'https://example.org',
    title: 'Example Two',
    createdAt: '2024-01-01T00:00:00.000Z',
  }

  it('joins concurrent requests for the same id into a single summarize call', async () => {
    vi.mocked(db.getBookmark).mockResolvedValue(bookmark)
    vi.mocked(fetchArticleText).mockResolvedValue('Article body')
    const gen = deferred<string>()
    vi.mocked(summarize).mockReturnValue(gen.promise)

    // supertest/superagent requests don't dispatch until `.then`/`.end` is called, so kick both off
    // immediately by chaining `.then` rather than merely assigning the (lazy) request objects.
    const req1 = request(app).post('/api/bookmarks/1/summary').then((r) => r)
    const req2 = request(app).post('/api/bookmarks/1/summary').then((r) => r)

    // Give both requests a chance to reach the summarize call before it resolves.
    await new Promise((r) => setTimeout(r, 20))
    expect(summarize).toHaveBeenCalledTimes(1)

    gen.resolve('The shared summary.')
    const [res1, res2] = await Promise.all([req1, req2])

    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)
    expect(res1.body).toEqual({ summary: 'The shared summary.' })
    expect(res2.body).toEqual({ summary: 'The shared summary.' })
    expect(summarize).toHaveBeenCalledTimes(1)
  })

  it('does not cross-talk between concurrent requests for different ids', async () => {
    vi.mocked(db.getBookmark).mockImplementation(async (id: string) =>
      id === '1' ? bookmark : bookmark2
    )
    vi.mocked(fetchArticleText).mockImplementation(async (url: string) =>
      url === bookmark.url ? 'Article one body' : 'Article two body'
    )
    vi.mocked(summarize).mockImplementation(async (title: string) => `Summary for ${title}`)

    const [res1, res2] = await Promise.all([
      request(app).post('/api/bookmarks/1/summary'),
      request(app).post('/api/bookmarks/2/summary'),
    ])

    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)
    expect(res1.body).toEqual({ summary: 'Summary for Example' })
    expect(res2.body).toEqual({ summary: 'Summary for Example Two' })
    expect(summarize).toHaveBeenCalledTimes(2)
    expect(summarize).toHaveBeenCalledWith('Example', 'Article one body')
    expect(summarize).toHaveBeenCalledWith('Example Two', 'Article two body')
  })

  it('generates again on a sequential second request after the first settles', async () => {
    vi.mocked(db.getBookmark).mockResolvedValue(bookmark)
    vi.mocked(fetchArticleText).mockResolvedValue('Article body')
    vi.mocked(summarize).mockResolvedValue('A summary.')

    const res1 = await request(app).post('/api/bookmarks/1/summary')
    expect(res1.status).toBe(200)
    const res2 = await request(app).post('/api/bookmarks/1/summary')
    expect(res2.status).toBe(200)

    expect(summarize).toHaveBeenCalledTimes(2)
  })

  it('gives every concurrent waiter 503 when the shared generation is unconfigured', async () => {
    vi.mocked(db.getBookmark).mockResolvedValue(bookmark)
    vi.mocked(fetchArticleText).mockResolvedValue('Article body')
    const gen = deferred<string>()
    vi.mocked(summarize).mockReturnValue(gen.promise)

    const req1 = request(app).post('/api/bookmarks/1/summary').then((r) => r)
    const req2 = request(app).post('/api/bookmarks/1/summary').then((r) => r)

    await new Promise((r) => setTimeout(r, 20))
    gen.reject(new SummarizerUnavailableError())

    const [res1, res2] = await Promise.all([req1, req2])
    expect(res1.status).toBe(503)
    expect(res2.status).toBe(503)
  })

  it('gives every concurrent waiter 502 when the shared generation fails for another reason', async () => {
    vi.mocked(db.getBookmark).mockResolvedValue(bookmark)
    vi.mocked(fetchArticleText).mockResolvedValue('Article body')
    const gen = deferred<string>()
    vi.mocked(summarize).mockReturnValue(gen.promise)

    const req1 = request(app).post('/api/bookmarks/1/summary').then((r) => r)
    const req2 = request(app).post('/api/bookmarks/1/summary').then((r) => r)

    await new Promise((r) => setTimeout(r, 20))
    gen.reject(new Error('429 rate limited'))

    const [res1, res2] = await Promise.all([req1, req2])
    expect(res1.status).toBe(502)
    expect(res2.status).toBe(502)
  })
})
