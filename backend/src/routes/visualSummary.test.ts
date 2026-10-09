import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
const { verifyIdToken, generate } = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  generate: vi.fn(),
}))
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken }) }))
vi.mock('../services/firestore', () => ({
  getBookmark: vi.fn(),
  updateSummary: vi.fn(),
  saveVisualSummary: vi.fn(),
}))
vi.mock('../services/visualSummarizer', async () => {
  const actual = await vi.importActual<typeof import('../services/visualSummarizer')>(
    '../services/visualSummarizer'
  )
  return { ...actual, generateVisualSummary: generate }
})
import { createApp } from '../app'
import * as db from '../services/firestore'
import { InvalidVisualSummaryError } from '../visualSummary'
import { VisualSummaryUnavailableError } from '../services/visualSummarizer'

const bookmark = {
  id: '1',
  title: 'Article',
  url: 'https://example.com',
  createdAt: '2026-10-01',
  summary: 'Saved summary.',
}
const visualSummary = {
  blocks: [{ type: 'cards', title: 'Points', items: [{ title: 'A', text: 'Fact' }] }],
}
const originalKey = process.env.GEMINI_API_KEY
const originalEmails = process.env.ALLOWED_EMAILS
beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  process.env.GEMINI_API_KEY = 'test-key'
  process.env.ALLOWED_EMAILS = 'reader@example.com'
  verifyIdToken.mockResolvedValue({ email: 'reader@example.com', email_verified: true })
  vi.mocked(db.getBookmark).mockResolvedValue(bookmark)
  vi.mocked(db.saveVisualSummary).mockResolvedValue(true)
  generate.mockResolvedValue(visualSummary)
})
afterEach(() => {
  vi.restoreAllMocks()
  if (originalKey === undefined) delete process.env.GEMINI_API_KEY
  else process.env.GEMINI_API_KEY = originalKey
  if (originalEmails === undefined) delete process.env.ALLOWED_EMAILS
  else process.env.ALLOWED_EMAILS = originalEmails
})
const post = (app = createApp()) =>
  request(app).post('/api/bookmarks/1/visual-summary').set('Authorization', 'Bearer token')

describe('POST visual-summary', () => {
  it('uses only saved text, persists validated UI, and returns its source', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ source: bookmark.summary, visualSummary })
    expect(generate).toHaveBeenCalledWith(bookmark.summary)
    expect(db.updateSummary).not.toHaveBeenCalled()
    expect(db.saveVisualSummary).toHaveBeenCalledWith(
      '1',
      bookmark.summary,
      undefined,
      visualSummary
    )
  })
  it('requires existing authentication before reading or generating', async () => {
    expect((await request(createApp()).post('/api/bookmarks/1/visual-summary')).status).toBe(401)
    verifyIdToken.mockResolvedValue({ email: 'other@example.com', email_verified: true })
    expect((await post()).status).toBe(401)
    verifyIdToken.mockResolvedValue({ email: 'reader@example.com', email_verified: false })
    expect((await post()).status).toBe(401)
    expect(db.getBookmark).not.toHaveBeenCalled()
    expect(generate).not.toHaveBeenCalled()
  })
  it.each([{ prompt: 'arbitrary input' }, { summary: 'client text' }, ['input']])(
    'rejects prompt/body input: %#',
    async (body) => {
      expect((await post().send(body)).status).toBe(400)
      expect(generate).not.toHaveBeenCalled()
    }
  )
  it('returns 404 for missing bookmark and 409 for missing summary', async () => {
    vi.mocked(db.getBookmark).mockResolvedValueOnce(null)
    expect((await post()).status).toBe(404)
    vi.mocked(db.getBookmark).mockResolvedValueOnce({ ...bookmark, summary: '' })
    expect((await post()).status).toBe(409)
    expect(generate).not.toHaveBeenCalled()
  })
  it('rejects an oversized summary before generation', async () => {
    vi.mocked(db.getBookmark).mockResolvedValue({ ...bookmark, summary: 'x'.repeat(40_001) })
    expect((await post()).status).toBe(422)
    expect(generate).not.toHaveBeenCalled()
  })
  it('returns 503 without an API key', async () => {
    delete process.env.GEMINI_API_KEY
    expect((await post()).status).toBe(503)
    expect(generate).not.toHaveBeenCalled()
  })
  it.each([
    [new Error('secret internal details'), 502],
    [new InvalidVisualSummaryError(), 502],
    [new VisualSummaryUnavailableError(), 503],
    [new DOMException('Timed out', 'TimeoutError'), 504],
  ])('maps failure to a safe retryable response: %#', async (error, status) => {
    generate.mockRejectedValue(error)
    const res = await post()
    expect(res.status).toBe(status)
    expect(res.text).not.toContain('secret internal details')
  })
  it('handles failures reading either the initial or final bookmark', async () => {
    vi.mocked(db.getBookmark).mockRejectedValueOnce(new Error('db failed'))
    expect((await post()).status).toBe(500)
    expect(generate).not.toHaveBeenCalled()
    vi.mocked(db.saveVisualSummary).mockRejectedValueOnce(new Error('db failed'))
    expect((await post()).status).toBe(500)
  })
  it('discards a result if the storage transaction detects deletion or summary replacement', async () => {
    vi.mocked(db.saveVisualSummary).mockResolvedValueOnce(false)
    expect((await post()).status).toBe(409)
  })
  it('returns saved UI without a Gemini call, even when the key is unset', async () => {
    delete process.env.GEMINI_API_KEY
    vi.mocked(db.getBookmark).mockResolvedValue({
      ...bookmark,
      visualSummary: visualSummary as import('../visualSummary').VisualSummary,
    })
    const result = await post()
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ source: bookmark.summary, visualSummary })
    expect(generate).not.toHaveBeenCalled()
    expect(db.saveVisualSummary).not.toHaveBeenCalled()
  })
  it('shares an in-flight call for identical saved summaries, then permits regeneration', async () => {
    const app = createApp()
    let resolve!: (value: typeof visualSummary) => void
    generate.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r
      })
    )
    const first = post(app).then((res) => res)
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
    const second = post(app).then((res) => res)
    await vi.waitFor(() => expect(db.getBookmark).toHaveBeenCalledTimes(2))
    expect(generate).toHaveBeenCalledTimes(1)
    resolve(visualSummary)
    expect((await first).status).toBe(200)
    expect((await second).status).toBe(200)
    expect((await post(app)).status).toBe(200)
    expect(generate).toHaveBeenCalledTimes(2)
  })
  it('cleans up a failed call so retry can succeed', async () => {
    const app = createApp()
    generate.mockRejectedValueOnce(new Error('failure'))
    expect((await post(app)).status).toBe(502)
    expect((await post(app)).status).toBe(200)
    expect(generate).toHaveBeenCalledTimes(2)
  })
})
