import { Router } from 'express'
import type { Request, Response } from 'express'
import * as db from '../services/firestore'

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
    const { url, title } = req.body as { url?: unknown; title?: unknown }
    if (typeof url !== 'string' || typeof title !== 'string' || !url || !title) {
      res.status(400).json({ error: 'url and title are required' })
      return
    }
    if (!/^https?:\/\//.test(url)) {
      res.status(400).json({ error: 'url must be an http(s) URL' })
      return
    }
    try {
      const bookmark = await db.createBookmark(url, title)
      res.status(201).json(bookmark)
    } catch {
      res.status(500).json({ error: 'Failed to create bookmark' })
    }
  })

  return router
}
