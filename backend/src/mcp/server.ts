import type { Request, RequestHandler, Response } from 'express'
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server'
import type { CallToolResult } from '@modelcontextprotocol/server'
import { toNodeHandler } from '@modelcontextprotocol/node'
import { z } from 'zod'
import * as db from '../services/firestore'
import type { BookmarkDoc } from '../services/firestore'
import { BOOKMARK_ID, findBookmarks, findSavedLink, toListItem } from '../services/bookmarkSearch'
import { saveBookmark } from '../services/bookmarkSave'
import { parseYouTubeVideoId } from '../services/youtube'
import { describeSummaryFailure, RUNNING_ELSEWHERE } from '../services/summaryGeneration'
import type { Generated, SummaryGenerator } from '../services/summaryGeneration'
import type { RateLimiter } from '../middleware/rateLimit'

const MAX_TRANSCRIPT_CHARS = 100_000
const MAX_URL_CHARS = 2048
const SUMMARY_WAIT_MS = 45_000
const SUMMARY_BUDGET = { limit: 10, windowMs: 3_600_000 }
const STILL_SUMMARIZING =
  'Still summarizing. The run continues on the server; check back with open_bookmark in a few minutes.'

export type McpDeps = {
  limiter: RateLimiter
  summaries: SummaryGenerator
  takeSummarySlot: typeof db.takeSummarySlot
  summaryWaitMs?: number
}

function text(value: string): CallToolResult {
  return { content: [{ type: 'text', text: value }] }
}

function toolError(message: string): CallToolResult {
  return { ...text(message), isError: true }
}

function limited<A>(
  limiter: RateLimiter,
  failure: string,
  run: (args: A) => Promise<CallToolResult>
): (args: A) => Promise<CallToolResult> {
  return async (args) => {
    const allowed = limiter.take()
    if (!allowed.ok) {
      return toolError(`Rate limit reached: try again in ${allowed.retryAfterSeconds} seconds`)
    }
    try {
      return await run(args)
    } catch (err) {
      console.error(failure, err)
      return toolError('Internal error')
    }
  }
}

function parseBookmarkId(id: string): string | null {
  return BOOKMARK_ID.test(id) ? id : null
}

async function loadBookmark(
  rawId: string
): Promise<{ bookmark: BookmarkDoc } | { error: CallToolResult }> {
  const id = parseBookmarkId(rawId)
  if (!id) return { error: toolError('Invalid bookmark id') }
  const bookmark = await db.getBookmark(id)
  if (!bookmark) return { error: toolError(`No bookmark with id ${id}`) }
  return { bookmark }
}

export type SummaryOutcome =
  | { status: 'ready'; summary: string; shortSummary?: string; labels?: string[] }
  | { status: 'running'; message: string }
  | { status: 'failed'; message: string }
  | { status: 'not_started'; message: string }

type Claim = { generation: Promise<Generated> } | { refused: SummaryOutcome }

const pendingClaims = new WeakMap<SummaryGenerator, Map<string, Promise<Claim>>>()

function minutes(seconds: number): string {
  const n = Math.ceil(seconds / 60)
  return n === 1 ? '1 minute' : `${n} minutes`
}

async function claimRun(bookmark: BookmarkDoc, deps: McpDeps): Promise<Claim> {
  const slot = await deps.takeSummarySlot(SUMMARY_BUDGET)
  if (!slot.ok) {
    return {
      refused: {
        status: 'not_started',
        message: `Summary limit reached (10 an hour): try again in ${minutes(slot.retryAfterSeconds)}`,
      },
    }
  }
  return { generation: deps.summaries.join(bookmark.id) ?? deps.summaries.start(bookmark) }
}

function claimFor(bookmark: BookmarkDoc, deps: McpDeps): Promise<Claim> {
  let claims = pendingClaims.get(deps.summaries)
  if (!claims) {
    claims = new Map()
    pendingClaims.set(deps.summaries, claims)
  }
  const pending = claims.get(bookmark.id)
  if (pending) return pending
  const claim = claimRun(bookmark, deps)
  claims.set(bookmark.id, claim)
  const cleanup = () => {
    if (claims.get(bookmark.id) === claim) claims.delete(bookmark.id)
  }
  claim.then(cleanup, cleanup)
  return claim
}

function logFailure(id: string, error: unknown) {
  console.error(`summary generation failed for bookmark ${id}:`, error)
}

export async function runSummary(bookmark: BookmarkDoc, deps: McpDeps): Promise<SummaryOutcome> {
  let generation = deps.summaries.join(bookmark.id)
  if (!generation) {
    if (deps.summaries.isRunningElsewhere(bookmark)) {
      return { status: 'failed', message: RUNNING_ELSEWHERE.message }
    }
    const claim = await claimFor(bookmark, deps)
    if ('refused' in claim) return claim.refused
    generation = claim.generation
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), deps.summaryWaitMs ?? SUMMARY_WAIT_MS)
  })
  try {
    const result = await Promise.race([generation, timeout])
    if (result === 'timeout') {
      generation.catch((error) => logFailure(bookmark.id, error))
      return { status: 'running', message: STILL_SUMMARIZING }
    }
    const { summary, shortSummary, labels } = result
    return {
      status: 'ready',
      summary,
      ...(shortSummary ? { shortSummary } : {}),
      ...(labels ? { labels } : {}),
    }
  } catch (error) {
    logFailure(bookmark.id, error)
    return { status: 'failed', message: describeSummaryFailure(error).message }
  } finally {
    clearTimeout(timer)
  }
}

type Saved = { created: boolean; bookmark: BookmarkDoc }

const pendingSaves = new Map<string, Promise<Saved>>()

async function saveUnlessSaved(url: string): Promise<Saved> {
  const existing = findSavedLink(await db.listBookmarks(), url)
  if (existing) return { created: false, bookmark: existing }
  return { created: true, bookmark: await saveBookmark(url) }
}

async function saveOnce(url: string): Promise<Saved> {
  const videoId = parseYouTubeVideoId(url)
  const key = videoId ? `yt:${videoId}` : url
  const pending = pendingSaves.get(key)
  if (pending) return { created: false, bookmark: (await pending).bookmark }
  const save = saveUnlessSaved(url)
  pendingSaves.set(key, save)
  const cleanup = () => {
    if (pendingSaves.get(key) === save) pendingSaves.delete(key)
  }
  save.then(cleanup, cleanup)
  return save
}

async function summarizeSaved(bookmark: BookmarkDoc, deps: McpDeps): Promise<SummaryOutcome> {
  try {
    return await runSummary(bookmark, deps)
  } catch (error) {
    logFailure(bookmark.id, error)
    return { status: 'failed', message: "Couldn't generate a summary. Try again later." }
  }
}

export function createHamsterMcpServer(deps: McpDeps): McpServer {
  const { limiter } = deps
  const server = new McpServer({ name: 'hamster', version: '1.0.0' })

  server.registerTool(
    'find_bookmarks',
    {
      description:
        "Find the owner's saved hamster bookmarks, newest first. Filter by words, a label or read state. Returns titles, links, labels and short summaries one page at a time; use open_bookmark for a bookmark's full summary.",
      inputSchema: z.object({
        query: z
          .string()
          .max(200)
          .optional()
          .describe(
            'Words that must all appear in the title, link, labels or summaries (any language, case-insensitive)'
          ),
        label: z
          .string()
          .optional()
          .describe('Only bookmarks with this label (exact, case-insensitive)'),
        unread: z
          .boolean()
          .optional()
          .describe('true: only unread; false: only read; leave out for both'),
        limit: z.number().int().optional().describe('How many to return, 1–50 (default 20)'),
        offset: z
          .number()
          .int()
          .optional()
          .describe('How many to skip, from nextOffset of the previous page (default 0)'),
      }),
      annotations: { readOnlyHint: true },
    },
    limited(limiter, 'Failed to find bookmarks', async (args) => {
      const all = await db.listBookmarks()
      return text(JSON.stringify(findBookmarks(all, args)))
    })
  )

  server.registerTool(
    'open_bookmark',
    {
      description:
        'Open one hamster bookmark: its full summary, labels, read state, and the video transcript if it is a summarized YouTube video.',
      inputSchema: z.object({
        id: z.string().describe('The bookmark id from find_bookmarks or save_link'),
      }),
      annotations: { readOnlyHint: true },
    },
    limited(limiter, 'Failed to open bookmark', async ({ id }) => {
      const loaded = await loadBookmark(id)
      if ('error' in loaded) return loaded.error
      const { bookmark } = loaded
      const videoId = parseYouTubeVideoId(bookmark.url)
      const transcript = await db.getTranscript(bookmark.id)
      const result: Record<string, unknown> = { ...bookmark }
      if (videoId) result.videoId = videoId
      if (transcript !== null) {
        result.transcript = transcript.slice(0, MAX_TRANSCRIPT_CHARS)
        if (transcript.length > MAX_TRANSCRIPT_CHARS) result.transcriptTruncated = true
      }
      return text(JSON.stringify(result))
    })
  )

  server.registerTool(
    'save_link',
    {
      description:
        "Save a link to hamster, the same as saving it in the app: hamster reads its title and then summarizes it (waiting up to about 45 seconds). A link that is already saved isn't added again; the existing bookmark comes back instead.",
      inputSchema: z.object({
        url: z.string().describe('An http or https link'),
      }),
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    limited(limiter, 'Failed to save link', async ({ url: rawUrl }) => {
      const url = rawUrl.trim()
      if (!/^https?:\/\//.test(url) || url.length > MAX_URL_CHARS) {
        return toolError('URL must be an http or https link up to 2048 characters')
      }
      const saved = await saveOnce(url)
      if (!saved.created) {
        return text(JSON.stringify({ created: false, bookmark: toListItem(saved.bookmark) }))
      }
      const outcome = await summarizeSaved(saved.bookmark, deps)
      if (outcome.status === 'ready') {
        const { summary, shortSummary, labels } = outcome
        const bookmark = toListItem({ ...saved.bookmark, summary, shortSummary, labels })
        return text(JSON.stringify({ created: true, bookmark, summaryStatus: 'ready' }))
      }
      return text(
        JSON.stringify({
          created: true,
          bookmark: toListItem(saved.bookmark),
          summaryStatus: outcome.status,
          summaryMessage: outcome.message,
        })
      )
    })
  )

  server.registerTool(
    'set_read',
    {
      description: 'Mark a hamster bookmark as read or unread.',
      inputSchema: z.object({
        id: z.string().describe('The bookmark id from find_bookmarks or save_link'),
        isRead: z.boolean().describe('true: read; false: unread'),
      }),
      annotations: { idempotentHint: true, destructiveHint: false },
    },
    limited(limiter, 'Failed to set read state', async ({ id: rawId, isRead }) => {
      const id = parseBookmarkId(rawId)
      if (!id) return toolError('Invalid bookmark id')
      if (!(await db.setReadState(id, isRead))) return toolError(`No bookmark with id ${id}`)
      return text(JSON.stringify({ id, isRead }))
    })
  )

  server.registerTool(
    'summarize_bookmark',
    {
      description:
        "Make a fresh summary and labels for a hamster bookmark, replacing the current ones, the same as Generate in the app. Uses a paid AI call: at most 10 an hour, shared with save_link. Videos over 60 minutes can't be summarized. Waits up to about 45 seconds; a longer run keeps going, so check back with open_bookmark.",
      inputSchema: z.object({
        id: z.string().describe('The bookmark id from find_bookmarks or save_link'),
      }),
      annotations: { destructiveHint: false, openWorldHint: true },
    },
    limited(limiter, 'Failed to summarize bookmark', async ({ id }) => {
      const loaded = await loadBookmark(id)
      if ('error' in loaded) return loaded.error
      const outcome = await runSummary(loaded.bookmark, deps)
      if (outcome.status === 'ready') return text(JSON.stringify(outcome))
      if (outcome.status === 'running') return text(outcome.message)
      return toolError(outcome.message)
    })
  )

  return server
}

function logMcpError(err: Error) {
  console.error('MCP request failed:', err.message)
}

export function createMcpRequestHandler(deps: McpDeps): RequestHandler {
  const factory = () => {
    const server = createHamsterMcpServer(deps)
    server.server.onerror = logMcpError
    return server
  }
  const handle = toNodeHandler(createMcpHandler(factory, { onerror: logMcpError }), {
    onerror: logMcpError,
  })
  return (req: Request, res: Response) => {
    void handle(req, res, req.body)
  }
}
