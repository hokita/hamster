import { Router } from 'express'
import type { Request, Response } from 'express'
import * as db from '../services/firestore'
import { fetchMetadata } from '../services/metadataFetcher'
import { fetchArticleText } from '../services/articleFetcher'
import { summarize, SummarizerUnavailableError } from '../services/summarizer'

export function createBookmarksRouter(): Router {
  const router = Router()

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

    const text = await fetchArticleText(bookmark.url)
    if (!text) {
      res.status(502).json({ error: 'Could not read the linked page' })
      return
    }

    let summary: string
    try {
      summary = await summarize(bookmark.title, text)
    } catch (error) {
      if (error instanceof SummarizerUnavailableError) {
        res.status(503).json({ error: 'Summarization is not configured' })
        return
      }
      res.status(502).json({ error: 'Failed to generate a summary' })
      return
    }

    try {
      await db.updateSummary(bookmark.id, summary)
    } catch {
      res.status(500).json({ error: 'Failed to save the summary' })
      return
    }
    res.json({ summary })
  })

  return router
}
