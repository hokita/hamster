import { useEffect, useState, useCallback, useRef } from 'react'
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

  async function handleAdd(bookmark: { url: string; title: string }) {
    try {
      await api.createBookmark(bookmark)
      await refresh()
    } catch {
      setError('Failed to add bookmark.')
      throw new Error('Failed to add bookmark.')
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold px-4 pt-6">hamster</h1>
      {error && <p className="px-4 text-red-600">{error}</p>}
      <BookmarkForm onAdd={handleAdd} />
      <BookmarkList bookmarks={bookmarks} />
    </div>
  )
}
