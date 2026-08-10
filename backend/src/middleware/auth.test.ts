import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

const mockVerifyIdToken = vi.fn()
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}))

import { authMiddleware } from './auth'

const app = express()
app.get('/test', authMiddleware, (_req, res) => res.json({ ok: true }))

describe('authMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ALLOWED_EMAILS = 'owner@example.com'
  })

  it('returns 401 when Authorization header is missing', async () => {
    const res = await request(app).get('/test')
    expect(res.status).toBe(401)
  })

  it('returns 401 when token verification fails', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('Invalid token'))
    const res = await request(app).get('/test').set('Authorization', 'Bearer bad-token')
    expect(res.status).toBe(401)
  })

  it('returns 401 when email is not in the allowlist', async () => {
    mockVerifyIdToken.mockResolvedValue({ email: 'other@example.com' })
    const res = await request(app).get('/test').set('Authorization', 'Bearer valid-token')
    expect(res.status).toBe(401)
  })

  it('returns 401 when the token has no email claim', async () => {
    mockVerifyIdToken.mockResolvedValue({ email: undefined })
    const res = await request(app).get('/test').set('Authorization', 'Bearer valid-token')
    expect(res.status).toBe(401)
  })

  it('returns 401 when the email is not verified', async () => {
    mockVerifyIdToken.mockResolvedValue({ email: 'owner@example.com', email_verified: false })
    const res = await request(app).get('/test').set('Authorization', 'Bearer valid-token')
    expect(res.status).toBe(401)
  })

  it('calls next when the token is valid, verified, and the email is allowed', async () => {
    mockVerifyIdToken.mockResolvedValue({ email: 'owner@example.com', email_verified: true })
    const res = await request(app).get('/test').set('Authorization', 'Bearer valid-token')
    expect(res.status).toBe(200)
  })

  it('accepts case and whitespace variations in the configured address', async () => {
    process.env.ALLOWED_EMAILS = ' Owner@Example.com '
    mockVerifyIdToken.mockResolvedValue({ email: 'OWNER@example.com', email_verified: true })
    const res = await request(app).get('/test').set('Authorization', 'Bearer valid-token')
    expect(res.status).toBe(200)
  })
})
