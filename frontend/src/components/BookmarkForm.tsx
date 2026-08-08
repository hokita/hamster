import { useState } from 'react'
import type { FormEvent } from 'react'

interface BookmarkFormProps {
  onAdd: (bookmark: { url: string; title: string }) => void | Promise<void>
}

export default function BookmarkForm({ onAdd }: BookmarkFormProps) {
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!url.trim() || !title.trim()) return
    await onAdd({ url: url.trim(), title: title.trim() })
    setUrl('')
    setTitle('')
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 p-4">
      <input
        id="bookmark-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        aria-label="Title"
        className="flex-1 border border-gray-300 rounded px-3 py-2"
      />
      <input
        id="bookmark-url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="URL"
        aria-label="URL"
        className="flex-1 border border-gray-300 rounded px-3 py-2"
      />
      <button
        type="submit"
        className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
      >
        Add bookmark
      </button>
    </form>
  )
}
