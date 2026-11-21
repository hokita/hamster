import { createHash, timingSafeEqual } from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'

// 32 random bytes in base64url; `openssl rand -hex 32` (64 chars) is longer.
const MIN_TOKEN_LENGTH = 43

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

// Returns a constant-time matcher for the configured API token, or null when
// token auth is off (unset, or too short to be a real random token).
export function apiTokenMatcher(
  configured: string | undefined
): ((token: string) => boolean) | null {
  // A trailing newline from a secret store would otherwise make the token unmatchable.
  const token = configured?.trim()
  if (!token) return null
  if (token.length < MIN_TOKEN_LENGTH) {
    console.warn(
      `HAMSTER_MCP_TOKEN is shorter than ${MIN_TOKEN_LENGTH} characters; API token auth is disabled`
    )
    return null
  }
  // Comparing digests keeps both sides the same length, as timingSafeEqual requires.
  const expected = digest(token)
  return (candidate) => timingSafeEqual(digest(candidate), expected)
}

// For /mcp: the API token only, never a Firebase ID token. Not rate limited
// here; the MCP tools take from the limiter per tool call.
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
