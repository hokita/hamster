import { auth } from './firebase'

export interface Bookmark {
  id: string
  url: string
  title: string
  faviconUrl?: string
  summary?: string
  labels?: string[]
  // Always sent by the backend, which reads a missing stored field as false — so the UI never has
  // to treat "unknown" as a third state alongside read and unread.
  isRead: boolean
  createdAt: string
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
  if (!res.ok) throw new Error(`API error: ${res.status}`)
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
    request<{ summary: string; labels?: string[] }>(`/api/bookmarks/${id}/summary`, {
      method: 'POST',
    }),
  askQuestion: (id: string, messages: ChatMessage[]) =>
    request<{ answer: string }>(`/api/bookmarks/${id}/chat`, {
      method: 'POST',
      body: JSON.stringify({ messages }),
    }),
}
