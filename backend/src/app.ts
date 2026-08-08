import express from 'express'
import cors from 'cors'

export function createApp() {
  const app = express()
  // In dev (FRONTEND_URL unset), cors defaults to allow all origins — intentional for local development
  app.use(cors({ origin: process.env.FRONTEND_URL }))
  app.use(express.json())
  app.get('/health', (_req, res) => res.json({ ok: true }))
  return app
}
