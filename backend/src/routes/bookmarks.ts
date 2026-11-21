import { Router } from 'express'
import type { Request, Response } from 'express'
import * as db from '../services/firestore'
import type { BookmarkDoc } from '../services/firestore'
import { fetchMetadata } from '../services/metadataFetcher'
import { fetchArticleText } from '../services/articleFetcher'
import { parseYouTubeVideoId, isYouTubeSummariesEnabled } from '../services/youtube'
import { fetchYouTubeTitle, YOUTUBE_FAVICON_URL } from '../services/youtubeOembed'
import {
  createSummaryGenerator,
  describeSummaryFailure,
  RUNNING_ELSEWHERE,
} from '../services/summaryGeneration'
import type { SummaryGenerator } from '../services/summaryGeneration'
import { answerQuestion, isChatConfigured, ChatUnavailableError } from '../services/articleChat'
import type { ChatMessage } from '../services/articleChat'
import {
  translate,
  isTranslatorConfigured,
  TranslatorUnavailableError,
} from '../services/translator'

// The video id is derived from the url on every read rather than stored, so it can never disagree
// with the url and needs no migration for existing bookmarks. The key is left out entirely for a
// non-video bookmark, rather than set to undefined or null.
function withVideoId(bookmark: BookmarkDoc): BookmarkDoc & { videoId?: string } {
  const videoId = parseYouTubeVideoId(bookmark.url)
  return videoId ? { ...bookmark, videoId } : bookmark
}

export function createBookmarksRouter({
  summaries = createSummaryGenerator(),
}: { summaries?: SummaryGenerator } = {}): Router {
  const router = Router()

  router.get('/', async (_req: Request, res: Response) => {
    try {
      const bookmarks = await db.listBookmarks()
      res.json(bookmarks.map(withVideoId))
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
      // Independent of YOUTUBE_SUMMARIES: the oEmbed title is wanted whether or not videos are
      // summarized. A failed oEmbed falls through to the ordinary metadata fetch.
      const videoId = parseYouTubeVideoId(url)
      const videoTitle = videoId ? await fetchYouTubeTitle(videoId) : null
      const { title, faviconUrl } = videoTitle
        ? { title: videoTitle, faviconUrl: YOUTUBE_FAVICON_URL }
        : await fetchMetadata(url)
      const bookmark = await db.createBookmark(url, title ?? url, faviconUrl)
      res.status(201).json(withVideoId(bookmark))
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
      res.json(withVideoId(bookmark))
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

    let generation = summaries.join(bookmark.id)
    if (!generation) {
      if (summaries.isRunningElsewhere(bookmark)) {
        res.status(RUNNING_ELSEWHERE.httpStatus).json(RUNNING_ELSEWHERE.body)
        return
      }
      generation = summaries.start(bookmark)
    }

    try {
      const { summary, shortSummary, labels } = await generation
      res.json({
        summary,
        ...(shortSummary ? { shortSummary } : {}),
        ...(labels ? { labels } : {}),
      })
    } catch (error) {
      // Every response body below is deliberately vague — the client has no use for the internals
      // and they must not leak to it. That left a failed summary with no trace anywhere but a bare
      // status code in the Cloud Run request log. Log the real cause here, tagged with the bookmark
      // id, so the next failure is one log query rather than a bisect across revisions.
      console.error(`summary generation failed for bookmark ${bookmark.id}:`, error)
      const { httpStatus, body } = describeSummaryFailure(error)
      res.status(httpStatus).json(body)
    }
  })

  // Translates the summary this bookmark already has into Japanese, for a reader who would rather
  // not read the English one. Like the chat, the result is not persisted: it is returned and lives
  // on the page for the visit, so a regenerated summary can never be left with a stale Japanese
  // version stored beside it.
  //
  // The summary is read here rather than sent in the body. The client has the text already, so a
  // body would be less work — but it would also let any caller push arbitrary text into a paid
  // Gemini call, and this way the translation is always of what the app actually stored.
  //
  // No in-flight dedup map either, unlike the summary route: nothing triggers this automatically,
  // so there is no second request seconds behind the first to collide with — only a reader
  // clicking a button that disables itself while it runs.
  router.post('/:id/translation', async (req: Request, res: Response) => {
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
    if (!bookmark.summary) {
      // Not a 404: the bookmark exists, it is just not in a state this endpoint can act on. The
      // caller's fix is to generate a summary first, not to stop asking about this id.
      res.status(409).json({ error: 'Bookmark has no summary to translate' })
      return
    }

    // Same early exit as the summary and chat routes: without a key the request can never succeed,
    // and the deterministic 503 is more useful than a 502 from a call that was never going to work.
    if (!isTranslatorConfigured()) {
      res.status(503).json({ error: 'Translation is not configured' })
      return
    }

    try {
      const translation = await translate(bookmark.summary)
      // The summary that was translated rides along with the translation. The client asked for
      // "the stored summary" without saying which text that was, and the two can disagree: a
      // regeneration elsewhere between the client's last read and this one leaves it holding
      // older English than the Japanese coming back. Saying which text this is lets the page
      // put the matching English beside it rather than pairing a translation with the wrong original.
      //
      // The labels read in the same breath ride along for the same reason: a page adopting that
      // summary has to replace the chips beside it in the same step, or it shows fresh text under
      // topics generated for what came before — and it would keep showing them, because a bookmark
      // with a summary and labels is exactly what stops the page polling for changes. Omitted for
      // a bookmark that has none, same shape as the summary route's response.
      res.json(
        bookmark.labels
          ? { translation, source: bookmark.summary, labels: bookmark.labels }
          : { translation, source: bookmark.summary }
      )
    } catch (error) {
      // Vague body, logged cause — same contract as the summary and chat routes, for the same
      // reason: the client has no use for the internals and they must not leak to it.
      console.error(`translation failed for bookmark ${bookmark.id}:`, error)
      if (error instanceof TranslatorUnavailableError) {
        res.status(503).json({ error: 'Translation is not configured' })
      } else {
        res.status(502).json({ error: 'Failed to translate the summary' })
      }
    }
  })

  // The chat is not persisted, so the client sends the whole conversation each time and this
  // endpoint stays stateless — no cache to invalidate, and it works the same across Cloud Run
  // instances. The article is refetched per question; an 8s fetch plus one Flash call per
  // question is a fine price for a single-user app. A video is never refetched or re-sent to
  // Gemini: the chat answers from the transcript stored when it was summarized.
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

    const isVideo = isYouTubeSummariesEnabled() && parseYouTubeVideoId(bookmark.url) !== null
    let text: string | null
    try {
      text = isVideo ? await db.getTranscript(bookmark.id) : await fetchArticleText(bookmark.url)
    } catch {
      text = null
    }
    try {
      const answer = isVideo
        ? await answerQuestion(bookmark.title, text, messages, 'video')
        : await answerQuestion(bookmark.title, text, messages)
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
