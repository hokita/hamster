import { describe, it, expect } from 'vitest'
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
