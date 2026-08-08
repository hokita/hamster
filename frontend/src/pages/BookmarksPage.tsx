import { useEffect, useState, useCallback } from 'react'
import { api } from '../api'
import type { Bookmark } from '../api'
import BookmarkForm from '../components/BookmarkForm'
import BookmarkList from '../components/BookmarkList'

export default function BookmarksPage() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setBookmarks(await api.listBookmarks())
      setError(null)
    } catch {
      setError('Failed to load bookmarks.')
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    api
      .listBookmarks()
      .then((result) => {
        if (cancelled) return
        setBookmarks(result)
        setError(null)
      })
      .catch(() => {
        if (cancelled) return
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
