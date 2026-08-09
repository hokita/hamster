import type { Bookmark } from '../api'

interface BookmarkListProps {
  bookmarks: Bookmark[]
}

export default function BookmarkList({ bookmarks }: BookmarkListProps) {
  if (bookmarks.length === 0) {
    return <p className="p-4 text-gray-500">No bookmarks yet.</p>
  }

  return (
    <ul className="flex flex-col gap-2 p-4">
      {bookmarks.map((bookmark) => (
        <li key={bookmark.id} className="border border-gray-200 rounded px-3 py-2">
          <a
            href={bookmark.url}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-blue-600 hover:underline"
          >
            {bookmark.title}
          </a>
        </li>
      ))}
    </ul>
  )
}
