import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faLink, faArrowUpRightFromSquare } from '@fortawesome/free-solid-svg-icons'
import type { Bookmark } from '../api'
import { formatRelativeTime } from '../relativeTime'

interface BookmarkListProps {
  bookmarks: Bookmark[]
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

export default function BookmarkList({ bookmarks }: BookmarkListProps) {
  if (bookmarks.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-gray-400">
        <FontAwesomeIcon icon={faLink} size="lg" aria-hidden="true" />
        <p className="m-0 text-sm">No bookmarks yet — paste a URL above to add one.</p>
      </div>
    )
  }

  return (
    <ul className="flex flex-col p-4">
      {bookmarks.map((bookmark) => {
        const hostname = hostnameOf(bookmark.url)
        return (
          <li key={bookmark.id} className="group border-b border-gray-100 last:border-b-0">
            <a
              href={bookmark.url}
              target="_blank"
              rel="noreferrer"
              aria-label={bookmark.title}
              className="flex items-center gap-3 py-2.5 px-1 rounded-md hover:bg-gray-50"
            >
              <span className="flex items-center justify-center w-7 h-7 rounded-md bg-gray-100 text-gray-400 flex-shrink-0">
                <FontAwesomeIcon icon={faLink} size="xs" aria-hidden="true" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block font-medium text-gray-900 truncate">{bookmark.title}</span>
                <span className="block text-xs text-gray-500">
                  {hostname ? `${hostname} · ` : ''}
                  {formatRelativeTime(bookmark.createdAt)}
                </span>
              </span>
              <FontAwesomeIcon
                icon={faArrowUpRightFromSquare}
                aria-hidden="true"
                className="text-gray-300 opacity-0 group-hover:opacity-100 flex-shrink-0"
              />
            </a>
          </li>
        )
      })}
    </ul>
  )
}
