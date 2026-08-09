import type { Request, Response, NextFunction } from 'express'
import { getAuth } from 'firebase-admin/auth'

function allowedEmails(): Set<string> {
  return new Set(
    (process.env.ALLOWED_EMAILS ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  )
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = req.headers.authorization?.split('Bearer ')[1]
  if (!token) {
    res.status(401).json({ error: 'Missing token' })
    return
  }
  try {
    const decoded = await getAuth().verifyIdToken(token)
    if (!decoded.email || !allowedEmails().has(decoded.email.toLowerCase())) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    next()
  } catch {
    res.status(401).json({ error: 'Invalid token' })
  }
}
