import { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowLeft,
  faArrowUpRightFromSquare,
  faRotate,
  faSpinner,
  faTriangleExclamation,
  faWandMagicSparkles,
} from '@fortawesome/free-solid-svg-icons'
import { api } from '../api'
import type { Bookmark } from '../api'
import { formatRelativeTime } from '../relativeTime'

// Summary generation typically takes 10-25 seconds in the background (article fetch + Gemini
// call). Polling every 2 seconds for up to 30 seconds (15 attempts) covers the normal case
// without polling indefinitely; once the budget is spent the existing Generate button remains
// as the fallback. The endpoint this polls is a cheap Firestore read, not a Gemini call, so
// polling costs nothing but a handful of extra reads.
const POLL_INTERVAL_MS = 2000
const MAX_POLL_ATTEMPTS = 15

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

// The prompt asks for a paragraph followed by "- " bullets, so this is all the structure the text
// can have — a markdown dependency would be dead weight. Anything unexpected degrades to
// paragraphs, which is a safe worst case.
function SummaryBody({ summary }: { summary: string }) {
  type Block = { type: 'p'; text: string } | { type: 'ul'; items: string[] }
  const blocks: Block[] = []

  for (const rawLine of summary.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const bullet = /^[-*・]\s*(.+)$/.exec(line)
    const last = blocks[blocks.length - 1]
    if (bullet) {
      if (last?.type === 'ul') last.items.push(bullet[1])
      else blocks.push({ type: 'ul', items: [bullet[1]] })
    } else {
      blocks.push({ type: 'p', text: line })
    }
  }

  return (
    <div className="flex flex-col gap-3 text-gray-700 leading-relaxed">
      {blocks.map((block, index) =>
        block.type === 'p' ? (
          <p key={index} className="m-0">
            {block.text}
          </p>
        ) : (
          <ul key={index} className="m-0 flex flex-col gap-1.5 list-disc pl-5">
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>{item}</li>
            ))}
          </ul>
        )
      )}
    </div>
  )
}

export default function BookmarkPage() {
  const { id } = useParams<{ id: string }>()
  const [bookmark, setBookmark] = useState<Bookmark | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [generateFailed, setGenerateFailed] = useState(false)
  // React Router reuses this component instance across `/bookmarks/:id` navigations, so state
  // from the previous bookmark would otherwise leak into the next one. Resetting it here (during
  // render, gated on the id actually changing) is React's documented pattern for this — it avoids
  // ever painting bookmark 1's stale title/summary for a frame while bookmark 2 loads, which a
  // reset inside the effect body cannot fully avoid.
  const [loadedId, setLoadedId] = useState(id)
  if (loadedId !== id) {
    setLoadedId(id)
    setIsLoading(true)
    setBookmark(null)
    setLoadError(false)
    setGenerateFailed(false)
    setIsGenerating(false)
  }

  // Tracks the id the route is currently on, so a generation request kicked off for a bookmark
  // that's since been navigated away from can detect it's stale and avoid writing its result
  // (summary, failure state, or clearing isGenerating) onto whatever bookmark is now displayed.
  const latestId = useRef(id)
  useEffect(() => {
    latestId.current = id
  }, [id])

  useEffect(() => {
    if (!id) return
    let cancelled = false
    api
      .getBookmark(id)
      .then((result) => {
        if (!cancelled) setBookmark(result)
      })
      .catch(() => {
        if (!cancelled) setLoadError(true)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  // Adding a bookmark kicks off summary generation in the background from the list page; if the
  // user clicks into it immediately, this page's own fetch above usually wins the race and loads
  // before the summary is written. Poll for it while it's missing, bounded by the budget above.
  // Skipped while a manual generation is in flight (that request will deliver the summary itself,
  // and a concurrent poll would race it) and stopped for good once a summary is present. Reruns
  // whenever `bookmark` changes, which naturally restarts once the initial load completes and
  // stops once a summary lands — see the constants above for why a fresh budget on resume is fine.
  useEffect(() => {
    if (!id) return
    if (!bookmark) return
    if (bookmark.summary) return
    if (isGenerating) return

    let cancelled = false
    let attempts = 0
    const intervalId = setInterval(() => {
      attempts += 1
      if (attempts >= MAX_POLL_ATTEMPTS) clearInterval(intervalId)
      api
        .getBookmark(id)
        .then((result) => {
          if (cancelled || id !== latestId.current) return
          if (result.summary) setBookmark(result)
        })
        .catch(() => {
          // Opportunistic background polling: swallow failures and keep the remaining budget.
          // The Generate button stays available as the fallback if nothing ever arrives.
        })
    }, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(intervalId)
    }
  }, [id, bookmark, isGenerating])

  // Drives both the empty state's "Generate summary" button and the "Regenerate" button shown
  // under an existing summary: POST /:id/summary always runs a fresh generation and overwrites
  // whatever is stored, so one handler covers both. A regeneration that fails before the write
  // leaves the stored summary untouched, which is why the current one stays on screen when
  // `generateFailed` flips — see the catch block for the case where the write did land.
  async function handleGenerate() {
    if (!id) return
    const requestedId = id
    const summaryBefore = bookmark?.summary
    setIsGenerating(true)
    setGenerateFailed(false)
    try {
      const { summary } = await api.generateSummary(requestedId)
      if (requestedId !== latestId.current) return
      setBookmark((previous) => (previous ? { ...previous, summary } : previous))
    } catch {
      if (requestedId !== latestId.current) return
      // A failed request does not prove nothing was written: the summary is persisted before the
      // response is sent, so a connection dropped in between leaves a fresh summary in Firestore
      // that this page knows nothing about. Re-read the bookmark before reporting failure —
      // otherwise the page shows the old text under a message claiming it is unchanged, and the
      // polling effect cannot repair it because that only runs while there is no summary at all.
      // Retrying blind would also pay for a second generation to reproduce what already exists.
      try {
        const refreshed = await api.getBookmark(requestedId)
        if (requestedId !== latestId.current) return
        if (refreshed.summary && refreshed.summary !== summaryBefore) {
          setBookmark(refreshed)
          return
        }
      } catch {
        // The re-read failed too, so nothing was learned: fall through to the failure state,
        // which still describes what the user can see.
      }
      if (requestedId !== latestId.current) return
      setGenerateFailed(true)
    } finally {
      if (requestedId === latestId.current) setIsGenerating(false)
    }
  }

  if (isLoading) {
    return (
      <div
        role="status"
        aria-label="Loading bookmark"
        className="flex justify-center py-10 text-gray-400"
      >
        <FontAwesomeIcon icon={faSpinner} spin size="lg" aria-hidden="true" />
      </div>
    )
  }

  if (loadError || !bookmark) {
    return (
      <div className="max-w-2xl mx-auto px-4 pt-6">
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-md px-3 py-2 text-red-700 text-sm">
          <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" />
          Failed to load this bookmark.
        </div>
        <Link to="/" className="inline-flex items-center gap-1.5 mt-4 text-sm text-gray-500">
          <FontAwesomeIcon icon={faArrowLeft} aria-hidden="true" />
          Back to bookmarks
        </Link>
      </div>
    )
  }

  const hostname = hostnameOf(bookmark.url)

  return (
    <div className="max-w-2xl mx-auto px-4 pt-6 pb-10">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
      >
        <FontAwesomeIcon icon={faArrowLeft} aria-hidden="true" />
        Back to bookmarks
      </Link>

      <h1 className="mt-4 mb-1 text-2xl font-bold text-gray-900">{bookmark.title}</h1>
      <p className="m-0 text-sm text-gray-500">
        <a
          href={bookmark.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 hover:text-gray-700"
        >
          {hostname ?? bookmark.url}
          <FontAwesomeIcon icon={faArrowUpRightFromSquare} size="xs" aria-hidden="true" />
        </a>
        {' · '}
        {formatRelativeTime(bookmark.createdAt)}
      </p>

      <h2 className="mt-8 mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
        Summary
      </h2>

      {bookmark.summary ? (
        <div className="flex flex-col items-start gap-4">
          {/* Dimmed while a regeneration is in flight: the text on screen is about to be replaced,
              and the button's spinner alone is easy to miss below a long summary. */}
          <div
            aria-busy={isGenerating}
            className={`transition-opacity ${isGenerating ? 'opacity-50' : ''}`}
          >
            <SummaryBody summary={bookmark.summary} />
          </div>
          {generateFailed && (
            <p className="m-0 flex items-center gap-2 text-sm text-red-700">
              <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" />
              Couldn&apos;t regenerate the summary — the one above is unchanged.
            </p>
          )}
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-800 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <FontAwesomeIcon
              icon={isGenerating ? faSpinner : faRotate}
              spin={isGenerating}
              aria-hidden="true"
            />
            {isGenerating ? 'Regenerating…' : 'Regenerate'}
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3">
          <p className="m-0 text-gray-500">
            {generateFailed ? "Couldn't generate a summary." : 'No summary yet.'}
          </p>
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="inline-flex items-center gap-2 rounded-md bg-amber-700 px-3 py-2 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <FontAwesomeIcon
              icon={isGenerating ? faSpinner : faWandMagicSparkles}
              spin={isGenerating}
              aria-hidden="true"
            />
            {isGenerating ? 'Generating…' : generateFailed ? 'Try again' : 'Generate summary'}
          </button>
        </div>
      )}
    </div>
  )
}
