import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import Markdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowLeft,
  faArrowUpRightFromSquare,
  faLanguage,
  faRotate,
  faSpinner,
  faTriangleExclamation,
  faWandMagicSparkles,
} from '@fortawesome/free-solid-svg-icons'
import { api } from '../api'
import type { ApiError, Bookmark, VideoSummaryState } from '../api'
import {
  GENERIC_SUMMARY_FAILURE_MESSAGE,
  VIDEO_SUMMARY_RUNNING_MESSAGE,
  videoSummaryMessage,
} from '../videoSummaryMessages'
import { formatRelativeTime } from '../relativeTime'
import { textLanguage } from '../textLanguage'
import { describeBookmark } from '../bookmarkLabel'
import DeleteBookmarkButton from '../components/DeleteBookmarkButton'
import ReadToggleButton from '../components/ReadToggleButton'
import ArticleChat from '../components/ArticleChat'

const POLL_INTERVAL_MS = 2000
const MAX_POLL_ATTEMPTS = 45
const MAX_VIDEO_POLL_ATTEMPTS = 300
const VIDEO_RUNNING_STALE_MS = 660_000

function isFreshRunning(state: VideoSummaryState | undefined, now: number): boolean {
  return state?.status === 'running' && now - Date.parse(state.updatedAt) < VIDEO_RUNNING_STALE_MS
}

function sameVideoState(a?: VideoSummaryState, b?: VideoSummaryState): boolean {
  if (!a || !b) return !a && !b
  return a.status === b.status && a.code === b.code && a.updatedAt === b.updatedAt
}

function errorCode(error: unknown): string | undefined {
  const code = (error as Partial<ApiError> | null)?.code
  return typeof code === 'string' ? code : undefined
}

function sameLabels(a?: string[], b?: string[]): boolean {
  if (!a || !b) return !a && !b
  return a.length === b.length && a.every((label, index) => label === b[index])
}

interface PendingRead {
  token: number
  isRead: boolean
  settledAtFetchId: number | null
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

const DISALLOWED_ELEMENTS = ['a']

function SummaryImageText({ alt }: { alt?: string }) {
  return <>{alt}</>
}

const LEGACY_BULLET = /^([ \t]*)・[ \t]*(?=\S)/gm

function normalizeLegacyBullets(summary: string): string {
  return summary.replace(LEGACY_BULLET, '$1- ')
}

function SummaryHeading({ children }: { children?: ReactNode }) {
  return <h3 className="m-0 mt-2 text-base font-semibold text-gray-900">{children}</h3>
}

const SUMMARY_COMPONENTS: Components = {
  p: ({ children }) => <p className="m-0">{children}</p>,
  h1: SummaryHeading,
  h2: SummaryHeading,
  h3: SummaryHeading,
  h4: SummaryHeading,
  h5: SummaryHeading,
  h6: SummaryHeading,
  ul: ({ children }) => <ul className="m-0 flex flex-col gap-1.5 list-disc pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="m-0 flex flex-col gap-1.5 list-decimal pl-5">{children}</ol>,
  li: ({ children }) => <li className="pl-1">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ children }) => (
    <code className="rounded bg-gray-100 px-1 py-0.5 text-[0.9em] text-gray-800">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="m-0 overflow-x-auto rounded bg-gray-100 p-3 text-sm text-gray-800">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="m-0 border-l-2 border-gray-200 pl-3 text-gray-600">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="m-0 border-gray-200" />,
  img: SummaryImageText,
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="m-0 w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-gray-300 px-2 py-1.5 text-left font-semibold text-gray-900">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-gray-200 px-2 py-1.5 align-top">{children}</td>
  ),
}

function SummaryBody({ summary }: { summary: string }) {
  return (
    <div lang={textLanguage(summary)} className="flex flex-col gap-3 text-gray-700 leading-relaxed">
      <Markdown
        components={SUMMARY_COMPONENTS}
        remarkPlugins={[remarkGfm]}
        disallowedElements={DISALLOWED_ELEMENTS}
        unwrapDisallowed
      >
        {normalizeLegacyBullets(summary)}
      </Markdown>
    </div>
  )
}

export default function BookmarkPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [bookmark, setBookmark] = useState<Bookmark | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [generateFailed, setGenerateFailed] = useState(false)
  const [generateFailureCode, setGenerateFailureCode] = useState<string | undefined>(undefined)
  const [now, setNow] = useState(() => Date.now())
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteFailed, setDeleteFailed] = useState(false)
  const [isTogglingRead, setIsTogglingRead] = useState(false)
  const [readToggleFailed, setReadToggleFailed] = useState(false)
  const [translation, setTranslation] = useState<{ source: string; text: string } | null>(null)
  const [showTranslation, setShowTranslation] = useState(false)
  const [isTranslating, setIsTranslating] = useState(false)
  const [failedTranslationOf, setFailedTranslationOf] = useState<string | null>(null)
  const [supersededSummary, setSupersededSummary] = useState<string | null>(null)
  const pendingRead = useRef<PendingRead | null>(null)
  const readToggleToken = useRef(0)
  const bookmarkFetchId = useRef(0)
  const [loadedId, setLoadedId] = useState(id)
  if (loadedId !== id) {
    setLoadedId(id)
    setIsLoading(true)
    setBookmark(null)
    setLoadError(false)
    setGenerateFailed(false)
    setGenerateFailureCode(undefined)
    setIsGenerating(false)
    setSupersededSummary(null)
    setIsDeleting(false)
    setDeleteFailed(false)
    setIsTogglingRead(false)
    setReadToggleFailed(false)
    setTranslation(null)
    setShowTranslation(false)
    setIsTranslating(false)
    setFailedTranslationOf(null)
  }

  const latestId = useRef(id)
  useEffect(() => {
    latestId.current = id
    pendingRead.current = null
  }, [id])

  function adopt(result: Bookmark, issuedFetchId: number): Bookmark {
    const pending = pendingRead.current
    if (pending === null) return result
    const answeredAfterWrite =
      pending.settledAtFetchId !== null && issuedFetchId > pending.settledAtFetchId
    if (answeredAfterWrite || result.isRead === pending.isRead) {
      pendingRead.current = null
      return result
    }
    return { ...result, isRead: pending.isRead }
  }

  useEffect(() => {
    if (!id) return
    let cancelled = false
    const fid = ++bookmarkFetchId.current
    api
      .getBookmark(id)
      .then((result) => {
        if (cancelled) return
        setBookmark(adopt(result, fid))
        setNow(Date.now())
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

  const videoState = bookmark?.videoId ? bookmark.videoSummaryState : undefined
  const videoRunning = isFreshRunning(videoState, now)

  const runningSince = videoState?.status === 'running' ? videoState.updatedAt : undefined
  useEffect(() => {
    if (runningSince === undefined) return
    const msUntilStale = Date.parse(runningSince) + VIDEO_RUNNING_STALE_MS - Date.now()
    const timeoutId = setTimeout(() => setNow(Date.now()), Math.max(0, msUntilStale))
    return () => clearTimeout(timeoutId)
  }, [runningSince])

  useEffect(() => {
    if (!id) return
    if (!bookmark) return
    if (
      bookmark.summary &&
      bookmark.summary !== supersededSummary &&
      bookmark.labels &&
      !videoRunning
    )
      return
    if (isGenerating) return
    if (videoState && !videoRunning) return
    const maxAttempts = videoRunning ? MAX_VIDEO_POLL_ATTEMPTS : MAX_POLL_ATTEMPTS

    let cancelled = false
    let attempts = 0
    const intervalId = setInterval(() => {
      attempts += 1
      if (attempts >= maxAttempts) clearInterval(intervalId)
      const fid = ++bookmarkFetchId.current
      api
        .getBookmark(id)
        .then((result) => {
          if (cancelled || id !== latestId.current) return
          const reconciled = adopt(result, fid)
          const summaryAdvanced = Boolean(
            reconciled.summary &&
            reconciled.summary !== supersededSummary &&
            reconciled.summary !== bookmark.summary
          )
          const labelsAdvanced = !sameLabels(reconciled.labels, bookmark.labels)
          const readAdvanced = reconciled.isRead !== bookmark.isRead
          const stateAdvanced = !sameVideoState(
            reconciled.videoSummaryState,
            bookmark.videoSummaryState
          )
          if (!summaryAdvanced && !labelsAdvanced && !readAdvanced && !stateAdvanced) return
          setBookmark(reconciled)
          if (summaryAdvanced || (labelsAdvanced && reconciled.labels)) {
            setGenerateFailed(false)
            setSupersededSummary(null)
          }
        })
        .catch(() => {})
    }, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(intervalId)
    }
  }, [id, bookmark, isGenerating, supersededSummary, videoState, videoRunning])

  async function handleGenerate() {
    if (!id) return
    const requestedId = id
    const summaryBefore = bookmark?.summary
    setIsGenerating(true)
    setGenerateFailed(false)
    setGenerateFailureCode(undefined)
    setSupersededSummary(null)
    setBookmark((previous) =>
      previous?.videoSummaryState ? { ...previous, videoSummaryState: undefined } : previous
    )
    setFailedTranslationOf(null)
    try {
      const { summary, shortSummary, labels } = await api.generateSummary(requestedId)
      if (requestedId !== latestId.current) return
      setBookmark((previous) =>
        previous ? { ...previous, summary, shortSummary, labels } : previous
      )
    } catch (error) {
      if (requestedId !== latestId.current) return
      const code = errorCode(error)
      const fid = ++bookmarkFetchId.current
      const refreshed = await api.getBookmark(requestedId).catch(() => null)
      if (refreshed) {
        if (requestedId !== latestId.current) return
        if (refreshed.summary && refreshed.summary !== summaryBefore) {
          setBookmark(adopt(refreshed, fid))
          return
        }
        if (code === 'video_summary_running') {
          setBookmark(adopt(refreshed, fid))
          return
        }
      }
      if (requestedId !== latestId.current) return
      if (code === 'video_summary_running') {
        setBookmark((previous) =>
          previous
            ? {
                ...previous,
                videoSummaryState: { status: 'running', updatedAt: new Date().toISOString() },
              }
            : previous
        )
        return
      }
      setGenerateFailed(true)
      setGenerateFailureCode(code)
      if (summaryBefore) setSupersededSummary(summaryBefore)
    } finally {
      if (requestedId === latestId.current) setIsGenerating(false)
    }
  }

  async function handleTranslate() {
    if (!id || !bookmark?.summary) return
    const requestedId = id
    const summaryAtRequest = bookmark.summary
    setIsTranslating(true)
    setFailedTranslationOf(null)
    try {
      const { translation: text, source, labels } = await api.translateSummary(requestedId)
      if (requestedId !== latestId.current) return
      setBookmark((previous) =>
        previous &&
        previous.id === requestedId &&
        previous.summary === summaryAtRequest &&
        previous.summary !== source
          ? { ...previous, summary: source, labels }
          : previous
      )
      setTranslation({ source, text })
      setShowTranslation(true)
    } catch {
      if (requestedId !== latestId.current) return
      setFailedTranslationOf(summaryAtRequest)
    } finally {
      if (requestedId === latestId.current) setIsTranslating(false)
    }
  }

  async function handleToggleRead(isRead: boolean) {
    if (!id) return
    const requestedId = id
    const token = ++readToggleToken.current
    pendingRead.current = { token, isRead, settledAtFetchId: null }
    setIsTogglingRead(true)
    setReadToggleFailed(false)
    setBookmark((previous) => (previous ? { ...previous, isRead } : previous))
    try {
      await api.setReadState(requestedId, isRead)
      if (readToggleToken.current === token && requestedId === latestId.current) {
        pendingRead.current = { token, isRead, settledAtFetchId: bookmarkFetchId.current }
        setBookmark((previous) =>
          previous && previous.id === requestedId && previous.isRead !== isRead
            ? { ...previous, isRead }
            : previous
        )
      }
    } catch {
      if (pendingRead.current?.token !== token) return
      pendingRead.current = null
      if (requestedId !== latestId.current) return
      setBookmark((previous) => (previous ? { ...previous, isRead: !isRead } : previous))
      setReadToggleFailed(true)
    } finally {
      if (readToggleToken.current === token && requestedId === latestId.current) {
        setIsTogglingRead(false)
      }
    }
  }

  async function handleDelete() {
    if (!id) return
    const requestedId = id
    setIsDeleting(true)
    setDeleteFailed(false)
    try {
      await api.deleteBookmark(requestedId)
      if (requestedId !== latestId.current) return
      navigate('/', { replace: true })
    } catch {
      if (requestedId !== latestId.current) return
      setDeleteFailed(true)
      setIsDeleting(false)
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

  const currentTranslation =
    translation && translation.source === bookmark.summary ? translation.text : null
  const canTranslate = Boolean(bookmark.summary && textLanguage(bookmark.summary) === 'en')
  const showingTranslation = showTranslation && currentTranslation !== null

  function describeEmptyState(): {
    message: string
    failed: boolean
    running: boolean
    offersButton: boolean
  } {
    const failed = (code: string | undefined) => ({
      message: videoSummaryMessage(code),
      failed: true,
      running: false,
      offersButton: code !== 'video_too_long',
    })
    if (isGenerating) {
      return { message: 'No summary yet.', failed: false, running: false, offersButton: true }
    }
    if (generateFailed && generateFailureCode !== undefined) return failed(generateFailureCode)
    if (videoState && !videoRunning) return failed(videoState.code)
    if (videoRunning) {
      return {
        message: VIDEO_SUMMARY_RUNNING_MESSAGE,
        failed: false,
        running: true,
        offersButton: true,
      }
    }
    if (generateFailed) return failed(undefined)
    return { message: 'No summary yet.', failed: false, running: false, offersButton: true }
  }
  const emptyState = describeEmptyState()

  function describeRegenerateState(): {
    message: string
    failed: boolean
    running: boolean
    offersButton: boolean
  } | null {
    const failed = (code: string | undefined) =>
      code !== undefined && videoSummaryMessage(code) !== GENERIC_SUMMARY_FAILURE_MESSAGE
        ? {
            message: `${videoSummaryMessage(code)} The summary above is unchanged.`,
            failed: true,
            running: false,
            offersButton: code !== 'video_too_long',
          }
        : {
            message: "Couldn't regenerate the summary — the one above is unchanged.",
            failed: true,
            running: false,
            offersButton: true,
          }
    if (isGenerating) return null
    if (
      generateFailed &&
      generateFailureCode !== undefined &&
      videoSummaryMessage(generateFailureCode) !== GENERIC_SUMMARY_FAILURE_MESSAGE
    ) {
      return failed(generateFailureCode)
    }
    if (videoRunning) {
      return {
        message: VIDEO_SUMMARY_RUNNING_MESSAGE,
        failed: false,
        running: true,
        offersButton: true,
      }
    }
    if (videoState) return failed(videoState.code)
    if (generateFailed) return failed(undefined)
    return null
  }
  const regenerateState = describeRegenerateState()

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

      {bookmark.labels && bookmark.labels.length > 0 && (
        <div data-testid="bookmark-labels" className="mt-3 flex flex-wrap gap-1.5">
          {bookmark.labels.map((label) => (
            <span
              key={label}
              className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600"
            >
              {label}
            </span>
          ))}
        </div>
      )}

      <h2 className="mt-8 mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
        Summary
      </h2>

      {bookmark.summary ? (
        <div className="flex flex-col items-start gap-4">
          <div
            aria-busy={isGenerating || isTranslating}
            className={`transition-opacity ${isGenerating || isTranslating ? 'opacity-50' : ''}`}
          >
            <SummaryBody summary={showingTranslation ? currentTranslation : bookmark.summary} />
          </div>
          {regenerateState?.failed && (
            <p className="m-0 flex items-center gap-2 text-sm text-red-700">
              <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" />
              {regenerateState.message}
            </p>
          )}
          {regenerateState?.running && (
            <p className="m-0 text-sm text-gray-500">{regenerateState.message}</p>
          )}
          {failedTranslationOf === bookmark.summary && (
            <p className="m-0 flex items-center gap-2 text-sm text-red-700">
              <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" />
              Couldn&apos;t translate the summary.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {canTranslate && (
              <button
                onClick={
                  currentTranslation === null
                    ? handleTranslate
                    : () => setShowTranslation(!showingTranslation)
                }
                disabled={isTranslating || isGenerating}
                className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-800 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <FontAwesomeIcon
                  icon={isTranslating ? faSpinner : faLanguage}
                  spin={isTranslating}
                  aria-hidden="true"
                />
                {isTranslating
                  ? 'Translating…'
                  : currentTranslation === null
                    ? 'Translate to Japanese'
                    : showingTranslation
                      ? 'Show English'
                      : 'Show Japanese'}
              </button>
            )}
            {(regenerateState?.offersButton ?? true) && (
              <button
                onClick={handleGenerate}
                disabled={isGenerating || isTranslating || Boolean(regenerateState?.running)}
                className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-800 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <FontAwesomeIcon
                  icon={isGenerating ? faSpinner : faRotate}
                  spin={isGenerating}
                  aria-hidden="true"
                />
                {isGenerating ? 'Regenerating…' : 'Regenerate'}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3">
          <p className="m-0 text-gray-500">{emptyState.message}</p>
          {emptyState.offersButton && (
            <button
              onClick={handleGenerate}
              disabled={isGenerating || emptyState.running}
              className="inline-flex items-center gap-2 rounded-md bg-amber-700 px-3 py-2 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <FontAwesomeIcon
                icon={isGenerating ? faSpinner : faWandMagicSparkles}
                spin={isGenerating}
                aria-hidden="true"
              />
              {isGenerating ? 'Generating…' : emptyState.failed ? 'Try again' : 'Generate summary'}
            </button>
          )}
        </div>
      )}

      <div className="mt-6 flex flex-col items-start gap-2">
        <ReadToggleButton
          label={describeBookmark(bookmark)}
          isRead={bookmark.isRead}
          isPending={isTogglingRead}
          onToggle={handleToggleRead}
          variant="labeled"
        />
        {readToggleFailed && (
          <p className="m-0 flex items-center gap-2 text-sm text-red-700">
            <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" />
            Couldn&apos;t save the read state.
          </p>
        )}
      </div>

      <ArticleChat key={bookmark.id} bookmarkId={bookmark.id} />

      <div className="mt-10 flex flex-col items-start gap-3 border-t border-gray-200 pt-4">
        {deleteFailed && (
          <p className="m-0 flex items-center gap-2 text-sm text-red-700">
            <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" />
            Couldn&apos;t delete this bookmark.
          </p>
        )}
        <DeleteBookmarkButton
          label={describeBookmark(bookmark)}
          isDeleting={isDeleting}
          onDelete={handleDelete}
          variant="labeled"
        />
      </div>
    </div>
  )
}
