import type { BookmarkDoc } from './firestore'
import { parseYouTubeVideoId } from './youtube'

export const BOOKMARK_ID = /^[A-Za-z0-9_-]{1,64}$/

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

export type FindFilter = {
  query?: string
  label?: string
  unread?: boolean
  limit?: number
  offset?: number
}

export type BookmarkListItem = {
  id: string
  title: string
  url: string
  labels: string[]
  shortSummary?: string
  hasSummary: boolean
  isRead: boolean
  createdAt: string
  videoId?: string
}

export function normalize(text: string): string {
  return text.normalize('NFKC').toLowerCase()
}

export function toListItem(bookmark: BookmarkDoc): BookmarkListItem {
  const videoId = parseYouTubeVideoId(bookmark.url)
  return {
    id: bookmark.id,
    title: bookmark.title,
    url: bookmark.url,
    labels: bookmark.labels ?? [],
    ...(bookmark.shortSummary !== undefined && { shortSummary: bookmark.shortSummary }),
    hasSummary: Boolean(bookmark.summary),
    isRead: bookmark.isRead,
    createdAt: bookmark.createdAt,
    ...(videoId && { videoId }),
  }
}

export function findBookmarks(
  all: BookmarkDoc[],
  filter: FindFilter
): { total: number; offset: number; nextOffset?: number; bookmarks: BookmarkListItem[] } {
  const words = normalize(filter.query ?? '')
    .split(/\s+/u)
    .filter(Boolean)
  const label = filter.label === undefined ? undefined : normalize(filter.label)

  const matched = all.filter((bookmark) => {
    if (filter.unread !== undefined && bookmark.isRead === filter.unread) return false
    if (label !== undefined && !(bookmark.labels ?? []).some((l) => normalize(l) === label)) {
      return false
    }
    if (words.length === 0) return true
    const haystack = normalize(
      [
        bookmark.title,
        bookmark.url,
        ...(bookmark.labels ?? []),
        bookmark.shortSummary ?? '',
        bookmark.summary ?? '',
      ].join('\n')
    )
    return words.every((word) => haystack.includes(word))
  })

  const limit = Math.min(Math.max(Math.trunc(filter.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)
  const offset = Math.max(Math.trunc(filter.offset ?? 0), 0)
  const end = offset + limit
  return {
    total: matched.length,
    offset,
    ...(end < matched.length && { nextOffset: end }),
    bookmarks: matched.slice(offset, end).map(toListItem),
  }
}

export function findSavedLink(all: BookmarkDoc[], url: string): BookmarkDoc | undefined {
  const target = url.trim()
  const videoId = parseYouTubeVideoId(target)
  return all.find(
    (bookmark) =>
      bookmark.url.trim() === target ||
      (videoId !== null && parseYouTubeVideoId(bookmark.url) === videoId)
  )
}
