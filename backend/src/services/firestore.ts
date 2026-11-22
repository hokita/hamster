import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'
import { VIDEO_MODEL } from './videoSummarizer'

export type VideoSummaryCode =
  | 'video_too_long'
  | 'video_unavailable'
  | 'video_live'
  | 'video_no_content'
  | 'video_length_unknown'
  | 'generic'

const VIDEO_SUMMARY_CODES: readonly string[] = [
  'video_too_long',
  'video_unavailable',
  'video_live',
  'video_no_content',
  'video_length_unknown',
  'generic',
]

export interface BookmarkDoc {
  id: string
  url: string
  title: string
  faviconUrl?: string
  summary?: string
  shortSummary?: string
  labels?: string[]
  isRead: boolean
  videoSummaryState?: { status: 'running' | 'failed'; code?: VideoSummaryCode; updatedAt: string }
  createdAt: string
}

export async function createBookmark(
  url: string,
  title: string,
  faviconUrl?: string | null
): Promise<BookmarkDoc> {
  const db = getFirestore()
  const now = Timestamp.now()
  const favicon = faviconUrl ? { faviconUrl } : {}
  const ref = await db
    .collection('bookmarks')
    .add({ url, title, ...favicon, isRead: false, createdAt: now })
  return {
    id: ref.id,
    url,
    title,
    ...favicon,
    isRead: false,
    createdAt: now.toDate().toISOString(),
  }
}

function toVideoSummaryState(value: unknown): BookmarkDoc['videoSummaryState'] {
  const state = value as { status?: unknown; code?: unknown; updatedAt?: { toDate?: () => Date } }
  if (typeof state !== 'object' || state === null) return undefined
  if (state.status !== 'running' && state.status !== 'failed') return undefined
  if (typeof state.updatedAt?.toDate !== 'function') return undefined
  if (state.code !== undefined && !VIDEO_SUMMARY_CODES.includes(state.code as string)) {
    return undefined
  }
  return {
    status: state.status,
    ...(state.code !== undefined ? { code: state.code as VideoSummaryCode } : {}),
    updatedAt: state.updatedAt.toDate().toISOString(),
  }
}

function toBookmark(id: string, data: unknown): BookmarkDoc | null {
  const doc = data as {
    url?: unknown
    title?: unknown
    faviconUrl?: unknown
    summary?: unknown
    shortSummary?: unknown
    labels?: unknown
    isRead?: unknown
    videoSummaryState?: unknown
    createdAt?: { toDate?: () => Date }
  }
  if (
    typeof doc.url !== 'string' ||
    typeof doc.title !== 'string' ||
    typeof doc.createdAt?.toDate !== 'function'
  ) {
    return null
  }
  const videoSummaryState = toVideoSummaryState(doc.videoSummaryState)
  return {
    id,
    url: doc.url,
    title: doc.title,
    ...(typeof doc.faviconUrl === 'string' ? { faviconUrl: doc.faviconUrl } : {}),
    ...(typeof doc.summary === 'string' ? { summary: doc.summary } : {}),
    ...(typeof doc.shortSummary === 'string' ? { shortSummary: doc.shortSummary } : {}),
    ...(Array.isArray(doc.labels) && doc.labels.every((label) => typeof label === 'string')
      ? { labels: doc.labels as string[] }
      : {}),
    isRead: doc.isRead === true,
    ...(videoSummaryState ? { videoSummaryState } : {}),
    createdAt: doc.createdAt.toDate().toISOString(),
  }
}

export async function getBookmark(id: string): Promise<BookmarkDoc | null> {
  const db = getFirestore()
  const snap = await db.collection('bookmarks').doc(id).get()
  if (!snap.exists) return null
  return toBookmark(snap.id, snap.data())
}

export async function updateSummary(
  id: string,
  summary: string,
  shortSummary?: string
): Promise<void> {
  const db = getFirestore()
  await db
    .collection('bookmarks')
    .doc(id)
    .update({
      summary,
      shortSummary: shortSummary ?? FieldValue.delete(),
      labels: FieldValue.delete(),
    })
}

const NOT_FOUND = 5

export async function setReadState(id: string, isRead: boolean): Promise<boolean> {
  const db = getFirestore()
  try {
    await db.collection('bookmarks').doc(id).update({ isRead })
    return true
  } catch (error) {
    if ((error as { code?: unknown }).code === NOT_FOUND) return false
    throw error
  }
}

export async function updateLabels(id: string, labels: string[]): Promise<void> {
  const db = getFirestore()
  await db.collection('bookmarks').doc(id).update({ labels })
}

const MAX_VOCABULARY = 100

export async function listAllLabels(): Promise<string[]> {
  const db = getFirestore()
  const snap = await db.collection('bookmarks').select('labels').get()
  const counts = new Map<string, number>()
  for (const doc of snap.docs) {
    const value = (doc.data() as { labels?: unknown }).labels
    if (!Array.isArray(value)) continue
    for (const label of value) {
      if (typeof label !== 'string') continue
      counts.set(label, (counts.get(label) ?? 0) + 1)
    }
  }

  if (counts.size <= MAX_VOCABULARY) {
    return [...counts.keys()].sort()
  }

  const mostFrequent = [...counts.entries()]
    .sort(([labelA, countA], [labelB, countB]) =>
      countB !== countA ? countB - countA : labelA.localeCompare(labelB)
    )
    .slice(0, MAX_VOCABULARY)
    .map(([label]) => label)

  return mostFrequent.sort()
}

export async function deleteBookmark(id: string): Promise<void> {
  const db = getFirestore()
  const batch = db.batch()
  batch.delete(db.collection('bookmarks').doc(id))
  batch.delete(db.collection('transcripts').doc(id))
  await batch.commit()
}

export async function getTranscript(bookmarkId: string): Promise<string | null> {
  const db = getFirestore()
  const snap = await db.collection('transcripts').doc(bookmarkId).get()
  if (!snap.exists) return null
  const transcript = (snap.data() as { transcript?: unknown } | undefined)?.transcript
  return typeof transcript === 'string' ? transcript : null
}

export async function saveVideoSummary(
  id: string,
  data: {
    videoId: string
    transcript: string
    summary: string
    shortSummary?: string
    title?: string
  }
): Promise<void> {
  const db = getFirestore()
  const batch = db.batch()
  batch.set(db.collection('transcripts').doc(id), {
    videoId: data.videoId,
    transcript: data.transcript,
    model: VIDEO_MODEL,
    createdAt: Timestamp.now(),
  })
  batch.update(db.collection('bookmarks').doc(id), {
    summary: data.summary,
    shortSummary: data.shortSummary ?? FieldValue.delete(),
    labels: FieldValue.delete(),
    videoSummaryState: FieldValue.delete(),
    ...(data.title !== undefined ? { title: data.title } : {}),
  })
  await batch.commit()
}

export async function setVideoSummaryState(
  id: string,
  state: { status: 'running' } | { status: 'failed'; code: VideoSummaryCode }
): Promise<void> {
  const db = getFirestore()
  try {
    await db
      .collection('bookmarks')
      .doc(id)
      .update({ videoSummaryState: { ...state, updatedAt: Timestamp.now() } })
  } catch (error) {
    if ((error as { code?: unknown }).code === NOT_FOUND) return
    throw error
  }
}

export async function listBookmarks(): Promise<BookmarkDoc[]> {
  const db = getFirestore()
  const snap = await db.collection('bookmarks').orderBy('createdAt', 'desc').get()
  const bookmarks: BookmarkDoc[] = []
  for (const doc of snap.docs) {
    const bookmark = toBookmark(doc.id, doc.data())
    if (bookmark) bookmarks.push(bookmark)
  }
  return bookmarks
}

export async function takeSummarySlot({
  limit,
  windowMs,
}: {
  limit: number
  windowMs: number
}): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> {
  const db = getFirestore()
  const ref = db.collection('usage').doc('mcpSummaries')
  return db.runTransaction(async (tx) => {
    const now = Date.now()
    const snap = await tx.get(ref)
    const stored = (snap.data() as { startedAt?: unknown } | undefined)?.startedAt
    const kept = (Array.isArray(stored) ? stored : [])
      .filter((entry): entry is Timestamp => typeof entry?.toMillis === 'function')
      .filter((entry) => entry.toMillis() > now - windowMs)
      .sort((a, b) => a.toMillis() - b.toMillis())
    if (kept.length >= limit) {
      const waitMs = kept[0].toMillis() + windowMs - now
      return { ok: false as const, retryAfterSeconds: Math.ceil(waitMs / 1000) }
    }
    tx.set(ref, { startedAt: [...kept, Timestamp.fromMillis(now)] })
    return { ok: true as const }
  })
}
