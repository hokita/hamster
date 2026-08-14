import type { Bookmark } from './api'

// The part of a URL worth reading aloud: host, path, query and fragment, but not the scheme.
// "https colon slash slash" is what a screen reader makes of the scheme, and it never tells one
// bookmark from another. A bare "/" path is dropped too, so a site root stays just its hostname.
function locationOf(url: string): string {
  try {
    const { host, pathname, search, hash } = new URL(url)
    return `${host}${pathname === '/' ? '' : pathname}${search}${hash}`
  } catch {
    // Not parseable, so there is nothing to trim — the raw string is still the best identifier
    // available, and it is what the rest of the UI falls back to for such a bookmark.
    return url
  }
}

// Names a bookmark for controls whose accessible name must identify which bookmark they act on.
// The title alone will not do: two bookmarks can share one, and two pages of the same site can
// share both title and hostname, which is why the path is included rather than the host alone.
//
// This does not promise uniqueness, because nothing human-readable can — the same URL can be
// bookmarked twice, and only the Firestore id would separate those, which means nothing to a
// reader. It gets as close as a name someone can actually understand allows.
export function describeBookmark(bookmark: Pick<Bookmark, 'title' | 'url'>): string {
  return `${bookmark.title} on ${locationOf(bookmark.url)}`
}
