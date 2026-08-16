import { Router } from 'express'
import type { Request, Response } from 'express'
import * as db from '../services/firestore'
import type { BookmarkDoc } from '../services/firestore'
import { fetchMetadata } from '../services/metadataFetcher'
import { fetchArticleText } from '../services/articleFetcher'
import { summarize, isSummarizerConfigured, SummarizerUnavailableError } from '../services/summarizer'
import { generateLabels } from '../services/labeler'
import { answerQuestion, isChatConfigured, ChatUnavailableError } from '../services/articleChat'
import type { ChatMessage } from '../services/articleChat'

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
  const inFlight = new Map<string, Promise<{ summary: string; labels: string[] | null }>>()

  function generateSummary(
    bookmark: BookmarkDoc
  ): Promise<{ summary: string; labels: string[] | null }> {
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

      // Labels are strictly best-effort: generated after the summary is stored so a labels
      // failure can never cost the already-paid summary, and swallowed so the endpoint's
      // contract doesn't change. The existing-labels list feeds the "prefer reusing labels"
      // instruction; failures here are logged with the bookmark id, same as summary failures.
      let labels: string[] | null = null
      try {
        const existingLabels = await db.listAllLabels()
        const generatedLabels = await generateLabels(bookmark.title, text, existingLabels)
        await db.updateLabels(bookmark.id, generatedLabels)
        labels = generatedLabels
      } catch (error) {
        console.error(`label generation failed for bookmark ${bookmark.id}:`, error)
      }

      return { summary, labels }
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

  // Deliberately idempotent: no existence check before the write. Firestore's delete() resolves
  // for a document that is already gone, and a DELETE for an id the user has just removed — a
  // stale list row, a double click, a retried request — asks for a state that already holds, so
  // answering 404 would report a failure the caller has no way to act on. It also keeps this to a
  // single write rather than a read plus a write with a window in between.
  //
  // A summary generation still in flight for this id keeps running and then fails its own write:
  // updateSummary uses update(), which rejects on a missing document instead of recreating the
  // bookmark that was just deleted.
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      await db.deleteBookmark(req.params.id)
      res.status(204).end()
    } catch {
      res.status(500).json({ error: 'Failed to delete bookmark' })
    }
  })

  // PUT, not PATCH: the body carries this sub-resource's entire state, so repeating the request
  // is a no-op. That matters for a control the user taps — a double click, a retried request
  // after a dropped response, or the list and the bookmark's own page both settling their own
  // toggle — none of which may flip the flag a second time. The desired state is sent explicitly
  // for the same reason: a "toggle" endpoint would make the result depend on how many times the
  // request arrived.
  router.put('/:id/read', async (req: Request, res: Response) => {
    const { isRead } = req.body as { isRead?: unknown }
    if (typeof isRead !== 'boolean') {
      res.status(400).json({ error: 'isRead must be a boolean' })
      return
    }
    try {
      const updated = await db.setReadState(req.params.id, isRead)
      if (!updated) {
        // Unlike DELETE above, a missing bookmark here is a real failure rather than a state that
        // already holds: the caller asked to record something about a bookmark that is gone, and
        // answering 204 would tell it a flag was stored when none was.
        res.status(404).json({ error: 'Bookmark not found' })
        return
      }
      res.status(204).end()
    } catch {
      res.status(500).json({ error: 'Failed to update the read state' })
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
      const { summary, labels } = await generation
      res.json(labels ? { summary, labels } : { summary })
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

  // The chat is not persisted, so the client sends the whole conversation each time and this
  // endpoint stays stateless — no cache to invalidate, and it works the same across Cloud Run
  // instances. The article is refetched per question; an 8s fetch plus one Flash call per
  // question is a fine price for a single-user app.
  router.post('/:id/chat', async (req: Request, res: Response) => {
    const messages = parseChatMessages(req.body)
    if (!messages) {
      res.status(400).json({ error: 'messages must be a non-empty list of chat turns' })
      return
    }

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

    // Same reasoning as the summary route: without a key the request can never succeed, so
    // checking before the article fetch avoids burning up to 8 seconds on it and keeps the
    // deterministic 503 from turning into a misleading 502 when the page is also unreachable.
    if (!isChatConfigured()) {
      res.status(503).json({ error: 'Chat is not configured' })
      return
    }

    let text: string | null
    try {
      text = await fetchArticleText(bookmark.url)
    } catch {
      text = null
    }
    if (!text) {
      res.status(502).json({ error: 'Could not read the linked page' })
      return
    }

    try {
      const answer = await answerQuestion(bookmark.title, text, messages)
      res.json({ answer })
    } catch (error) {
      // Vague bodies, logged cause — same contract as the summary route, for the same reason.
      console.error(`chat answer failed for bookmark ${bookmark.id}:`, error)
      if (error instanceof ChatUnavailableError) {
        res.status(503).json({ error: 'Chat is not configured' })
      } else {
        res.status(502).json({ error: 'Failed to answer the question' })
      }
    }
  })

  return router
}

// Bounds generous enough that a real conversation never hits them; what they rule out is a
// runaway or hostile client streaming unbounded payload into a paid Gemini call (express.json()'s
// 100kb body limit already bounds the total — these keep any single turn sane).
//
// The caps differ by role: a user turn is a typed question, but a model turn is a stored answer
// coming back as history, and the answer budget is 8192 output tokens — around 33k chars of
// English at the worst. Holding model turns to the user cap wedged real conversations: one long
// answer and every follow-up was rejected for resending it.
const MAX_CHAT_MESSAGES = 40
const MAX_CHAT_USER_MESSAGE_CHARS = 4000
const MAX_CHAT_MODEL_MESSAGE_CHARS = 40_000

// Returns the validated conversation, or null when the body is not one. Roles must alternate
// starting from a user turn — Gemini rejects consecutive same-role turns, and catching the shape
// here answers 400 instead of fetching the article and surfacing that rejection as a 502 — and
// the last turn must also be the user's: this endpoint answers a pending question, and a history
// ending in a model turn has none.
function parseChatMessages(body: unknown): ChatMessage[] | null {
  if (typeof body !== 'object' || body === null) return null
  const { messages } = body as { messages?: unknown }
  if (!Array.isArray(messages) || messages.length === 0) return null
  if (messages.length > MAX_CHAT_MESSAGES) return null
  for (const [index, message] of messages.entries()) {
    if (typeof message !== 'object' || message === null) return null
    const { role, text } = message as { role?: unknown; text?: unknown }
    if (role !== (index % 2 === 0 ? 'user' : 'model')) return null
    if (typeof text !== 'string' || !text.trim()) return null
    const maxChars = role === 'model' ? MAX_CHAT_MODEL_MESSAGE_CHARS : MAX_CHAT_USER_MESSAGE_CHARS
    if (text.length > maxChars) return null
  }
  const last = messages[messages.length - 1] as ChatMessage
  if (last.role !== 'user') return null
  return messages as ChatMessage[]
}
