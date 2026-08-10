import { useEffect, useState, useCallback, useRef } from 'react'
import { signOut } from 'firebase/auth'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faRightFromBracket, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'
import { auth } from '../firebase'
import { api } from '../api'
import type { Bookmark } from '../api'
import BookmarkForm from '../components/BookmarkForm'
import BookmarkList from '../components/BookmarkList'

export default function BookmarksPage() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [error, setError] = useState<string | null>(null)
  // Shared across the mount effect and refresh() so a slow, superseded request can't
  // overwrite state a newer request already applied.
  const requestId = useRef(0)

  const refresh = useCallback(async () => {
    const id = ++requestId.current
    try {
      const result = await api.listBookmarks()
      if (id !== requestId.current) return
      setBookmarks(result)
      setError(null)
    } catch {
      if (id !== requestId.current) return
      setError('Failed to load bookmarks.')
    }
  }, [])

  useEffect(() => {
    const id = ++requestId.current
    let cancelled = false
    api
      .listBookmarks()
      .then((result) => {
        if (cancelled || id !== requestId.current) return
        setBookmarks(result)
        setError(null)
      })
      .catch(() => {
        if (cancelled || id !== requestId.current) return
        setError('Failed to load bookmarks.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleAdd(bookmark: { url: string }) {
    try {
      await api.createBookmark(bookmark)
      await refresh()
    } catch {
      // Invalidate any in-flight load (mount fetch or refresh) so its eventual
      // resolution can't silently clear this error once it lands.
      requestId.current++
      setError('Failed to add bookmark.')
      throw new Error('Failed to add bookmark.')
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between px-4 pt-6 pb-4 border-b border-gray-200">
        <h1 className="text-2xl font-bold">hamster</h1>
        <button
          onClick={() => signOut(auth)}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 cursor-pointer"
        >
          <FontAwesomeIcon icon={faRightFromBracket} aria-hidden="true" />
          Sign out
        </button>
      </div>
      {error && (
        <div className="mx-4 mt-4 flex items-center gap-2 bg-red-50 border border-red-200 rounded-md px-3 py-2 text-red-700 text-sm">
          <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" />
          {error}
        </div>
      )}
      <BookmarkForm onAdd={handleAdd} />
      <BookmarkList bookmarks={bookmarks} />
    </div>
  )
}
