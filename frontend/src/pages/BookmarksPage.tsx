import { useEffect, useState, useCallback } from 'react'
import { api } from '../api'
import type { Bookmark } from '../api'
import BookmarkForm from '../components/BookmarkForm'
import BookmarkList from '../components/BookmarkList'

export default function BookmarksPage() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])

  const refresh = useCallback(async () => {
    setBookmarks(await api.listBookmarks())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function handleAdd(bookmark: { url: string; title: string }) {
    await api.createBookmark(bookmark)
    await refresh()
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold px-4 pt-6">hamster</h1>
      <BookmarkForm onAdd={handleAdd} />
      <BookmarkList bookmarks={bookmarks} />
    </div>
  )
}
