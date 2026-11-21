import type { Request, RequestHandler, Response } from 'express'
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server'
import type { CallToolResult } from '@modelcontextprotocol/server'
import { toNodeHandler } from '@modelcontextprotocol/node'
import { z } from 'zod'
import * as db from '../services/firestore'
import type { BookmarkDoc } from '../services/firestore'
import { BOOKMARK_ID, findBookmarks } from '../services/bookmarkSearch'
import { parseYouTubeVideoId } from '../services/youtube'
import type { SummaryGenerator } from '../services/summaryGeneration'
import type { RateLimiter } from '../middleware/rateLimit'

const MAX_TRANSCRIPT_CHARS = 100_000

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

// Each tool call takes from the token limiter;
// protocol requests (initialize, tools/list) never reach a tool and aren't counted.
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

export function createHamsterMcpServer({ limiter }: McpDeps): McpServer {
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

  return server
}

// The SDK answers rejected requests (406, 415, bad protocol version, ...) itself
// and reports them through onerror; log only the message so a failing
// connector leaves a reason in the logs.
function logMcpError(err: Error) {
  console.error('MCP request failed:', err.message)
}

// Stateless: the SDK builds a fresh server per request. express.json() has
// already read the body, so it's passed in rather than re-read from the stream.
export function createMcpRequestHandler(deps: McpDeps): RequestHandler {
  const factory = () => {
    const server = createHamsterMcpServer(deps)
    // Transport-level rejections reach the server instance, not the handler.
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
