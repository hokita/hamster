import { describe, it, expect } from 'vitest'
import { findBookmarks, findSavedLink } from './bookmarkSearch'
import type { BookmarkDoc } from './firestore'

function bookmark(overrides: Partial<BookmarkDoc> = {}): BookmarkDoc {
  return {
    id: 'b1',
    url: 'https://example.com/a',
    title: 'A title',
    isRead: false,
    createdAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('findBookmarks', () => {
  it('matches every word across title, url, labels and both summaries', () => {
    const all = [
      bookmark({
        id: 'hit',
        title: 'Rust ownership',
        url: 'https://borrow.example/guide',
        labels: ['systems'],
        shortSummary: 'about lifetimes',
        summary: 'a deep dive into moves',
      }),
      bookmark({ id: 'miss', title: 'Rust ownership' }),
    ]
    const result = findBookmarks(all, { query: 'rust borrow systems lifetimes moves' })
    expect(result.bookmarks.map((b) => b.id)).toEqual(['hit'])
  })

  it('matches Japanese and full-width text', () => {
    const all = [bookmark({ id: 'jp', title: 'AIの話', summary: '長い要約です' })]
    expect(findBookmarks(all, { query: 'ＡＩ　要約' }).bookmarks.map((b) => b.id)).toEqual(['jp'])
  })

  it('filters by label case-insensitively and by unread true/false', () => {
    const all = [
      bookmark({ id: 'a', labels: ['News'], isRead: false }),
      bookmark({ id: 'b', labels: ['news'], isRead: true }),
      bookmark({ id: 'c', labels: ['other'], isRead: false }),
    ]
    const ids = (f: Parameters<typeof findBookmarks>[1]) =>
      findBookmarks(all, f).bookmarks.map((b) => b.id)
    expect(ids({ label: 'NEWS' })).toEqual(['a', 'b'])
    expect(ids({ unread: true })).toEqual(['a', 'c'])
    expect(ids({ unread: false })).toEqual(['b'])
    expect(ids({ label: 'news', unread: true })).toEqual(['a'])
  })

  it('pages with limit and offset and reports total and nextOffset', () => {
    const all = Array.from({ length: 45 }, (_, i) => bookmark({ id: `b${i}` }))
    const first = findBookmarks(all, { limit: 20 })
    expect(first).toMatchObject({ total: 45, offset: 0, nextOffset: 20 })
    expect(first.bookmarks).toHaveLength(20)
    const last = findBookmarks(all, { limit: 20, offset: 40 })
    expect(last.bookmarks).toHaveLength(5)
    expect(last.total).toBe(45)
    expect(last).not.toHaveProperty('nextOffset')
  })

  it('clamps limit to 1–50 and leaves out the full summary', () => {
    const all = Array.from({ length: 500 }, (_, i) =>
      bookmark({ id: `b${i}`, summary: 'x'.repeat(5000), shortSummary: 'short' })
    )
    const result = findBookmarks(all, { limit: 999 })
    expect(result.bookmarks).toHaveLength(50)
    expect(result.bookmarks.every((b) => !('summary' in b))).toBe(true)
    expect(result.bookmarks[0]).toMatchObject({ hasSummary: true, shortSummary: 'short' })
    expect(findBookmarks(all, { limit: 0 }).bookmarks).toHaveLength(1)
  })
})

describe('findSavedLink', () => {
  it('matches the same trimmed url', () => {
    const saved = bookmark({ id: 'saved', url: 'https://example.com/a' })
    expect(
      findSavedLink(
        [bookmark({ id: 'other', url: 'https://x.com/' }), saved],
        '  https://example.com/a \n'
      )
    ).toBe(saved)
  })

  it('matches youtu.be and watch?v= for one video', () => {
    const saved = bookmark({ id: 'yt', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })
    expect(findSavedLink([saved], 'https://youtu.be/dQw4w9WgXcQ')).toBe(saved)
    expect(
      findSavedLink([bookmark({ url: 'https://youtu.be/dQw4w9WgXcQ' })], saved.url)
    ).toBeDefined()
    expect(findSavedLink([saved], 'https://youtu.be/aaaaaaaaaaa')).toBeUndefined()
  })

  it('does not match a different path or query', () => {
    const all = [bookmark({ url: 'https://example.com/a?x=1' })]
    expect(findSavedLink(all, 'https://example.com/b?x=1')).toBeUndefined()
    expect(findSavedLink(all, 'https://example.com/a?x=2')).toBeUndefined()
    expect(findSavedLink(all, 'https://example.com/a')).toBeUndefined()
  })
})
