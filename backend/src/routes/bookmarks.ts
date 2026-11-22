import { Router } from 'express'
import type { Request, Response } from 'express'
import * as db from '../services/firestore'
import type { BookmarkDoc } from '../services/firestore'
import { fetchArticleText } from '../services/articleFetcher'
import { parseYouTubeVideoId, isYouTubeSummariesEnabled } from '../services/youtube'
import { saveBookmark } from '../services/bookmarkSave'
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
      const bookmark = await saveBookmark(url)
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

  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      await db.deleteBookmark(req.params.id)
      res.status(204).end()
    } catch {
      res.status(500).json({ error: 'Failed to delete bookmark' })
    }
  })

  router.put('/:id/read', async (req: Request, res: Response) => {
    const { isRead } = req.body as { isRead?: unknown }
    if (typeof isRead !== 'boolean') {
      res.status(400).json({ error: 'isRead must be a boolean' })
      return
    }
    try {
      const updated = await db.setReadState(req.params.id, isRead)
      if (!updated) {
        res.status(404).json({ error: 'Bookmark not found' })
        return
      }
      res.status(204).end()
    } catch {
      res.status(500).json({ error: 'Failed to update the read state' })
    }
  })

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
      console.error(`summary generation failed for bookmark ${bookmark.id}:`, error)
      const { httpStatus, body } = describeSummaryFailure(error)
      res.status(httpStatus).json(body)
    }
  })

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
      res.status(409).json({ error: 'Bookmark has no summary to translate' })
      return
    }

    if (!isTranslatorConfigured()) {
      res.status(503).json({ error: 'Translation is not configured' })
      return
    }

    try {
      const translation = await translate(bookmark.summary)
      res.json(
        bookmark.labels
          ? { translation, source: bookmark.summary, labels: bookmark.labels }
          : { translation, source: bookmark.summary }
      )
    } catch (error) {
      console.error(`translation failed for bookmark ${bookmark.id}:`, error)
      if (error instanceof TranslatorUnavailableError) {
        res.status(503).json({ error: 'Translation is not configured' })
      } else {
        res.status(502).json({ error: 'Failed to translate the summary' })
      }
    }
  })

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

const MAX_CHAT_MESSAGES = 40
const MAX_CHAT_USER_MESSAGE_CHARS = 4000
const MAX_CHAT_MODEL_MESSAGE_CHARS = 40_000

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
