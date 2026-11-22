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

function withoutDeleted(list: Bookmark[], deleted: ReadonlySet<string>): Bookmark[] {
  return deleted.size > 0 ? list.filter((bookmark) => !deleted.has(bookmark.id)) : list
}

type ReadFilter = 'all' | 'unread' | 'read'

const FILTERS: { value: ReadFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'read', label: 'Read' },
]

function matchesFilter(bookmark: Bookmark, filter: ReadFilter): boolean {
  if (filter === 'all') return true
  return bookmark.isRead === (filter === 'read')
}

const EMPTY_MESSAGES: Record<ReadFilter, string | undefined> = {
  all: undefined,
  unread: 'Nothing unread.',
  read: 'Nothing read yet.',
}

interface PendingRead {
  isRead: boolean
  settledAtFetchId: number | null
}

function withPendingReadStates(
  list: Bookmark[],
  pending: Map<string, PendingRead>,
  issuedFetchId: number
): Bookmark[] {
  if (pending.size === 0) return list
  for (const bookmark of list) {
    const entry = pending.get(bookmark.id)
    if (!entry) continue
    const answeredAfterWrite =
      entry.settledAtFetchId !== null && issuedFetchId > entry.settledAtFetchId
    if (answeredAfterWrite || entry.isRead === bookmark.isRead) pending.delete(bookmark.id)
  }
  if (pending.size === 0) return list
  return list.map((bookmark) => {
    const entry = pending.get(bookmark.id)
    return entry === undefined ? bookmark : { ...bookmark, isRead: entry.isRead }
  })
}

function reconcile(
  list: Bookmark[],
  deleted: ReadonlySet<string>,
  pendingReads: Map<string, PendingRead>,
  issuedFetchId: number
): Bookmark[] {
  return withPendingReadStates(withoutDeleted(list, deleted), pendingReads, issuedFetchId)
}

export default function BookmarksPage() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  const [summarizingIds, setSummarizingIds] = useState<ReadonlySet<string>>(new Set())
  const [filter, setFilter] = useState<ReadFilter>('all')
  const [deletingIds, setDeletingIds] = useState<ReadonlySet<string>>(new Set())
  const [readPendingIds, setReadPendingIds] = useState<ReadonlySet<string>>(new Set())
  const requestId = useRef(0)
  const fetchId = useRef(0)
  const appliedFetchId = useRef(0)
  const deletedIds = useRef<Set<string>>(new Set())
  const pendingReadStates = useRef<Map<string, PendingRead>>(new Map())

  const refresh = useCallback(async (options?: { background?: boolean }) => {
    const id = options?.background ? null : ++requestId.current
    const fid = ++fetchId.current
    try {
      const result = await api.listBookmarks()
      if (fid > appliedFetchId.current) {
        appliedFetchId.current = fid
        setBookmarks(reconcile(result, deletedIds.current, pendingReadStates.current, fid))
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
          setBookmarks(reconcile(result, deletedIds.current, pendingReadStates.current, fid))
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
      requestId.current++
      setError('Failed to add bookmark.')
      throw new Error('Failed to add bookmark.')
    }
    void generateSummaryFor(created.id)
  }

  async function handleDelete(id: string) {
    const requestNo = ++requestId.current
    setDeletingIds((previous) => new Set(previous).add(id))
    try {
      await api.deleteBookmark(id)
      deletedIds.current.add(id)
      setBookmarks((previous) => previous.filter((bookmark) => bookmark.id !== id))
      if (requestNo === requestId.current) setError(null)
    } catch {
      requestId.current++
      setError('Failed to delete bookmark.')
    } finally {
      setDeletingIds((previous) => {
        const next = new Set(previous)
        next.delete(id)
        return next
      })
    }
  }

  async function handleToggleRead(id: string, isRead: boolean) {
    const requestNo = ++requestId.current
    pendingReadStates.current.set(id, { isRead, settledAtFetchId: null })
    setReadPendingIds((previous) => new Set(previous).add(id))
    setBookmarks((previous) =>
      previous.map((bookmark) => (bookmark.id === id ? { ...bookmark, isRead } : bookmark))
    )
    try {
      await api.setReadState(id, isRead)
      const entry = pendingReadStates.current.get(id)
      if (entry?.isRead === isRead) entry.settledAtFetchId = fetchId.current
      if (requestNo === requestId.current) setError(null)
    } catch {
      if (pendingReadStates.current.get(id)?.isRead !== isRead) return
      pendingReadStates.current.delete(id)
      setBookmarks((previous) =>
        previous.map((bookmark) =>
          bookmark.id === id ? { ...bookmark, isRead: !isRead } : bookmark
        )
      )
      requestId.current++
      setError(isRead ? 'Failed to mark as read.' : 'Failed to mark as unread.')
    } finally {
      setReadPendingIds((previous) => {
        const next = new Set(previous)
        next.delete(id)
        return next
      })
    }
  }

  async function generateSummaryFor(id: string) {
    setSummarizingIds((previous) => new Set(previous).add(id))
    await api
      .generateSummary(id)
      .then(() => refresh({ background: true }))
      .catch(() => undefined)
    setSummarizingIds((previous) => {
      const next = new Set(previous)
      next.delete(id)
      return next
    })
  }

  const items = Array.isArray(bookmarks) ? bookmarks : []
  const visible = items.filter((bookmark) => matchesFilter(bookmark, filter))

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
      <div
        role="group"
        aria-label="Filter bookmarks by read state"
        className="flex gap-1 px-4 pb-1"
      >
        {FILTERS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            aria-pressed={filter === value}
            className={`rounded-full px-3 py-1 text-sm cursor-pointer ${
              filter === value
                ? 'bg-amber-700 text-white'
                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
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
          <BookmarkList
            bookmarks={visible}
            summarizingIds={summarizingIds}
            onDelete={handleDelete}
            deletingIds={deletingIds}
            onToggleRead={handleToggleRead}
            readPendingIds={readPendingIds}
            emptyMessage={items.length > 0 ? EMPTY_MESSAGES[filter] : undefined}
          />
        )
      )}
    </div>
  )
}
