import { auth } from './firebase'

export interface Bookmark {
  id: string
  url: string
  title: string
  faviconUrl?: string
  summary?: string
  labels?: string[]
  createdAt: string
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
  generateSummary: (id: string) =>
    request<{ summary: string; labels?: string[] }>(`/api/bookmarks/${id}/summary`, {
      method: 'POST',
    }),
}
