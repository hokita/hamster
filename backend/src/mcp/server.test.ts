import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import express from 'express'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

vi.mock('../services/firestore', () => ({
  listBookmarks: vi.fn(),
  getBookmark: vi.fn(),
  getTranscript: vi.fn(),
}))

import { getBookmark, getTranscript, listBookmarks } from '../services/firestore'
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

let limiter: RateLimiter
let server: Server
let url: URL
const clients: Client[] = []

beforeAll(async () => {
  const delegating: RateLimiter = { take: () => limiter.take() }
  const app = express()
    .use(express.json())
    .all(
      '/mcp',
      createMcpRequestHandler({
        limiter: delegating,
        summaries: {} as never,
        takeSummarySlot: vi.fn(),
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
})

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()))
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

describe('hamster MCP server', () => {
  it('lists exactly the five tools with their annotations', async () => {
    const { tools } = await (await connect()).listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(['find_bookmarks', 'open_bookmark'])
    for (const tool of tools) expect(tool.annotations?.readOnlyHint).toBe(true)
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
})
