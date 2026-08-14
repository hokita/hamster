import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import Markdown from 'react-markdown'
import type { Components } from 'react-markdown'
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
import DeleteBookmarkButton from '../components/DeleteBookmarkButton'

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

// The summary follows the article's own language when that language is Japanese, but index.html
// declares the document lang="en" — so without an override a screen reader reads Japanese text with
// English pronunciation rules and, often, an English voice. The backend does not record which
// language the model picked, so derive it here: the prompt only ever produces English or Japanese,
// and the two are far apart by script. A Japanese summary is nearly all kana and kanji, while an
// English one carries at most a quoted term or a name, so a share test separates them without
// taking on a language-detection dependency.
// Hiragana and katakana, CJK ideographs (kanji) and their extension A, and halfwidth katakana.
const JAPANESE_SCRIPT = /[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]/g
const JAPANESE_SHARE = 0.2

function summaryLanguage(summary: string): 'ja' | 'en' {
  const characters = summary.replace(/\s/g, '')
  if (!characters) return 'en'
  const japanese = characters.match(JAPANESE_SCRIPT)?.length ?? 0
  return japanese / characters.length >= JAPANESE_SHARE ? 'ja' : 'en'
}

// The summary arrives as Markdown (see the prompt in backend/src/services/summarizer.ts), so it is
// parsed rather than read line by line: the model is asked for a small subset — paragraphs, "## "
// headings, bullets, bold — but it is a model, and a hand-rolled reader would render whatever it
// improvises outside that subset as literal "[text](url)" noise. Summaries written before this
// feature are plain text, which is also valid Markdown, so they keep rendering as paragraphs and
// bullets exactly as before.
//
// Markdown that came out of an untrusted page is still untrusted. react-markdown does not render
// raw HTML unless rehype-raw is added (it is not), which leaves link and image URLs as the only
// live surface — so both are dropped rather than sanitized. Nothing in the prompt asks for them,
// the page has nothing to gain from a URL the model copied out of an article, and a convincing
// link to somewhere else is exactly what a hostile page would want out of this.
//
// A link's text is its children, so unwrapDisallowed keeps it. An image's is its alt attribute,
// which unwrapping would throw away with the node — hence the component below rather than a second
// entry here.
const DISALLOWED_ELEMENTS = ['a']

// The image itself is dropped: no request is made and no URL reaches the page, but a caption that
// carried meaning survives as the text it already was.
function SummaryImageText({ alt }: { alt?: string }) {
  return <>{alt}</>
}

// Bullets in summaries stored before this feature are whatever the model happened to emit, and the
// line reader this replaced accepted "・" alongside "-" and "*". CommonMark does not: a run of
// "・" lines is one paragraph, and its line breaks collapse to spaces, so those bullets would run
// together into a single block of text. Rewriting the marker costs one pass and keeps the promise
// that an old summary renders as it always did. Anchored to the start of the line so a "・" used
// mid-sentence, as Japanese does for a compound name, is left alone.
const LEGACY_BULLET = /^([ \t]*)・[ \t]*(?=\S)/gm

function normalizeLegacyBullets(summary: string): string {
  return summary.replace(LEGACY_BULLET, '$1- ')
}

// The model writes its own headings, so they land under the page's "Summary" <h2> — h3 keeps the
// document outline intact whichever level (# or ##) the model reached for.
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
  // The prompt rules out code blocks and blockquotes, but a model is not a parser: styling them
  // costs two lines and keeps a summary that ignores the rules readable instead of ragged. The
  // scroll container matters most — an unwrapped code line would otherwise widen the whole page.
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
}

function SummaryBody({ summary }: { summary: string }) {
  return (
    // gap-3 spaces the blocks, so every child above resets its own margin to zero rather than
    // stacking browser defaults on top of it.
    <div
      lang={summaryLanguage(summary)}
      className="flex flex-col gap-3 text-gray-700 leading-relaxed"
    >
      <Markdown
        components={SUMMARY_COMPONENTS}
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
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteFailed, setDeleteFailed] = useState(false)
  // The summary on screen when a generation request failed without proving the write never
  // happened. Express does not abort a handler when the client goes away, so the backend keeps
  // generating and may persist a summary seconds after the request died. Holding the old text here
  // tells the polling effect below to keep watching for it to change; without that the page would
  // sit on a superseded summary until a manual reload, because polling otherwise stops the moment
  // any summary is present. Cleared as soon as something replaces it.
  const [supersededSummary, setSupersededSummary] = useState<string | null>(null)
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
    setSupersededSummary(null)
    setIsDeleting(false)
    setDeleteFailed(false)
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
    // Two things are worth waiting for: a first summary, and a replacement for one whose
    // regeneration request died mid-flight. Anything else is already up to date.
    if (bookmark.summary && bookmark.summary !== supersededSummary) return
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
          if (!result.summary) return
          if (result.summary === supersededSummary) return
          setBookmark(result)
          // A summary arriving here settles any earlier failure: the user's own request may have
          // failed while the generation kicked off on the add page was still running, or while the
          // regeneration it started went on to finish server-side. Leaving the flag set would
          // caption the summary that just appeared with an error that no longer describes it,
          // because the summary-present branch below renders `generateFailed`.
          setGenerateFailed(false)
          setSupersededSummary(null)
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
  }, [id, bookmark, isGenerating, supersededSummary])

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
    setSupersededSummary(null)
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
      // The re-read above is a single snapshot, and the losing request may simply have died before
      // the backend finished — it keeps generating regardless, so the write can still be seconds
      // out. Hand the text to the poll above to watch, rather than settling for "unchanged" on one
      // sample. Only meaningful when a summary was already displayed; from the empty state the
      // poll resumes on its own.
      if (summaryBefore) setSupersededSummary(summaryBefore)
    } finally {
      if (requestedId === latestId.current) setIsGenerating(false)
    }
  }

  async function handleDelete() {
    if (!id) return
    const requestedId = id
    setIsDeleting(true)
    setDeleteFailed(false)
    try {
      await api.deleteBookmark(requestedId)
      // Same staleness guard the generation handler uses: if the user has since opened another
      // bookmark, the delete they asked for is done, but yanking them back to the list would be
      // a navigation they never requested. The reset on id change already cleared isDeleting.
      if (requestedId !== latestId.current) return
      // This page is about a bookmark that no longer exists, so there is nothing left to show.
      // Replace rather than push: going Back should not land on a page that can only 404 now.
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

      {/* Kept below the summary and behind a rule: it is the one irreversible action on the page,
          so it sits away from the buttons a reader reaches for repeatedly. */}
      <div className="mt-10 flex flex-col items-start gap-3 border-t border-gray-200 pt-4">
        {deleteFailed && (
          <p className="m-0 flex items-center gap-2 text-sm text-red-700">
            <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" />
            Couldn&apos;t delete this bookmark.
          </p>
        )}
        <DeleteBookmarkButton
          title={bookmark.title}
          isDeleting={isDeleting}
          onDelete={handleDelete}
          variant="labeled"
        />
      </div>
    </div>
  )
}
