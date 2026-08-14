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
  generateSummary: (id: string) =>
    request<{ summary: string }>(`/api/bookmarks/${id}/summary`, { method: 'POST' }),
}
