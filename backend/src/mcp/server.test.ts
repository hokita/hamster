import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import express from 'express'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

vi.mock('../services/firestore', () => ({
  listBookmarks: vi.fn(),
  getBookmark: vi.fn(),
  getTranscript: vi.fn(),
  setReadState: vi.fn(),
  updateSummary: vi.fn(),
  updateLabels: vi.fn(),
  listAllLabels: vi.fn(),
  saveVideoSummary: vi.fn(),
  setVideoSummaryState: vi.fn(),
}))
vi.mock('../services/youtubeDataApi', () => ({
  checkVideo: vi.fn(),
}))
vi.mock('../services/videoSummarizer', async () => {
  const actual = await vi.importActual<typeof import('../services/videoSummarizer')>(
    '../services/videoSummarizer'
  )
  return {
    watchVideo: vi.fn(),
    VideoUnwatchableError: actual.VideoUnwatchableError,
    VideoNoContentError: actual.VideoNoContentError,
  }
})
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
    // videoSummarizer's real module (imported above for its error classes) reads this at load.
    SUMMARY_FORMAT_RULES: actual.SUMMARY_FORMAT_RULES,
  }
})
vi.mock('../services/shortSummarizer', () => ({
  summarizeShort: vi.fn(),
}))
vi.mock('../services/labeler', () => ({
  generateLabels: vi.fn(),
}))

import {
  getBookmark,
  getTranscript,
  listAllLabels,
  listBookmarks,
  saveVideoSummary,
  setReadState,
  setVideoSummaryState,
  updateLabels,
  updateSummary,
} from '../services/firestore'
import { checkVideo } from '../services/youtubeDataApi'
import { watchVideo } from '../services/videoSummarizer'
import { fetchArticleText } from '../services/articleFetcher'
import { isSummarizerConfigured, summarize } from '../services/summarizer'
import { summarizeShort } from '../services/shortSummarizer'
import { generateLabels } from '../services/labeler'
import { createSummaryGenerator } from '../services/summaryGeneration'
import type { SummaryGenerator } from '../services/summaryGeneration'
import { createRateLimiter } from '../middleware/rateLimit'
import type { RateLimiter } from '../middleware/rateLimit'
import { createMcpRequestHandler } from './server'

const bookmark = {
  id: 'abc123',
  url: 'https://example.com/post',
  title: 'A post',
  summary: 'Full summary',
  shortSummary: 'Short',
  labels: ['tech'],
  isRead: false,
  createdAt: '2026-11-01T00:00:00.000Z',
}

const video = {
  id: 'v1',
  url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  title: 'A talk',
  isRead: false,
  createdAt: '2026-11-01T00:00:00.000Z',
}

const watched = {
  transcript: 'the transcript',
  summary: 'Video summary',
  usage: {},
  latencyMs: 1,
}

let limiter: RateLimiter
let summaries: SummaryGenerator
const takeSummarySlot = vi.fn()
let server: Server
let url: URL
const clients: Client[] = []
const originalFlag = process.env.YOUTUBE_SUMMARIES

beforeAll(async () => {
  const delegatingLimiter: RateLimiter = { take: () => limiter.take() }
  const delegatingSummaries: SummaryGenerator = {
    join: (id) => summaries.join(id),
    isRunningElsewhere: (b) => summaries.isRunningElsewhere(b),
    start: (b) => summaries.start(b),
  }
  const app = express()
    .use(express.json())
    .all(
      '/mcp',
      createMcpRequestHandler({
        limiter: delegatingLimiter,
        summaries: delegatingSummaries,
        takeSummarySlot,
        summaryWaitMs: 50,
      })
    )
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`)
})

afterAll(() => new Promise((resolve) => server.close(resolve)))

beforeEach(() => {
  vi.clearAllMocks()
  limiter = createRateLimiter({ limit: 1000, windowMs: 3_600_000 })
  summaries = createSummaryGenerator()
  process.env.YOUTUBE_SUMMARIES = 'on'
  takeSummarySlot.mockResolvedValue({ ok: true })
  vi.mocked(isSummarizerConfigured).mockReturnValue(true)
  vi.mocked(fetchArticleText).mockResolvedValue('Article body')
  vi.mocked(summarize).mockResolvedValue('New summary')
  vi.mocked(summarizeShort).mockResolvedValue('New short')
  vi.mocked(listAllLabels).mockResolvedValue([])
  vi.mocked(generateLabels).mockResolvedValue(['tech', 'ai'])
  vi.mocked(updateSummary).mockResolvedValue(undefined)
  vi.mocked(updateLabels).mockResolvedValue(undefined)
  vi.mocked(getTranscript).mockResolvedValue(null)
  vi.mocked(saveVideoSummary).mockResolvedValue(undefined)
  vi.mocked(setVideoSummaryState).mockResolvedValue(undefined)
  vi.mocked(checkVideo).mockResolvedValue({ kind: 'ok', durationSeconds: 600, title: 'A talk' })
})

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()))
  if (originalFlag === undefined) delete process.env.YOUTUBE_SUMMARIES
  else process.env.YOUTUBE_SUMMARIES = originalFlag
})

async function connect() {
  const client = new Client({ name: 'test', version: '0' })
  await client.connect(new StreamableHTTPClientTransport(url))
  clients.push(client)
  return client
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  const [first] = result.content as { type: string; text: string }[]
  return first.text
}

async function summarizeCall(id: string) {
  return (await connect()).callTool({ name: 'summarize_bookmark', arguments: { id } })
}

describe('hamster MCP server', () => {
  it('lists exactly the five tools with their annotations', async () => {
    const { tools } = await (await connect()).listTools()
    expect(Object.fromEntries(tools.map((t) => [t.name, t.annotations]))).toEqual({
      find_bookmarks: { readOnlyHint: true },
      open_bookmark: { readOnlyHint: true },
      set_read: { idempotentHint: true, destructiveHint: false },
      summarize_bookmark: { destructiveHint: false, openWorldHint: true },
    })
  })

  it('find_bookmarks returns a page of matches without the full summary', async () => {
    vi.mocked(listBookmarks).mockResolvedValue([
      bookmark,
      {
        ...bookmark,
        id: 'yt1',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        labels: undefined,
      },
    ] as never)
    const result = await (
      await connect()
    ).callTool({
      name: 'find_bookmarks',
      arguments: { query: 'post' },
    })
    expect(result.isError).toBeFalsy()
    const body = JSON.parse(textOf(result))
    expect(body.total).toBe(2)
    expect(body.bookmarks[0]).not.toHaveProperty('summary')
    expect(body.bookmarks[0]).not.toHaveProperty('videoId')
    expect(body.bookmarks[1]).toMatchObject({ labels: [], videoId: 'dQw4w9WgXcQ' })
  })

  it('open_bookmark returns the full bookmark and its transcript', async () => {
    vi.mocked(getBookmark).mockResolvedValue(bookmark as never)
    vi.mocked(getTranscript).mockResolvedValue('the transcript')
    const result = await (
      await connect()
    ).callTool({
      name: 'open_bookmark',
      arguments: { id: 'abc123' },
    })
    expect(result.isError).toBeFalsy()
    expect(JSON.parse(textOf(result))).toEqual({
      ...bookmark,
      transcript: 'the transcript',
    })
    expect(getBookmark).toHaveBeenCalledWith('abc123')
  })

  it('open_bookmark cuts a transcript at 100 000 characters', async () => {
    vi.mocked(getBookmark).mockResolvedValue(bookmark as never)
    vi.mocked(getTranscript).mockResolvedValue('x'.repeat(300_000))
    const result = await (
      await connect()
    ).callTool({
      name: 'open_bookmark',
      arguments: { id: 'abc123' },
    })
    const body = JSON.parse(textOf(result))
    expect(body.transcript).toHaveLength(100_000)
    expect(body.transcriptTruncated).toBe(true)
  })

  it('open_bookmark leaves out the transcript when there is none', async () => {
    vi.mocked(getBookmark).mockResolvedValue(bookmark as never)
    vi.mocked(getTranscript).mockResolvedValue(null)
    const result = await (
      await connect()
    ).callTool({
      name: 'open_bookmark',
      arguments: { id: 'abc123' },
    })
    expect(JSON.parse(textOf(result))).toEqual(bookmark)
  })

  it('rejects malformed ids without touching Firestore', async () => {
    const client = await connect()
    for (const id of ['', 'a/b', '../x', 'x'.repeat(65)]) {
      const result = await client.callTool({ name: 'open_bookmark', arguments: { id } })
      expect(result.isError).toBe(true)
      expect(textOf(result)).toBe('Invalid bookmark id')
    }
    expect(getBookmark).not.toHaveBeenCalled()
  })

  it('reports a missing bookmark', async () => {
    vi.mocked(getBookmark).mockResolvedValue(null)
    const result = await (
      await connect()
    ).callTool({
      name: 'open_bookmark',
      arguments: { id: 'abc123' },
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('No bookmark with id abc123')
  })

  it('returns a rate-limit tool error when the limiter refuses', async () => {
    limiter = { take: () => ({ ok: false, retryAfterSeconds: 42 }) }
    const result = await (
      await connect()
    ).callTool({
      name: 'find_bookmarks',
      arguments: {},
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('Rate limit reached: try again in 42 seconds')
    expect(listBookmarks).not.toHaveBeenCalled()
  })

  it('returns Internal error and logs when Firestore throws', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(listBookmarks).mockRejectedValue(new Error('boom'))
    const result = await (
      await connect()
    ).callTool({
      name: 'find_bookmarks',
      arguments: {},
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('Internal error')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
  it('set_read stores the state and is idempotent', async () => {
    vi.mocked(setReadState).mockResolvedValue(true)
    const client = await connect()
    for (let i = 0; i < 2; i++) {
      const result = await client.callTool({
        name: 'set_read',
        arguments: { id: 'abc123', isRead: true },
      })
      expect(result.isError).toBeFalsy()
      expect(JSON.parse(textOf(result))).toEqual({ id: 'abc123', isRead: true })
    }
    expect(setReadState).toHaveBeenCalledTimes(2)
    expect(setReadState).toHaveBeenCalledWith('abc123', true)
  })

  it('set_read reports a missing bookmark', async () => {
    vi.mocked(setReadState).mockResolvedValue(false)
    const result = await (
      await connect()
    ).callTool({
      name: 'set_read',
      arguments: { id: 'abc123', isRead: false },
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('No bookmark with id abc123')
  })

  it('summarize_bookmark returns the new summary and labels', async () => {
    vi.mocked(getBookmark).mockResolvedValue(bookmark as never)
    const result = await summarizeCall('abc123')
    expect(result.isError).toBeFalsy()
    expect(JSON.parse(textOf(result))).toEqual({
      status: 'ready',
      summary: 'New summary',
      shortSummary: 'New short',
      labels: ['tech', 'ai'],
    })
    expect(takeSummarySlot).toHaveBeenCalledWith({ limit: 10, windowMs: 3_600_000 })
  })

  it('summarize_bookmark says still summarizing after the wait, and the run continues', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.mocked(getBookmark).mockResolvedValue(video as never)
    vi.mocked(watchVideo).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(watched), 200))
    )
    const result = await summarizeCall('v1')
    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toBe(
      'Still summarizing. The run continues on the server; check back with open_bookmark in a few minutes.'
    )
    expect(saveVideoSummary).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(summaries.join('v1')).toBeUndefined())
    expect(saveVideoSummary).toHaveBeenCalledWith(
      'v1',
      expect.objectContaining({ summary: 'Video summary' })
    )
    expect(log).toHaveBeenCalledWith(
      'video summary watched for bookmark v1:',
      expect.objectContaining({ videoId: 'dQw4w9WgXcQ' })
    )
    log.mockRestore()
  })

  it('two concurrent summarize calls share one run and one budget slot', async () => {
    vi.mocked(getBookmark).mockResolvedValue(bookmark as never)
    takeSummarySlot.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 20))
    )
    const [a, b] = await Promise.all([summarizeCall('abc123'), summarizeCall('abc123')])
    expect(JSON.parse(textOf(a)).status).toBe('ready')
    expect(JSON.parse(textOf(b)).status).toBe('ready')
    expect(summarize).toHaveBeenCalledTimes(1)
    expect(takeSummarySlot).toHaveBeenCalledTimes(1)
  })

  it('joins a run the app started', async () => {
    let finishSummary!: (summary: string) => void
    vi.mocked(summarize).mockReturnValue(new Promise((resolve) => (finishSummary = resolve)))
    vi.mocked(getBookmark).mockImplementation(async () => {
      setTimeout(() => finishSummary('New summary'), 0)
      return bookmark as never
    })
    const started = summaries.start(bookmark as never)
    const result = await summarizeCall('abc123')
    await started
    expect(JSON.parse(textOf(result)).status).toBe('ready')
    expect(summarize).toHaveBeenCalledTimes(1)
    expect(takeSummarySlot).not.toHaveBeenCalled()
  })

  it('refuses a video already running on another instance without using a slot', async () => {
    vi.mocked(getBookmark).mockResolvedValue({
      ...video,
      videoSummaryState: { status: 'running', updatedAt: new Date().toISOString() },
    } as never)
    const result = await summarizeCall('v1')
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(
      'This video is already being summarized. Check back with open_bookmark in a few minutes.'
    )
    expect(takeSummarySlot).not.toHaveBeenCalled()
    expect(watchVideo).not.toHaveBeenCalled()
  })

  it('refuses past the hourly summary limit', async () => {
    vi.mocked(getBookmark).mockResolvedValue(bookmark as never)
    takeSummarySlot.mockResolvedValue({ ok: false, retryAfterSeconds: 600 })
    const result = await summarizeCall('abc123')
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('Summary limit reached (10 an hour): try again in 10 minutes')
    expect(summarize).not.toHaveBeenCalled()
  })

  it('says 1 minute when the summary limit frees up within a minute', async () => {
    vi.mocked(getBookmark).mockResolvedValue(bookmark as never)
    takeSummarySlot.mockResolvedValue({ ok: false, retryAfterSeconds: 5 })
    const result = await summarizeCall('abc123')
    expect(textOf(result)).toBe('Summary limit reached (10 an hour): try again in 1 minute')
  })

  it('reports a too-long video in plain words', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getBookmark).mockResolvedValue(video as never)
    vi.mocked(checkVideo).mockResolvedValue({ kind: 'too_long', durationSeconds: 7200 } as never)
    const result = await summarizeCall('v1')
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe("This video is longer than 60 minutes, so it can't be summarized.")
    expect(watchVideo).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(
      'summary generation failed for bookmark v1:',
      expect.objectContaining({ code: 'video_too_long' })
    )
    error.mockRestore()
  })

  it('a failure after the wait is logged, not unhandled', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getBookmark).mockResolvedValue(video as never)
    const boom = new Error('watch failed')
    vi.mocked(watchVideo).mockImplementation(
      () => new Promise((_, reject) => setTimeout(() => reject(boom), 200))
    )
    const result = await summarizeCall('v1')
    expect(result.isError).toBeFalsy()
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith('summary generation failed for bookmark v1:', boom)
    )
    expect(setVideoSummaryState).toHaveBeenCalledWith('v1', { status: 'failed', code: 'generic' })
    error.mockRestore()
  })
})
