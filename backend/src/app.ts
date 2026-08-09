import express from 'express'
import cors from 'cors'
import { authMiddleware } from './middleware/auth'
import { createBookmarksRouter } from './routes/bookmarks'

export function createApp() {
  const app = express()
  // The cors package does NOT default to "allow all" when origin is undefined — it emits
  // no CORS headers at all, which silently blocks every cross-origin request. Default to
  // '*' explicitly so dev (FRONTEND_URL unset) actually allows all origins as intended.
  app.use(cors({ origin: process.env.FRONTEND_URL || '*' }))
  app.use(express.json())
  app.get('/health', (_req, res) => res.json({ ok: true }))
  app.use('/api/bookmarks', authMiddleware, createBookmarksRouter())
  return app
}
