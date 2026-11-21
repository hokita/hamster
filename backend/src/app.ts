import express from 'express'
import cors from 'cors'
import { authMiddleware } from './middleware/auth'
import { apiTokenAuth, apiTokenMatcher } from './middleware/apiToken'
import { createRateLimiter } from './middleware/rateLimit'
import { createBookmarksRouter } from './routes/bookmarks'
import { createMcpRequestHandler } from './mcp/server'
import { createSummaryGenerator } from './services/summaryGeneration'
import { takeSummarySlot } from './services/firestore'

const MCP_CALLS_PER_HOUR = 60

export function createApp() {
  const app = express()
  // The cors package does NOT default to "allow all" when origin is undefined — it emits
  // no CORS headers at all, which silently blocks every cross-origin request. Default to
  // '*' explicitly so dev (FRONTEND_URL unset) actually allows all origins as intended.
  app.use(cors({ origin: process.env.FRONTEND_URL || '*' }))
  app.use(express.json())
  app.get('/health', (_req, res) => res.json({ ok: true }))
  const summaries = createSummaryGenerator()
  const limiter = createRateLimiter({ limit: MCP_CALLS_PER_HOUR, windowMs: 3_600_000 })
  app.use('/api/bookmarks', authMiddleware, createBookmarksRouter({ summaries }))
  app.all(
    '/mcp',
    apiTokenAuth({ matches: apiTokenMatcher(process.env.HAMSTER_MCP_TOKEN) }),
    createMcpRequestHandler({
      limiter,
      summaries,
      takeSummarySlot,
    })
  )
  return app
}
