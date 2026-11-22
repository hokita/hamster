import type { Bookmark } from './api'

function locationOf(url: string): string {
  try {
    const { host, pathname, search, hash } = new URL(url)
    return `${host}${pathname === '/' ? '' : pathname}${search}${hash}`
  } catch {
    return url
  }
}

export function describeBookmark(bookmark: Pick<Bookmark, 'title' | 'url'>): string {
  return `${bookmark.title} on ${locationOf(bookmark.url)}`
}
