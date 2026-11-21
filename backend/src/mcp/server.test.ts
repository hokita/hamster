import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import express from 'express'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

vi.mock('../services/firestore', () => ({
  listBookmarks: vi.fn(),
  createBookmark: vi.fn(),
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
vi.mock('../services/metadataFetcher', () => ({
  fetchMetadata: vi.fn(),
}))
vi.mock('../services/youtubeOembed', async () => {
  const actual = await vi.importActual<typeof import('../services/youtubeOembed')>(
    '../services/youtubeOembed'
  )
  return {
    fetchYouTubeTitle: vi.fn(),
    YOUTUBE_FAVICON_URL: actual.YOUTUBE_FAVICON_URL,
  }
})

import {
  createBookmark,
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
import { fetchMetadata } from '../services/metadataFetcher'
import { fetchYouTubeTitle } from '../services/youtubeOembed'
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
  vi.mocked(listBookmarks).mockResolvedValue([])
  vi.mocked(fetchMetadata).mockResolvedValue({ title: 'New post', faviconUrl: null })
  vi.mocked(fetchYouTubeTitle).mockResolvedValue('A talk')
  vi.mocked(createBookmark).mockImplementation(async (url, title, faviconUrl) => ({
    id: 'new1',
    url,
    title,
    ...(faviconUrl ? { faviconUrl } : {}),
    isRead: false,
    createdAt: '2026-11-21T00:00:00.000Z',
  }))
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

async function saveCall(link: string) {
  const result = await (await connect()).callTool({ name: 'save_link', arguments: { url: link } })
  return { result, body: result.isError ? undefined : JSON.parse(textOf(result)) }
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
      save_link: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
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

  it('saves a new link and summarizes it like the app', async () => {
    vi.mocked(fetchMetadata).mockResolvedValue({
      title: 'New post',
      faviconUrl: 'https://new.example/favicon.ico',
    })
    const { result, body } = await saveCall('  https://new.example/post \n')
    expect(result.isError).toBeFalsy()
    expect(createBookmark).toHaveBeenCalledTimes(1)
    expect(createBookmark).toHaveBeenCalledWith(
      'https://new.example/post',
      'New post',
      'https://new.example/favicon.ico'
    )
    expect(summarize).toHaveBeenCalledTimes(1)
    expect(vi.mocked(createBookmark).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(summarize).mock.invocationCallOrder[0]
    )
    expect(body).toEqual({
      created: true,
      bookmark: {
        id: 'new1',
        title: 'New post',
        url: 'https://new.example/post',
        labels: ['tech', 'ai'],
        shortSummary: 'New short',
        hasSummary: true,
        isRead: false,
        createdAt: '2026-11-21T00:00:00.000Z',
      },
      summaryStatus: 'ready',
    })
  })

  it('returns the existing bookmark without saving or summarizing', async () => {
    vi.mocked(listBookmarks).mockResolvedValue([bookmark] as never)
    const { result, body } = await saveCall(` ${bookmark.url} `)
    expect(result.isError).toBeFalsy()
    expect(body).toEqual({
      created: false,
      bookmark: {
        id: 'abc123',
        title: 'A post',
        url: 'https://example.com/post',
        labels: ['tech'],
        shortSummary: 'Short',
        hasSummary: true,
        isRead: false,
        createdAt: '2026-11-01T00:00:00.000Z',
      },
    })
    expect(fetchMetadata).not.toHaveBeenCalled()
    expect(createBookmark).not.toHaveBeenCalled()
    expect(takeSummarySlot).not.toHaveBeenCalled()
    expect(summarize).not.toHaveBeenCalled()
  })

  it('two simultaneous saves of one link create one bookmark', async () => {
    vi.mocked(fetchMetadata).mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ title: 'New post', faviconUrl: null }), 50)
        )
    )
    const [a, b] = await Promise.all([
      saveCall('https://new.example/post'),
      saveCall(' https://new.example/post'),
    ])
    expect(createBookmark).toHaveBeenCalledTimes(1)
    expect(takeSummarySlot).toHaveBeenCalledTimes(1)
    expect(summarize).toHaveBeenCalledTimes(1)
    const created = [a.body, b.body].find((body) => body.created)
    const joined = [a.body, b.body].find((body) => !body.created)
    expect(created).toMatchObject({ summaryStatus: 'ready', bookmark: { id: 'new1' } })
    expect(joined).toEqual({ created: false, bookmark: expect.objectContaining({ id: 'new1' }) })

    vi.mocked(fetchYouTubeTitle).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve('A talk'), 50))
    )
    takeSummarySlot.mockResolvedValue({ ok: false, retryAfterSeconds: 600 })
    const videos = await Promise.all([
      saveCall('https://youtu.be/dQw4w9WgXcQ'),
      saveCall('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    ])
    expect(createBookmark).toHaveBeenCalledTimes(2)
    expect(videos.filter((v) => v.body.created)).toHaveLength(1)
  })

  it('saves but does not summarize past the summary limit', async () => {
    takeSummarySlot.mockResolvedValue({ ok: false, retryAfterSeconds: 600 })
    const { result, body } = await saveCall('https://new.example/post')
    expect(result.isError).toBeFalsy()
    expect(createBookmark).toHaveBeenCalledTimes(1)
    expect(summarize).not.toHaveBeenCalled()
    expect(body).toMatchObject({
      created: true,
      bookmark: { id: 'new1', hasSummary: false },
      summaryStatus: 'not_started',
      summaryMessage: 'Summary limit reached (10 an hour): try again in 10 minutes',
    })
  })

  it('reports a failed summary, not an internal error, when the summary step throws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const boom = new Error('firestore down')
    takeSummarySlot.mockRejectedValue(boom)
    const { result, body } = await saveCall('https://new.example/post')
    expect(result.isError).toBeFalsy()
    expect(body).toMatchObject({
      created: true,
      bookmark: { id: 'new1' },
      summaryStatus: 'failed',
      summaryMessage: "Couldn't generate a summary. Try again later.",
    })
    expect(error).toHaveBeenCalledWith('summary generation failed for bookmark new1:', boom)
    error.mockRestore()
  })

  it('rejects a non-http url and one over 2048 characters', async () => {
    for (const link of ['javascript:alert(1)', 'ftp://x', 'https://a.com/' + 'x'.repeat(2048)]) {
      const { result } = await saveCall(link)
      expect(result.isError).toBe(true)
      expect(textOf(result)).toBe('URL must be an http or https link up to 2048 characters')
    }
    expect(listBookmarks).not.toHaveBeenCalled()
    expect(createBookmark).not.toHaveBeenCalled()
  })

  it('keeps a Japanese title from the page', async () => {
    vi.mocked(fetchMetadata).mockResolvedValue({ title: 'はむすたーの記事', faviconUrl: null })
    takeSummarySlot.mockResolvedValue({ ok: false, retryAfterSeconds: 600 })
    const { body } = await saveCall('https://new.example/記事')
    expect(createBookmark).toHaveBeenCalledWith(
      'https://new.example/記事',
      'はむすたーの記事',
      null
    )
    expect(body.bookmark.title).toBe('はむすたーの記事')
  })
})
