import { Router } from 'express'
import type { Request, Response } from 'express'
import * as db from '../services/firestore'
import type { BookmarkDoc, VideoSummaryCode } from '../services/firestore'
import { fetchMetadata } from '../services/metadataFetcher'
import { fetchArticleText } from '../services/articleFetcher'
import { parseYouTubeVideoId, isYouTubeSummariesEnabled } from '../services/youtube'
import { checkVideo } from '../services/youtubeDataApi'
import type { VideoCheck } from '../services/youtubeDataApi'
import { watchVideo, VideoUnwatchableError, VideoNoContentError } from '../services/videoSummarizer'
import { fetchYouTubeTitle, YOUTUBE_FAVICON_URL } from '../services/youtubeOembed'
import {
  summarize,
  isSummarizerConfigured,
  SummarizerUnavailableError,
} from '../services/summarizer'
import { generateLabels } from '../services/labeler'
import { summarizeShort } from '../services/shortSummarizer'
import { answerQuestion, isChatConfigured, ChatUnavailableError } from '../services/articleChat'
import type { ChatMessage } from '../services/articleChat'
import {
  translate,
  isTranslatorConfigured,
  TranslatorUnavailableError,
} from '../services/translator'

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

// Thrown when a video can't be summarized for a reason the user can act on or should be told
// about: too long, private, live, no speech, or its length couldn't be checked. It carries a
// machine-readable code the bookmark page turns into a specific message, where every other failure
// collapses to "Couldn't generate a summary." The text sent with it stays as vague as the rest.
class VideoSummaryError extends Error {
  constructor(
    readonly code: Exclude<VideoSummaryCode, 'generic'> | 'video_summary_running',
    readonly httpStatus: 409 | 422 | 502
  ) {
    super(`video summary refused: ${code}`)
  }
}

// Each free-check refusal, mapped to the status it answers with. Too long, private and live are
// facts about the video (422); an unknown length is our failure to check, so it is a 502.
const REFUSALS: Record<
  Exclude<VideoCheck['kind'], 'ok'>,
  { code: Exclude<VideoSummaryCode, 'generic'>; httpStatus: 422 | 502 }
> = {
  too_long: { code: 'video_too_long', httpStatus: 422 },
  unavailable: { code: 'video_unavailable', httpStatus: 422 },
  live: { code: 'video_live', httpStatus: 422 },
  unknown: { code: 'video_length_unknown', httpStatus: 502 },
}

// The text stays vague like every other summary error body; the code is what the page acts on.
function sendVideoSummaryError(res: Response, error: VideoSummaryError): void {
  res.status(error.httpStatus).json({
    error:
      error.code === 'video_summary_running'
        ? 'A summary for this video is already being generated'
        : 'Could not summarize this video',
    code: error.code,
  })
}

// A running state older than this outlived the watch's 480 s timeout plus margin: the instance
// that wrote it died or was redeployed, so it no longer stands for a generation anyone is waiting on.
const RUNNING_STALE_MS = 660_000

function isFreshRunning(bookmark: BookmarkDoc): boolean {
  const state = bookmark.videoSummaryState
  return state?.status === 'running' && Date.now() - Date.parse(state.updatedAt) < RUNNING_STALE_MS
}

// The video id is derived from the url on every read rather than stored, so it can never disagree
// with the url and needs no migration for existing bookmarks. The key is left out entirely for a
// non-video bookmark, rather than set to undefined or null.
function withVideoId(bookmark: BookmarkDoc): BookmarkDoc & { videoId?: string } {
  const videoId = parseYouTubeVideoId(bookmark.url)
  return videoId ? { ...bookmark, videoId } : bookmark
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
  const inFlight = new Map<
    string,
    Promise<{ summary: string; shortSummary?: string; labels: string[] | null }>
  >()

  function generateSummary(
    bookmark: BookmarkDoc
  ): Promise<{ summary: string; shortSummary?: string; labels: string[] | null }> {
    // With the kill switch off, a YouTube link is summarized from its page exactly as before. The
    // video branch is a separate function so the article path below stays as it was.
    const videoId = isYouTubeSummariesEnabled() ? parseYouTubeVideoId(bookmark.url) : null
    const generation = (async () => {
      if (videoId) return generateVideoSummary(bookmark, videoId)

      // Check configuration before doing any network work. Without a key the request can never
      // succeed, so fetching the article first only burns up to 8 seconds and bandwidth on a
      // request that was always going to fail — and, worse, it turns a deterministic 503 into a
      // misleading 502 whenever the page also happens to be unreachable, blocked, or non-HTML.
      if (!isSummarizerConfigured()) throw new SummarizerUnavailableError()

      const text = await fetchArticleText(bookmark.url)
      if (!text) throw new ArticleUnreadableError()

      const summary = await summarize(bookmark.title, text)
      // The detailed summary decides the article language once. Condense its full substance
      // with an explicit language constraint, rather than letting another model guess anew.
      let shortSummary: string | undefined
      try {
        shortSummary = await summarizeShort(bookmark.title, summary)
      } catch (error) {
        console.error(`short summary generation failed for bookmark ${bookmark.id}:`, error)
      }

      try {
        await db.updateSummary(bookmark.id, summary, shortSummary)
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

      return { summary, shortSummary, labels }
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

  type Generated = { summary: string; shortSummary?: string; labels: string[] | null }

  // A video generation takes minutes, so its progress and outcome are stored on the bookmark for
  // the page to poll and to show after a reload. That record is a courtesy, never the result: a
  // failed write is logged and swallowed so it can't replace the real outcome, which the waiting
  // request still answers with. (setVideoSummaryState already ignores a bookmark deleted mid-run.)
  async function writeVideoState(
    id: string,
    state: { status: 'running' } | { status: 'failed'; code: VideoSummaryCode }
  ): Promise<void> {
    try {
      await db.setVideoSummaryState(id, state)
    } catch (error) {
      console.error(`video summary state write failed for bookmark ${id}:`, error)
    }
  }

  // Same best-effort contract as the article path's short summary.
  async function shortSummaryOf(id: string, title: string, summary: string) {
    try {
      return await summarizeShort(title, summary)
    } catch (error) {
      console.error(`short summary generation failed for bookmark ${id}:`, error)
      return undefined
    }
  }

  // Same best-effort contract as the article path's labels. The summary goes first: the labeler
  // reads only the first 20k chars, about 25 minutes of a talk, and the summary covers all of it.
  async function labelVideo(id: string, title: string, summary: string, transcript: string) {
    try {
      const existingLabels = await db.listAllLabels()
      const labels = await generateLabels(
        title,
        `${summary}\n\n${transcript}`,
        existingLabels,
        'video'
      )
      await db.updateLabels(id, labels)
      return labels
    } catch (error) {
      console.error(`label generation failed for bookmark ${id}:`, error)
      return null
    }
  }

  async function generateVideoSummary(bookmark: BookmarkDoc, videoId: string): Promise<Generated> {
    if (!isSummarizerConfigured()) throw new SummarizerUnavailableError()

    // Watch once: with a transcript stored, a regenerate is an ordinary text summary of it, the
    // same fast call an article gets. No video is sent and the Data API isn't asked again, and no
    // running state is written because there is no long wait for the page to poll through.
    const transcript = await db.getTranscript(bookmark.id)
    if (transcript !== null) return summarizeTranscript(bookmark, transcript)

    // The free checks come before anything paid. A refusal is stored too, so the page can show
    // why without regenerating.
    const check = await checkVideo(videoId)
    if (check.kind !== 'ok') {
      const { code, httpStatus } = REFUSALS[check.kind]
      await writeVideoState(bookmark.id, { status: 'failed', code })
      throw new VideoSummaryError(code, httpStatus)
    }

    await writeVideoState(bookmark.id, { status: 'running' })
    const title = check.title ?? bookmark.title
    let watched
    try {
      watched = await watchVideo(videoId, title, check.durationSeconds)
    } catch (error) {
      // Rethrown as is, not wrapped, so the route's failure log names the real cause; the route
      // maps these two classes to their codes.
      const code: VideoSummaryCode =
        error instanceof VideoUnwatchableError
          ? 'video_unavailable'
          : error instanceof VideoNoContentError
            ? 'video_no_content'
            : 'generic'
      await writeVideoState(bookmark.id, { status: 'failed', code })
      throw error
    }
    // Numbers only, so the real cost per video can be read from the logs. Never the text.
    console.log(`video summary watched for bookmark ${bookmark.id}:`, {
      videoId,
      latencyMs: watched.latencyMs,
      finishReason: watched.finishReason,
      usage: watched.usage,
    })

    const shortSummary = await shortSummaryOf(bookmark.id, title, watched.summary)

    // A bookmark saved with its url as the title (oEmbed and the page both failed) gets the real
    // title now that the Data API has given one. A real title is never overwritten.
    const repairTitle = bookmark.title === bookmark.url && check.title !== null
    try {
      await db.saveVideoSummary(bookmark.id, {
        videoId,
        transcript: watched.transcript,
        summary: watched.summary,
        shortSummary,
        ...(repairTitle ? { title } : {}),
      })
    } catch (error) {
      await writeVideoState(bookmark.id, { status: 'failed', code: 'generic' })
      throw new SummaryStorageError(error)
    }

    const labels = await labelVideo(bookmark.id, title, watched.summary, watched.transcript)
    return { summary: watched.summary, shortSummary, labels }
  }

  async function summarizeTranscript(
    bookmark: BookmarkDoc,
    transcript: string
  ): Promise<Generated> {
    const summary = await summarize(bookmark.title, transcript, 'video')
    const shortSummary = await shortSummaryOf(bookmark.id, bookmark.title, summary)
    try {
      await db.updateSummary(bookmark.id, summary, shortSummary)
    } catch (error) {
      throw new SummaryStorageError(error)
    }
    const labels = await labelVideo(bookmark.id, bookmark.title, summary, transcript)
    return { summary, shortSummary, labels }
  }

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

    let generation = inFlight.get(bookmark.id)
    if (!generation) {
      // A fresh running state with nothing in flight here means another instance is watching the
      // video right now. Joining it isn't possible across instances, and starting a second watch
      // would pay for the video twice, so the page is told to keep polling instead. A generation
      // in flight on this instance is joined above as usual, running state or not.
      if (
        isYouTubeSummariesEnabled() &&
        parseYouTubeVideoId(bookmark.url) &&
        isFreshRunning(bookmark)
      ) {
        sendVideoSummaryError(res, new VideoSummaryError('video_summary_running', 409))
        return
      }
      generation = generateSummary(bookmark)
      inFlight.set(bookmark.id, generation)
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
      if (error instanceof VideoSummaryError) {
        sendVideoSummaryError(res, error)
      } else if (error instanceof VideoUnwatchableError) {
        sendVideoSummaryError(res, new VideoSummaryError('video_unavailable', 502))
      } else if (error instanceof VideoNoContentError) {
        sendVideoSummaryError(res, new VideoSummaryError('video_no_content', 422))
      } else if (error instanceof SummarizerUnavailableError) {
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
