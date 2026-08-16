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

// Applied to every fetch result before it reaches state, so "nothing deleted is ever displayed"
// holds at each of the places a list response lands. Module-level, taking the set as an argument,
// so it is not a reactive dependency of the hooks that call it.
function withoutDeleted(list: Bookmark[], deleted: ReadonlySet<string>): Bookmark[] {
  return deleted.size > 0 ? list.filter((bookmark) => !deleted.has(bookmark.id)) : list
}

// A read flag set on this page, with the fetch ordering that says when the server's own answer
// can be believed again.
interface PendingRead {
  isRead: boolean
  // fetchId at the moment the write settled, or null while it is still in flight. Every list
  // fetch ISSUED after that point reads data the write had already committed, so its answer
  // supersedes this override — even when the two disagree, which is exactly what a change made
  // somewhere else (another tab, another device) looks like from here.
  settledAtFetchId: number | null
}

// The same idea as withoutDeleted, for read flags: a list response assembled before a toggle was
// written still carries the old flag, and letting it land would flip the row back under the user
// seconds after they marked it.
//
// Unlike deletions these overrides are not kept forever. One is retired as soon as a response
// agrees with it, or as soon as any response arrives that the server answered after the write —
// see settledAtFetchId. Agreement alone would not be enough: a flag changed elsewhere never
// agrees, so the override would mask every response carrying it for the rest of this mount.
// Prunes the map it is given, which is why it takes the mutable Map rather than a ReadonlyMap.
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

// Every place a list response reaches state applies both corrections, in this order: a deleted
// bookmark is gone whatever its flag says. issuedFetchId is the fetchId of the fetch this result
// came from — the read overrides need it to tell a pre-write answer from a post-write one.
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
  const [deletingIds, setDeletingIds] = useState<ReadonlySet<string>>(new Set())
  const [readPendingIds, setReadPendingIds] = useState<ReadonlySet<string>>(new Set())
  // Shared across the mount effect and refresh() so a slow, superseded request can't
  // overwrite state a newer request already applied.
  const requestId = useRef(0)
  // Tracks ownership of applying a fetch's result (bookmarks, hasLoadedOnce, isLoading),
  // independent of requestId. requestId is also bumped by handleAdd's catch block (to
  // protect the add-failure error from being silently cleared) even when no replacement
  // fetch is started — that bump must not also discard a genuinely successful, still-
  // in-flight fetch's data, which is why this is a separate counter. fetchId orders when
  // fetches are ISSUED: each refresh (or the mount fetch) takes the next value when it starts.
  const fetchId = useRef(0)
  // Tracks the fetchId of the last fetch whose result was actually APPLIED to bookmarks/
  // hasLoadedOnce, as opposed to fetchId.current, which tracks the last fetch ISSUED. A
  // result is applied when its fetchId is newer than appliedFetchId — i.e. newer than what's
  // currently displayed — not when it's the newest fetch in flight. Those differ whenever a
  // newer fetch is issued but never delivers data (e.g. it rejects): gating on "newest issued"
  // would let that failed newer request permanently suppress an older one that succeeded,
  // leaving the list silently stale even though a good response arrived. Gating on "newer than
  // applied" still discards a genuinely stale response (one older than what's already on
  // screen), which is the property the original guard existed for.
  const appliedFetchId = useRef(0)
  // Bookmarks deleted during this session. A list fetch issued before a delete is assembled from
  // data where the bookmark still existed, so its response would put the row back on screen.
  // Filtering applied responses through this set removes exactly that row and keeps the rest —
  // discarding the whole response instead (by treating it as stale) would also throw away records
  // it is the only carrier of, such as a bookmark added moments earlier whose own refresh this is.
  //
  // Never pruned: Firestore does not reuse document ids, so an id in here can only ever match the
  // bookmark that was deleted, and one string per delete is nothing over a session.
  const deletedIds = useRef<Set<string>>(new Set())
  // Read flags set on this page that a list response may not reflect yet — see
  // withPendingReadStates. A ref, not state: it corrects data on its way into `bookmarks` and
  // must never itself trigger a render.
  const pendingReadStates = useRef<Map<string, PendingRead>>(new Map())

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

  async function handleDelete(id: string) {
    // Ordering is the same as refresh()'s: this is a user action, so it takes ownership of the
    // error banner and invalidates whatever an older in-flight load has to say about it.
    const requestNo = ++requestId.current
    setDeletingIds((previous) => new Set(previous).add(id))
    try {
      await api.deleteBookmark(id)
      // Drop the row here rather than refetching: the delete has already settled server-side, and
      // a round trip would leave the deleted bookmark on screen for its duration. Recording the id
      // is what keeps it gone — see deletedIds for why an in-flight fetch is filtered rather than
      // discarded outright.
      deletedIds.current.add(id)
      setBookmarks((previous) => previous.filter((bookmark) => bookmark.id !== id))
      if (requestNo === requestId.current) setError(null)
    } catch {
      // Same bump as handleAdd's: nothing else may clear this error out from under the user.
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
    // A user action, so it owns the error banner the same way handleDelete does.
    const requestNo = ++requestId.current
    // Applied before the request, not after it: marking something read is a glance-and-move-on
    // gesture, and a row that only changes a round trip later reads as a click that missed. The
    // write is what makes it true — see the catch block for the row going back if it fails.
    pendingReadStates.current.set(id, { isRead, settledAtFetchId: null })
    setReadPendingIds((previous) => new Set(previous).add(id))
    setBookmarks((previous) =>
      previous.map((bookmark) => (bookmark.id === id ? { ...bookmark, isRead } : bookmark))
    )
    try {
      await api.setReadState(id, isRead)
      // The write is committed, so every fetch issued from here on can answer for this flag —
      // including answering that it is now something else entirely. Stamped rather than deleted:
      // a fetch already in flight was assembled before the write and still needs the override.
      // Guarded on the entry still being this toggle's, so an older write cannot stamp a newer
      // one's override.
      const entry = pendingReadStates.current.get(id)
      if (entry?.isRead === isRead) entry.settledAtFetchId = fetchId.current
      if (requestNo === requestId.current) setError(null)
    } catch {
      // Nothing was stored, so the optimistic row is now a lie: put it back rather than leave the
      // user believing a flag was saved. Dropping the override too, so a list response is free to
      // report whatever the server actually holds.
      if (pendingReadStates.current.get(id)?.isRead === isRead) {
        pendingReadStates.current.delete(id)
      }
      setBookmarks((previous) =>
        previous.map((bookmark) =>
          bookmark.id === id ? { ...bookmark, isRead: !isRead } : bookmark
        )
      )
      // Same bump as handleAdd's: nothing else may clear this error out from under the user.
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
          <BookmarkList
            bookmarks={bookmarks}
            summarizingIds={summarizingIds}
            onDelete={handleDelete}
            deletingIds={deletingIds}
            onToggleRead={handleToggleRead}
            readPendingIds={readPendingIds}
          />
        )
      )}
    </div>
  )
}
