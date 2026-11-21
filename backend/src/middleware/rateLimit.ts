export interface RateLimiter {
  take(): { ok: true } | { ok: false; retryAfterSeconds: number }
}

// Rolling-window limiter kept in memory, so the limit is per Cloud Run
// instance — fine for a single owner (see the agent notes spec).
export function createRateLimiter({
  limit,
  windowMs,
  now = Date.now,
}: {
  limit: number
  windowMs: number
  now?: () => number
}): RateLimiter {
  const hits: number[] = []

  return {
    take() {
      const t = now()
      while (hits.length > 0 && hits[0] <= t - windowMs) hits.shift()
      if (hits.length >= limit) {
        return { ok: false, retryAfterSeconds: Math.ceil((hits[0] + windowMs - t) / 1000) }
      }
      hits.push(t)
      return { ok: true }
    },
  }
}
