import { describe, it, expect, afterEach } from 'vitest'
import request from 'supertest'
import { createApp } from './app'

describe('GET /health', () => {
  it('returns ok', async () => {
    const res = await request(createApp()).get('/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })
})

describe('GET /api/bookmarks', () => {
  it('requires authentication', async () => {
    const res = await request(createApp()).get('/api/bookmarks')
    expect(res.status).toBe(401)
  })
})

describe('CORS', () => {
  const originalFrontendUrl = process.env.FRONTEND_URL

  afterEach(() => {
    if (originalFrontendUrl === undefined) delete process.env.FRONTEND_URL
    else process.env.FRONTEND_URL = originalFrontendUrl
  })

  it('allows all origins when FRONTEND_URL is unset', async () => {
    delete process.env.FRONTEND_URL
    const res = await request(createApp()).get('/health')
    expect(res.headers['access-control-allow-origin']).toBe('*')
  })

  it('reflects FRONTEND_URL as the allowed origin when set', async () => {
    process.env.FRONTEND_URL = 'http://localhost:5173'
    const res = await request(createApp()).get('/health')
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173')
  })
})
