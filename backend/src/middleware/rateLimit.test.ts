import { describe, it, expect } from 'vitest'
import { createRateLimiter } from './rateLimit'

describe('createRateLimiter', () => {
  it('allows up to the limit within the window, then refuses', () => {
    let now = 0
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000, now: () => now })
    expect(limiter.take()).toEqual({ ok: true })
    expect(limiter.take()).toEqual({ ok: true })
    now = 400
    expect(limiter.take()).toEqual({ ok: true })
    expect(limiter.take()).toEqual({ ok: false, retryAfterSeconds: 1 })
  })

  it('frees a slot once the oldest request leaves the rolling window', () => {
    let now = 0
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, now: () => now })
    limiter.take()
    now = 30_000
    limiter.take()
    expect(limiter.take()).toEqual({ ok: false, retryAfterSeconds: 30 })
    now = 60_000
    expect(limiter.take()).toEqual({ ok: true })
    expect(limiter.take()).toEqual({ ok: false, retryAfterSeconds: 30 })
  })

  it('does not count refused requests', () => {
    let now = 0
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => now })
    limiter.take()
    now = 500
    limiter.take()
    limiter.take()
    now = 1000
    expect(limiter.take()).toEqual({ ok: true })
  })
})
