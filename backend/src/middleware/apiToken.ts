import { createHash, timingSafeEqual } from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'

const MIN_TOKEN_LENGTH = 43

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

export function apiTokenMatcher(
  configured: string | undefined
): ((token: string) => boolean) | null {
  const token = configured?.trim()
  if (!token) return null
  if (token.length < MIN_TOKEN_LENGTH) {
    console.warn(
      `HAMSTER_MCP_TOKEN is shorter than ${MIN_TOKEN_LENGTH} characters; API token auth is disabled`
    )
    return null
  }
  const expected = digest(token)
  return (candidate) => timingSafeEqual(digest(candidate), expected)
}

export function apiTokenAuth({ matches }: { matches: ((token: string) => boolean) | null }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = req.headers.authorization?.split('Bearer ')[1]
    if (!matches || !token || !matches(token)) {
      res.status(401).json({ error: 'Invalid token' })
      return
    }
    next()
  }
}
