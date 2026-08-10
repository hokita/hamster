import { describe, it, expect } from 'vitest'
import { formatRelativeTime } from './relativeTime'

describe('formatRelativeTime', () => {
  const now = new Date('2026-08-10T12:00:00.000Z')

  it('returns "just now" for under a minute', () => {
    const createdAt = new Date(now.getTime() - 59_000).toISOString()
    expect(formatRelativeTime(createdAt, now)).toBe('just now')
  })

  it('returns minutes for exactly 60 seconds ago', () => {
    const createdAt = new Date(now.getTime() - 60_000).toISOString()
    expect(formatRelativeTime(createdAt, now)).toBe('1m ago')
  })

  it('returns minutes for 59 minutes ago', () => {
    const createdAt = new Date(now.getTime() - 59 * 60_000).toISOString()
    expect(formatRelativeTime(createdAt, now)).toBe('59m ago')
  })

  it('returns hours for exactly 60 minutes ago', () => {
    const createdAt = new Date(now.getTime() - 60 * 60_000).toISOString()
    expect(formatRelativeTime(createdAt, now)).toBe('1h ago')
  })

  it('returns hours for 23 hours ago', () => {
    const createdAt = new Date(now.getTime() - 23 * 60 * 60_000).toISOString()
    expect(formatRelativeTime(createdAt, now)).toBe('23h ago')
  })

  it('returns days for exactly 24 hours ago', () => {
    const createdAt = new Date(now.getTime() - 24 * 60 * 60_000).toISOString()
    expect(formatRelativeTime(createdAt, now)).toBe('1d ago')
  })

  it('returns days for 6 days ago', () => {
    const createdAt = new Date(now.getTime() - 6 * 24 * 60 * 60_000).toISOString()
    expect(formatRelativeTime(createdAt, now)).toBe('6d ago')
  })

  it('returns an absolute date without year for exactly 7 days ago in the same year', () => {
    const createdAt = new Date(now.getTime() - 7 * 24 * 60 * 60_000).toISOString()
    expect(formatRelativeTime(createdAt, now)).toBe('Aug 3')
  })

  it('returns an absolute date with year when the date is in a previous year', () => {
    const createdAt = new Date('2025-01-15T12:00:00.000Z').toISOString()
    expect(formatRelativeTime(createdAt, now)).toBe('Jan 15, 2025')
  })
})
