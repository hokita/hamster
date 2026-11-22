import { auth } from './firebase'

export interface Bookmark {
  id: string
  url: string
  title: string
  faviconUrl?: string
  summary?: string
  shortSummary?: string
  labels?: string[]
  isRead: boolean
  createdAt: string
  videoId?: string
  videoSummaryState?: VideoSummaryState
}

export interface VideoSummaryState {
  status: 'running' | 'failed'
  code?: string
  updatedAt: string
}

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
    const body = await res.json().catch(() => null)
    const code: string | undefined = typeof body?.code === 'string' ? body.code : undefined
    throw new ApiError(res.status, code)
  }
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
