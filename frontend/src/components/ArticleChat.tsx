import { useState } from 'react'
import type { FormEvent } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faPaperPlane,
  faRotate,
  faSpinner,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import { api } from '../api'
import type { ChatMessage } from '../api'
import { textLanguage } from '../textLanguage'

const MAX_MESSAGES = 40
const MAX_QUESTION_CHARS = 4000
const MAX_HISTORY_BYTES = 70_000

export default function ArticleChat({ bookmarkId }: { bookmarkId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [question, setQuestion] = useState('')
  const [isAsking, setIsAsking] = useState(false)
  const [askFailed, setAskFailed] = useState(false)

  const isFull =
    messages.length >= MAX_MESSAGES ||
    new TextEncoder().encode(JSON.stringify(messages)).length >= MAX_HISTORY_BYTES

  async function send(conversation: ChatMessage[]) {
    setIsAsking(true)
    setAskFailed(false)
    try {
      const { answer } = await api.askQuestion(bookmarkId, conversation)
      setMessages([...conversation, { role: 'model', text: answer }])
    } catch {
      setAskFailed(true)
    } finally {
      setIsAsking(false)
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const text = question.trim()
    if (!text || isAsking || isFull || askFailed || text.length > MAX_QUESTION_CHARS) return
    const conversation = [...messages, { role: 'user' as const, text }]
    setMessages(conversation)
    setQuestion('')
    void send(conversation)
  }

  return (
    <div className="mt-10">
      <h2 className="mt-0 mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
        Ask a question
      </h2>
      <p className="m-0 mb-3 text-sm text-gray-500">Ask about this article or any other topic.</p>

      {messages.length > 0 && (
        <ul role="log" aria-label="Conversation" className="m-0 mb-3 flex list-none flex-col gap-2 p-0">
          {messages.map((message, index) => (
            <li
              key={index}
              lang={textLanguage(message.text)}
              className={
                message.role === 'user'
                  ? 'ml-8 max-w-full self-end break-words rounded-lg bg-amber-50 px-3 py-2 text-sm text-gray-800'
                  : 'mr-8 max-w-full self-start break-words whitespace-pre-wrap rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-800'
              }
            >
              {message.text}
            </li>
          ))}
          {isAsking && (
            <li
              role="status"
              aria-label="Waiting for the answer"
              className="mr-8 self-start rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-400"
            >
              <FontAwesomeIcon icon={faSpinner} spin aria-hidden="true" />
            </li>
          )}
        </ul>
      )}

      {askFailed && (
        <div className="mb-3 flex items-center gap-3">
          <p role="alert" className="m-0 flex items-center gap-2 text-sm text-red-700">
            <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" />
            Couldn&apos;t answer that question.
          </p>
          <button
            onClick={() => void send(messages)}
            disabled={isAsking}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-800 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <FontAwesomeIcon icon={faRotate} aria-hidden="true" />
            Retry
          </button>
          <button
            onClick={() => {
              setMessages(messages.slice(0, -1))
              setAskFailed(false)
            }}
            disabled={isAsking}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-800 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            Discard
          </button>
        </div>
      )}

      {isFull && (
        <p className="m-0 mb-3 text-sm text-gray-500">
          This conversation is full — leave the page and come back to start a fresh one.
        </p>
      )}

      <form onSubmit={handleSubmit} className="flex items-start gap-2">
        <textarea
          aria-label="Ask a question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="e.g. What is the main argument? Or ask about any topic."
          rows={2}
          maxLength={MAX_QUESTION_CHARS}
          disabled={isFull || askFailed}
          className="min-w-0 flex-1 resize-y rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-amber-700 focus:outline-none disabled:bg-gray-50 disabled:cursor-not-allowed"
        />
        <button
          type="submit"
          disabled={isAsking || isFull || askFailed || !question.trim()}
          className="inline-flex items-center gap-2 rounded-md bg-amber-700 px-3 py-2 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          <FontAwesomeIcon
            icon={isAsking ? faSpinner : faPaperPlane}
            spin={isAsking}
            aria-hidden="true"
          />
          Ask
        </button>
      </form>
    </div>
  )
}
