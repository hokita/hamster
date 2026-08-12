import { useEffect, useState, useCallback, useRef } from 'react'
import { signOut } from 'firebase/auth'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faRightFromBracket,
  faTriangleExclamation,
  faSpinner,
} from '@fortawesome/free-solid-svg-icons'
import { auth } from '../firebase'
import { api } from '../api'
import type { Bookmark } from '../api'
import BookmarkForm from '../components/BookmarkForm'
import BookmarkList from '../components/BookmarkList'

export default function BookmarksPage() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  const [summarizingIds, setSummarizingIds] = useState<ReadonlySet<string>>(new Set())
  // Shared across the mount effect and refresh() so a slow, superseded request can't
  // overwrite state a newer request already applied.
  const requestId = useRef(0)
  // Tracks ownership of applying a fetch's result (bookmarks, hasLoadedOnce, isLoading),
  // independent of requestId. requestId is also bumped by handleAdd's catch block (to
  // protect the add-failure error from being silently cleared) even when no replacement
  // fetch is started — that bump must not also discard a genuinely successful, still-
  // in-flight fetch's data, which is why this is a separate counter.
  const fetchId = useRef(0)

  const refresh = useCallback(async (options?: { background?: boolean }) => {
    // A background refresh (the one that follows a summary landing) must not touch error state:
    // it can settle seconds after it was launched, long after an unrelated action has produced an
    // error the user is still reading. It stays out of requestId entirely — it has nothing to say
    // about whether the user's most recent action succeeded — and participates only in fetchId,
    // which orders list data.
    const id = options?.background ? null : ++requestId.current
    const fid = ++fetchId.current
    try {
      const result = await api.listBookmarks()
      if (fid === fetchId.current) {
        setBookmarks(result)
        setHasLoadedOnce(true)
      }
      if (id !== null && id === requestId.current) setError(null)
    } catch {
      if (id !== null && id === requestId.current) setError('Failed to load bookmarks.')
    } finally {
      if (fid === fetchId.current) setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    const id = ++requestId.current
    const fid = ++fetchId.current
    let cancelled = false
    api
      .listBookmarks()
      .then((result) => {
        if (cancelled) return
        if (fid === fetchId.current) {
          setBookmarks(result)
          setHasLoadedOnce(true)
        }
        if (id === requestId.current) setError(null)
      })
      .catch(() => {
        if (cancelled || id !== requestId.current) return
        setError('Failed to load bookmarks.')
      })
      .finally(() => {
        if (cancelled || fid !== fetchId.current) return
        setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleAdd(bookmark: { url: string }) {
    let created
    try {
      created = await api.createBookmark(bookmark)
      await refresh()
    } catch {
      // Invalidate any in-flight load (mount fetch or refresh) so its eventual
      // resolution can't silently clear this error once it lands.
      requestId.current++
      setError('Failed to add bookmark.')
      throw new Error('Failed to add bookmark.')
    }
    // Deliberately not awaited: the save is already done, and the summary takes several seconds.
    // A failure here is silent on this page — the bookmark's own page owns the retry.
    void generateSummaryFor(created.id)
  }

  async function generateSummaryFor(id: string) {
    setSummarizingIds((previous) => new Set(previous).add(id))
    try {
      await api.generateSummary(id)
      await refresh({ background: true })
    } catch {
      // Intentionally ignored — see handleAdd.
    } finally {
      setSummarizingIds((previous) => {
        const next = new Set(previous)
        next.delete(id)
        return next
      })
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
      {isLoading ? (
        <div
          role="status"
          aria-label="Loading bookmarks"
          className="flex justify-center py-10 text-gray-400"
        >
          <FontAwesomeIcon icon={faSpinner} spin size="lg" aria-hidden="true" />
        </div>
      ) : (
        !(error && !hasLoadedOnce) && (
          <BookmarkList bookmarks={bookmarks} summarizingIds={summarizingIds} />
        )
      )}
    </div>
  )
}
