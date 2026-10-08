import { useEffect, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faSpinner, faWandMagicSparkles } from '@fortawesome/free-solid-svg-icons'
import { api } from '../api'
import { textLanguage } from '../textLanguage'
import type { VisualSummary } from '../../../backend/src/visualSummary'
import VisualSummaryView from './VisualSummary'

interface Props {
  bookmarkId: string
  summary: string
  disabled?: boolean
}

export default function VisualSummaryPanel(props: Props) {
  // Remount on navigation, source changes, or regeneration starting/ending (even if the text
  // ultimately stays identical). This also resets native checkbox/details state immediately.
  return (
    <VisualSummarySession
      key={JSON.stringify([props.bookmarkId, props.summary, Boolean(props.disabled)])}
      {...props}
    />
  )
}

function VisualSummarySession({ bookmarkId, summary, disabled }: Props) {
  const [value, setValue] = useState<VisualSummary | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const request = useRef<AbortController | null>(null)
  const active = useRef(false)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
      request.current?.abort()
    }
  }, [])

  async function generate() {
    // The ref closes the gap before React commits the disabled button.
    if (disabled || request.current) return
    const controller = new AbortController()
    request.current = controller
    const timeout = setTimeout(() => controller.abort(), 35_000)
    setPending(true)
    setError(null)
    try {
      const result = await api.generateVisualSummary(bookmarkId, controller.signal)
      if (!active.current || request.current !== controller) return
      // Do not attach fresh server text to an older summary on screen; never overwrite a
      // summary update that landed while waiting. A reload lets the reader reconcile it.
      if (result.source !== summary) {
        setError('The saved summary changed. Reload this page and try again.')
        return
      }
      setValue(result.visualSummary)
    } catch (cause) {
      if (!active.current || request.current !== controller) return
      const message = cause instanceof Error ? cause.message : ''
      setError(
        message === 'API error: 503'
          ? 'Visual summary is unavailable. Configure GEMINI_API_KEY on the server.'
          : message === 'API error: 409'
            ? 'The saved summary changed. Reload this page and try again.'
            : controller.signal.aborted || message === 'API error: 504'
              ? 'Visual summary timed out. Try again.'
              : "Couldn't generate a visual summary. Try again."
      )
    } finally {
      clearTimeout(timeout)
      if (active.current && request.current === controller) {
        request.current = null
        setPending(false)
      }
    }
  }

  return (
    <section aria-label="Visual summary" className="mt-6 w-full border-t border-gray-200 pt-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
        Visual summary
      </h2>
      {!value && (
        <button
          type="button"
          onClick={generate}
          disabled={disabled || pending}
          className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
        >
          <FontAwesomeIcon
            icon={pending ? faSpinner : faWandMagicSparkles}
            spin={pending}
            aria-hidden="true"
          />
          {pending ? 'Generating visual summary…' : error ? 'Try again' : 'Generate visual summary'}
        </button>
      )}
      <p role="status" className={pending || value ? 'mt-2 text-sm text-gray-500' : 'sr-only'}>
        {pending ? 'Generating visual summary…' : value ? 'Visual summary generated.' : ''}
      </p>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {value && (
        <div lang={textLanguage(summary)} className="mt-3">
          <VisualSummaryView value={value} />
        </div>
      )}
    </section>
  )
}
