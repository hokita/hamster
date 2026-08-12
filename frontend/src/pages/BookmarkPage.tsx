import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowLeft,
  faArrowUpRightFromSquare,
  faSpinner,
  faTriangleExclamation,
  faWandMagicSparkles,
} from '@fortawesome/free-solid-svg-icons'
import { api } from '../api'
import type { Bookmark } from '../api'
import { formatRelativeTime } from '../relativeTime'

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

  async function handleGenerate() {
    if (!id) return
    setIsGenerating(true)
    setGenerateFailed(false)
    try {
      const { summary } = await api.generateSummary(id)
      setBookmark((previous) => (previous ? { ...previous, summary } : previous))
    } catch {
      setGenerateFailed(true)
    } finally {
      setIsGenerating(false)
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
        <SummaryBody summary={bookmark.summary} />
      ) : (
        <div className="flex flex-col items-start gap-3">
          <p className="m-0 text-gray-500">
            {generateFailed ? "Couldn't generate a summary." : 'No summary yet.'}
          </p>
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="inline-flex items-center gap-2 rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
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
