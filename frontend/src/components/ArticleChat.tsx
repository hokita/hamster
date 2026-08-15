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

// Mirrors of the backend's chat bounds (parseChatMessages in backend/src/routes/bookmarks.ts).
// They must be enforced here too: a failed turn deliberately stays in the history so Retry can
// resend it, so a request the backend will always 400 — an over-long question, a 41st message —
// would leave the chat failing forever with no way out short of navigating away.
const MAX_MESSAGES = 40
const MAX_QUESTION_CHARS = 4000
// The backend's express.json() rejects bodies over 100kb before the route's own validation runs,
// and by then the oversized history is retained — not even Discard can shrink it. A few long
// answers get there while every individual turn stays valid, so the history is also bounded in
// bytes (what the limit is measured in — Japanese runs 3 bytes a char), with room left for one
// full-size question (4000 chars ≤ 16kb) plus JSON overhead under the 100kb line.
const MAX_HISTORY_BYTES = 70_000

// The chat is deliberately not persisted: it lives in this component's state and is gone on
// navigation. The parent mounts this with key={bookmark.id}, so switching bookmarks resets it
// instead of carrying one article's conversation onto another.
export default function ArticleChat({ bookmarkId }: { bookmarkId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [question, setQuestion] = useState('')
  const [isAsking, setIsAsking] = useState(false)
  const [askFailed, setAskFailed] = useState(false)

  // A new question appends one user turn, so the conversation is full once it holds MAX_MESSAGES
  // — or once its serialized size leaves no safe room for that turn.
  const isFull =
    messages.length >= MAX_MESSAGES ||
    new TextEncoder().encode(JSON.stringify(messages)).length >= MAX_HISTORY_BYTES

  // Sends a history whose last turn is the pending user question — the shape the endpoint
  // requires. Shared by submit (which appends the new question first) and Retry (which resends
  // the history as it stands).
  async function send(conversation: ChatMessage[]) {
    setIsAsking(true)
    setAskFailed(false)
    try {
      const { answer } = await api.askQuestion(bookmarkId, conversation)
      setMessages([...conversation, { role: 'model', text: answer }])
    } catch {
      // The unanswered question stays in the list so Retry can resend the same conversation.
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
        Ask about this article
      </h2>

      {messages.length > 0 && (
        // role="log" is the chat semantic: an implicit polite live region that announces
        // additions — each arriving answer — without re-reading the whole history.
        <ul role="log" aria-label="Conversation" className="m-0 mb-3 flex list-none flex-col gap-2 p-0">
          {messages.map((message, index) => (
            <li
              key={index}
              // Per message, not per conversation: a question in one language can get context
              // from turns in another, so each bubble carries its own derived lang.
              lang={textLanguage(message.text)}
              className={
                // max-w-full + break-words: an unbroken token (a pasted URL, a hash) would
                // otherwise set the flex item's intrinsic width and drag the page into
                // horizontal overflow.
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
          {/* role="alert": the waiting status vanishing is the only other signal a failure
              gives, and a screen reader hears nothing in it. */}
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
          {/* The way out when retrying keeps failing: drops the unanswered turn so the form,
              closed while a failed turn is pending, opens again. */}
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
          aria-label="Ask a question about this article"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="e.g. What is the main argument?"
          rows={2}
          maxLength={MAX_QUESTION_CHARS}
          // Closed while a failed turn is pending: another question would append a second
          // consecutive user turn, and the one answer would read as a reply to both.
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
