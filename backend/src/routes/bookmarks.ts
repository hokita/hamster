import { Router } from 'express'
import type { Request, Response } from 'express'
import * as db from '../services/firestore'
import type { BookmarkDoc } from '../services/firestore'
import { fetchMetadata } from '../services/metadataFetcher'
import { fetchArticleText } from '../services/articleFetcher'
import { summarize, isSummarizerConfigured, SummarizerUnavailableError } from '../services/summarizer'

// Thrown when the linked page could not be read (blocked, non-HTML, 404/500, network failure, ...).
// A sentinel rather than a plain Error so the shared in-flight promise's rejection can still be
// told apart from other generation failures once every waiter is classifying it independently.
class ArticleUnreadableError extends Error {
  constructor() {
    super('Could not read the linked page')
  }
}

// Thrown when the summary itself was generated successfully but persisting it failed. Kept
// distinct from a generation failure because it maps to 500, not 502 — the expensive part (calling
// Gemini) already succeeded, only the write did not.
class SummaryStorageError extends Error {
  // Declared explicitly rather than passed to super() as an ErrorOptions `cause`, which needs the
  // ES2022 lib; this project targets ES2020. Node still reports an own `cause` when the error is
  // logged, underlying stack included, so the diagnostic value is the same.
  readonly cause: unknown

  constructor(cause: unknown) {
    super('Failed to save the summary')
    // Without this the original Firestore error is discarded, and the failure log can only say
    // "Failed to save the summary" — it cannot tell a permissions problem from an outage.
    this.cause = cause
  }
}

export function createBookmarksRouter(): Router {
  const router = Router()

  // Generating a summary costs one paid Gemini call. The UI makes it easy to trigger two for the
  // same bookmark at once: adding a bookmark kicks off a generation in the background, and the
  // page for that bookmark opens right away with an enabled "Generate summary" button that knows
  // nothing about it. This map lets a request for an id that's already generating join the
  // in-flight promise instead of starting (and paying for) a second one. It lives inside the
  // factory, not at module scope, so each router — and each test — gets its own map.
  //
  // This dedup is per-process, in-memory state, so it does not span Cloud Run instances: it cannot
  // see or join a generation already running on a different instance. That is an intentional gap,
  // not an oversight. The case this exists for — the automatic generation kicked off on add and a
  // manual retry landing seconds apart — in practice lands on the same warm instance, because Cloud
  // Run only scales out under sustained concurrency, not a couple of requests seconds apart. A
  // Firestore-backed lease would close the cross-instance gap, but that trades this in-memory map
  // for a distributed lock with its own failure modes (stale leases, lease-holder crashes) — real
  // cost for a single-user app where the occasional duplicate Gemini call is cheap to tolerate.
  const inFlight = new Map<string, Promise<string>>()

  function generateSummary(bookmark: BookmarkDoc): Promise<string> {
    const generation = (async () => {
      // Check configuration before doing any network work. Without a key the request can never
      // succeed, so fetching the article first only burns up to 8 seconds and bandwidth on a
      // request that was always going to fail — and, worse, it turns a deterministic 503 into a
      // misleading 502 whenever the page also happens to be unreachable, blocked, or non-HTML.
      if (!isSummarizerConfigured()) throw new SummarizerUnavailableError()

      const text = await fetchArticleText(bookmark.url)
      if (!text) throw new ArticleUnreadableError()

      const summary = await summarize(bookmark.title, text)

      try {
        await db.updateSummary(bookmark.id, summary)
      } catch (error) {
        throw new SummaryStorageError(error)
      }
      return summary
    })()

    // Remove the map entry once the generation settles, success or failure, so the next request
    // for this id starts a fresh generation — the "always regenerate" retry contract — instead of
    // joining a dead entry. Attached via .then(cleanup, cleanup) rather than .finally(cleanup): a
    // bare .finally on a rejecting promise re-throws, which would create a NEW unhandled rejected
    // promise instead of just running the cleanup.
    const cleanup = () => inFlight.delete(bookmark.id)
    generation.then(cleanup, cleanup)

    return generation
  }

  router.get('/', async (_req: Request, res: Response) => {
    try {
      const bookmarks = await db.listBookmarks()
      res.json(bookmarks)
    } catch {
      res.status(500).json({ error: 'Failed to list bookmarks' })
    }
  })

  router.post('/', async (req: Request, res: Response) => {
    const { url } = req.body as { url?: unknown }
    if (typeof url !== 'string' || !url) {
      res.status(400).json({ error: 'url is required' })
      return
    }
    if (!/^https?:\/\//.test(url)) {
      res.status(400).json({ error: 'url must be an http(s) URL' })
      return
    }
    try {
      const { title, faviconUrl } = await fetchMetadata(url)
      const bookmark = await db.createBookmark(url, title ?? url, faviconUrl)
      res.status(201).json(bookmark)
    } catch {
      res.status(500).json({ error: 'Failed to create bookmark' })
    }
  })

  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const bookmark = await db.getBookmark(req.params.id)
      if (!bookmark) {
        res.status(404).json({ error: 'Bookmark not found' })
        return
      }
      res.json(bookmark)
    } catch {
      res.status(500).json({ error: 'Failed to load bookmark' })
    }
  })

  // Always regenerates rather than returning a stored summary, so this endpoint doubles as
  // "redo this summary" for the retry button.
  router.post('/:id/summary', async (req: Request, res: Response) => {
    let bookmark
    try {
      bookmark = await db.getBookmark(req.params.id)
    } catch {
      res.status(500).json({ error: 'Failed to load bookmark' })
      return
    }
    if (!bookmark) {
      res.status(404).json({ error: 'Bookmark not found' })
      return
    }

    let generation = inFlight.get(bookmark.id)
    if (!generation) {
      generation = generateSummary(bookmark)
      inFlight.set(bookmark.id, generation)
    }

    try {
      const summary = await generation
      res.json({ summary })
    } catch (error) {
      // Every response body below is deliberately vague — the client has no use for the internals
      // and they must not leak to it. That left a failed summary with no trace anywhere but a bare
      // status code in the Cloud Run request log. Log the real cause here, tagged with the bookmark
      // id, so the next failure is one log query rather than a bisect across revisions.
      console.error(`summary generation failed for bookmark ${bookmark.id}:`, error)
      if (error instanceof SummarizerUnavailableError) {
        res.status(503).json({ error: 'Summarization is not configured' })
      } else if (error instanceof SummaryStorageError) {
        res.status(500).json({ error: 'Failed to save the summary' })
      } else if (error instanceof ArticleUnreadableError) {
        res.status(502).json({ error: 'Could not read the linked page' })
      } else {
        res.status(502).json({ error: 'Failed to generate a summary' })
      }
    }
  })

  return router
}
