import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../services/firestore', () => ({
  listBookmarks: vi.fn(),
  createBookmark: vi.fn(),
  getBookmark: vi.fn(),
  updateSummary: vi.fn(),
  updateLabels: vi.fn(),
  listAllLabels: vi.fn(),
  deleteBookmark: vi.fn(),
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
vi.mock('../services/labeler', () => ({
  generateLabels: vi.fn(),
}))
vi.mock('../services/articleChat', async () => {
  const actual =
    await vi.importActual<typeof import('../services/articleChat')>('../services/articleChat')
  return {
    answerQuestion: vi.fn(),
    isChatConfigured: vi.fn(),
    ChatUnavailableError: actual.ChatUnavailableError,
  }
})

import { createBookmarksRouter } from './bookmarks'
import * as db from '../services/firestore'
import { fetchMetadata } from '../services/metadataFetcher'
import { fetchArticleText } from '../services/articleFetcher'
import { summarize, isSummarizerConfigured, SummarizerUnavailableError } from '../services/summarizer'
import { generateLabels } from '../services/labeler'
import { answerQuestion, isChatConfigured, ChatUnavailableError } from '../services/articleChat'

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

describe('DELETE /api/bookmarks/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes the bookmark and returns 204 with no body', async () => {
    vi.mocked(db.deleteBookmark).mockResolvedValue(undefined)

    const res = await request(app).delete('/api/bookmarks/1')

    expect(res.status).toBe(204)
    expect(res.body).toEqual({})
    expect(db.deleteBookmark).toHaveBeenCalledWith('1')
  })

  it('answers 204 for an id that no longer exists rather than 404', async () => {
    // Firestore's delete() resolves for a missing document, so a repeat delete — a stale list
    // row, a retried request — reaches this route the same way a first one does. The endpoint is
    // idempotent by design; asserting it here keeps that from being "fixed" into a 404 later.
    vi.mocked(db.deleteBookmark).mockResolvedValue(undefined)

    const res = await request(app).delete('/api/bookmarks/gone')

    expect(res.status).toBe(204)
    expect(db.getBookmark).not.toHaveBeenCalled()
  })

  it('returns 500 when the delete rejects', async () => {
    vi.mocked(db.deleteBookmark).mockRejectedValue(new Error('firestore down'))

    const res = await request(app).delete('/api/bookmarks/1')

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: expect.any(String) })
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

describe('POST /api/bookmarks/:id/summary — labels', () => {
  const bookmark = {
    id: 'abc',
    url: 'https://example.com',
    title: 'Example',
    createdAt: '2024-01-01T00:00:00.000Z',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.getBookmark).mockResolvedValue(bookmark)
    vi.mocked(isSummarizerConfigured).mockReturnValue(true)
    vi.mocked(fetchArticleText).mockResolvedValue('Article text')
    vi.mocked(summarize).mockResolvedValue('A summary.')
    vi.mocked(db.updateSummary).mockResolvedValue(undefined)
    vi.mocked(db.listAllLabels).mockResolvedValue(['react'])
    vi.mocked(generateLabels).mockResolvedValue(['typescript'])
    vi.mocked(db.updateLabels).mockResolvedValue(undefined)
  })

  it('generates labels from the same article text and stores them', async () => {
    const res = await request(app).post('/api/bookmarks/abc/summary')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ summary: 'A summary.', labels: ['typescript'] })
    expect(generateLabels).toHaveBeenCalledWith('Example', 'Article text', ['react'])
    expect(db.updateLabels).toHaveBeenCalledWith('abc', ['typescript'])
  })

  it('stores the summary before generating labels, so a labels failure cannot cost it', async () => {
    await request(app).post('/api/bookmarks/abc/summary')
    const summaryOrder = vi.mocked(db.updateSummary).mock.invocationCallOrder[0]
    const labelsOrder = vi.mocked(generateLabels).mock.invocationCallOrder[0]
    expect(summaryOrder).toBeLessThan(labelsOrder)
  })

  it('still returns 200 with the summary when label generation fails', async () => {
    vi.mocked(generateLabels).mockRejectedValue(new Error('flash-lite down'))
    const res = await request(app).post('/api/bookmarks/abc/summary')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ summary: 'A summary.' })
    expect(db.updateLabels).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalled()
  })

  it('still returns 200 when listing the existing labels fails', async () => {
    vi.mocked(db.listAllLabels).mockRejectedValue(new Error('firestore down'))
    const res = await request(app).post('/api/bookmarks/abc/summary')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ summary: 'A summary.' })
    expect(generateLabels).not.toHaveBeenCalled()
  })

  it('still returns 200 when storing the labels fails', async () => {
    vi.mocked(db.updateLabels).mockRejectedValue(new Error('firestore down'))
    const res = await request(app).post('/api/bookmarks/abc/summary')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ summary: 'A summary.' })
  })

  it('never calls the labeler when the summary fails', async () => {
    vi.mocked(summarize).mockRejectedValue(new Error('gemini down'))
    const res = await request(app).post('/api/bookmarks/abc/summary')
    expect(res.status).toBe(502)
    expect(generateLabels).not.toHaveBeenCalled()
  })
})

describe('POST /api/bookmarks/:id/chat', () => {
  const chatBookmark = {
    id: '1',
    url: 'https://example.com',
    title: 'Example',
    createdAt: '2024-01-01T00:00:00.000Z',
  }
  const messages = [{ role: 'user', text: 'What is the main argument?' }]

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isChatConfigured).mockReturnValue(true)
    vi.mocked(db.getBookmark).mockResolvedValue(chatBookmark)
    vi.mocked(fetchArticleText).mockResolvedValue('Article body')
    vi.mocked(answerQuestion).mockResolvedValue('The article argues X.')
  })

  it('answers a question from the fetched article', async () => {
    const res = await request(app).post('/api/bookmarks/1/chat').send({ messages })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ answer: 'The article argues X.' })
    expect(fetchArticleText).toHaveBeenCalledWith('https://example.com')
    expect(answerQuestion).toHaveBeenCalledWith('Example', 'Article body', messages)
  })

  it('passes the whole conversation through, so follow-ups see earlier turns', async () => {
    const conversation = [
      { role: 'user', text: 'First question?' },
      { role: 'model', text: 'First answer.' },
      { role: 'user', text: 'Follow-up?' },
    ]
    const res = await request(app).post('/api/bookmarks/1/chat').send({ messages: conversation })
    expect(res.status).toBe(200)
    expect(answerQuestion).toHaveBeenCalledWith('Example', 'Article body', conversation)
  })

  it('returns 404 for an unknown id', async () => {
    vi.mocked(db.getBookmark).mockResolvedValue(null)
    const res = await request(app).post('/api/bookmarks/nope/chat').send({ messages })
    expect(res.status).toBe(404)
    expect(fetchArticleText).not.toHaveBeenCalled()
  })

  it('returns 400 when messages is missing or not an array', async () => {
    for (const body of [{}, { messages: 'hi' }, { messages: null }]) {
      const res = await request(app).post('/api/bookmarks/1/chat').send(body)
      expect(res.status).toBe(400)
    }
    expect(answerQuestion).not.toHaveBeenCalled()
  })

  it('returns 400 when messages is empty', async () => {
    const res = await request(app).post('/api/bookmarks/1/chat').send({ messages: [] })
    expect(res.status).toBe(400)
  })

  it('returns 400 when a message has a bad role or a non-string text', async () => {
    for (const bad of [
      [{ role: 'system', text: 'hi' }],
      [{ role: 'user', text: 42 }],
      [{ role: 'user' }],
      ['hi'],
    ]) {
      const res = await request(app).post('/api/bookmarks/1/chat').send({ messages: bad })
      expect(res.status).toBe(400)
    }
    expect(answerQuestion).not.toHaveBeenCalled()
  })

  it('returns 400 when the last message is not from the user', async () => {
    // The endpoint answers a pending question; a history ending in a model turn has none.
    const res = await request(app)
      .post('/api/bookmarks/1/chat')
      .send({
        messages: [
          { role: 'user', text: 'Question?' },
          { role: 'model', text: 'Answer.' },
        ],
      })
    expect(res.status).toBe(400)
  })

  it('returns 400 when the history does not alternate user/model turns', async () => {
    // Gemini rejects consecutive same-role turns; catching the shape here answers with a
    // validation error instead of fetching the article and surfacing a misleading 502.
    const res = await request(app)
      .post('/api/bookmarks/1/chat')
      .send({
        messages: [
          { role: 'user', text: 'One?' },
          { role: 'user', text: 'Two?' },
        ],
      })
    expect(res.status).toBe(400)
    expect(fetchArticleText).not.toHaveBeenCalled()
  })

  it('returns 400 when the history starts with a model turn', async () => {
    const res = await request(app)
      .post('/api/bookmarks/1/chat')
      .send({
        messages: [
          { role: 'model', text: 'Answer.' },
          { role: 'user', text: 'Question?' },
        ],
      })
    expect(res.status).toBe(400)
  })

  it('returns 400 when a message text is blank', async () => {
    const res = await request(app)
      .post('/api/bookmarks/1/chat')
      .send({ messages: [{ role: 'user', text: '   ' }] })
    expect(res.status).toBe(400)
  })

  it('caps the number of messages', async () => {
    const tooMany = Array.from({ length: 41 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'model',
      text: 'turn',
    }))
    const res = await request(app).post('/api/bookmarks/1/chat').send({ messages: tooMany })
    expect(res.status).toBe(400)
    expect(answerQuestion).not.toHaveBeenCalled()
  })

  it('caps the length of a user message', async () => {
    const res = await request(app)
      .post('/api/bookmarks/1/chat')
      .send({ messages: [{ role: 'user', text: 'x'.repeat(4001) }] })
    expect(res.status).toBe(400)
    expect(answerQuestion).not.toHaveBeenCalled()
  })

  it('accepts a model turn longer than the user cap, since answers can legitimately be', async () => {
    // The answer budget is 8192 output tokens — far past 4000 chars. A stored long answer comes
    // back as history with the next follow-up; rejecting it there would wedge the conversation.
    const res = await request(app)
      .post('/api/bookmarks/1/chat')
      .send({
        messages: [
          { role: 'user', text: 'Question?' },
          { role: 'model', text: 'y'.repeat(30_000) },
          { role: 'user', text: 'Follow-up?' },
        ],
      })
    expect(res.status).toBe(200)
  })

  it('still bounds a model turn, just generously', async () => {
    const res = await request(app)
      .post('/api/bookmarks/1/chat')
      .send({
        messages: [
          { role: 'user', text: 'Question?' },
          { role: 'model', text: 'y'.repeat(40_001) },
          { role: 'user', text: 'Follow-up?' },
        ],
      })
    expect(res.status).toBe(400)
    expect(answerQuestion).not.toHaveBeenCalled()
  })

  it('returns 503 when chat is not configured, before fetching the article', async () => {
    vi.mocked(isChatConfigured).mockReturnValue(false)
    const res = await request(app).post('/api/bookmarks/1/chat').send({ messages })
    expect(res.status).toBe(503)
    expect(fetchArticleText).not.toHaveBeenCalled()
  })

  it('returns 502 when the article cannot be fetched', async () => {
    vi.mocked(fetchArticleText).mockResolvedValue(null)
    const res = await request(app).post('/api/bookmarks/1/chat').send({ messages })
    expect(res.status).toBe(502)
    expect(answerQuestion).not.toHaveBeenCalled()
  })

  it('returns 502 when Gemini fails, and logs the cause with the bookmark id', async () => {
    vi.mocked(answerQuestion).mockRejectedValue(new Error('429 rate limited'))
    const res = await request(app).post('/api/bookmarks/1/chat').send({ messages })
    expect(res.status).toBe(502)
    expect(consoleError).toHaveBeenCalled()
    const logged = consoleError.mock.calls[0].map(String).join(' ')
    expect(logged).toContain('429 rate limited')
    expect(logged).toContain('1')
  })

  it('returns 503 when answerQuestion itself reports the key missing', async () => {
    vi.mocked(answerQuestion).mockRejectedValue(new ChatUnavailableError())
    const res = await request(app).post('/api/bookmarks/1/chat').send({ messages })
    expect(res.status).toBe(503)
  })

  it('returns 500 when loading the bookmark fails', async () => {
    vi.mocked(db.getBookmark).mockRejectedValue(new Error('firestore down'))
    const res = await request(app).post('/api/bookmarks/1/chat').send({ messages })
    expect(res.status).toBe(500)
  })
})
