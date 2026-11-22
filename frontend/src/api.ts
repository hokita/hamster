import { auth } from './firebase'

export interface Bookmark {
  id: string
  url: string
  title: string
  faviconUrl?: string
  summary?: string
  shortSummary?: string
  labels?: string[]
  // Always sent by the backend, which reads a missing stored field as false — so the UI never has
  // to treat "unknown" as a third state alongside read and unread.
  isRead: boolean
  createdAt: string
  // Present only on YouTube bookmarks: the backend derives it from the stored URL on every read.
  videoId?: string
  // The outcome of the last video summary run, kept so a page opened later can tell "still
  // working" from "already failed". Deleted by the server when a summary lands, so it is never
  // seen alongside the summary it was waiting for.
  videoSummaryState?: VideoSummaryState
}

export interface VideoSummaryState {
  status: 'running' | 'failed'
  code?: string
  updatedAt: string
}

// Keeps the message every caller already matched on ("API error: <status>") and adds what the
// response said, so a page that needs to tell one failure from another can, and the rest need not
// change.
export class ApiError extends Error {
  readonly status: number
  readonly code?: string

  constructor(status: number, code?: string) {
    super(`API error: ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export interface ChatMessage {
  role: 'user' | 'model'
  text: string
}

const BASE_URL = import.meta.env.VITE_API_URL ?? ''

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = await auth.currentUser?.getIdToken()
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options?.headers,
    },
  })
  if (!res.ok) {
    // The body is best effort: a proxy or the platform can answer with an HTML page, or nothing,
    // and that must still surface as the status rather than as a parse error.
    const body = await res.json().catch(() => null)
    const code: string | undefined = typeof body?.code === 'string' ? body.code : undefined
    throw new ApiError(res.status, code)
  }
  // DELETE answers 204 with no body at all, and res.json() rejects on an empty one — which would
  // turn a successful delete into a thrown error at every call site.
  if (res.status === 204) return undefined as T
  return res.json()
}

export const api = {
  listBookmarks: () => request<Bookmark[]>('/api/bookmarks'),
  createBookmark: (bookmark: { url: string }) =>
    request<Bookmark>('/api/bookmarks', {
      method: 'POST',
      body: JSON.stringify(bookmark),
    }),
  getBookmark: (id: string) => request<Bookmark>(`/api/bookmarks/${id}`),
  deleteBookmark: (id: string) => request<void>(`/api/bookmarks/${id}`, { method: 'DELETE' }),
  // Takes the state to store rather than "flip it", so a retry after a dropped response cannot
  // land the bookmark on the opposite of what the user asked for.
  setReadState: (id: string, isRead: boolean) =>
    request<void>(`/api/bookmarks/${id}/read`, {
      method: 'PUT',
      body: JSON.stringify({ isRead }),
    }),
  generateSummary: (id: string) =>
    request<{ summary: string; shortSummary?: string; labels?: string[] }>(
      `/api/bookmarks/${id}/summary`,
      {
        method: 'POST',
      }
    ),
  // No body: the backend translates the summary it has stored, so a caller cannot push arbitrary
  // text into a paid Gemini call. The result is not persisted — see the route. `source` is the
  // summary that was translated, which need not be the one the caller had on screen.
  translateSummary: (id: string) =>
    request<{ translation: string; source: string; labels?: string[] }>(
      `/api/bookmarks/${id}/translation`,
      {
        method: 'POST',
      }
    ),
  askQuestion: (id: string, messages: ChatMessage[]) =>
    request<{ answer: string }>(`/api/bookmarks/${id}/chat`, {
      method: 'POST',
      body: JSON.stringify({ messages }),
    }),
}
