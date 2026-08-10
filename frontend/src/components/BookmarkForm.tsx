import { useState } from 'react'
import type { FormEvent } from 'react'

interface BookmarkFormProps {
  onAdd: (bookmark: { url: string }) => void | Promise<void>
}

export default function BookmarkForm({ onAdd }: BookmarkFormProps) {
  const [url, setUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (submitting || !url.trim()) return
    setSubmitting(true)
    try {
      await onAdd({ url: url.trim() })
      setUrl('')
    } catch {
      // onAdd failed; leave the field populated so the user doesn't lose their input
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 p-4">
      <input
        id="bookmark-url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="URL"
        aria-label="URL"
        disabled={submitting}
        className="flex-1 border border-gray-300 rounded px-3 py-2"
      />
      <button
        type="submit"
        disabled={submitting}
        className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        Add bookmark
      </button>
    </form>
  )
}
