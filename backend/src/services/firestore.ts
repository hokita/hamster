import { getFirestore, Timestamp } from 'firebase-admin/firestore'

export interface BookmarkDoc {
  id: string
  url: string
  title: string
  faviconUrl?: string
  summary?: string
  labels?: string[]
  createdAt: string
}

export async function createBookmark(
  url: string,
  title: string,
  faviconUrl?: string | null
): Promise<BookmarkDoc> {
  const db = getFirestore()
  const now = Timestamp.now()
  // Firestore rejects undefined values, so the key is omitted rather than written as undefined.
  const favicon = faviconUrl ? { faviconUrl } : {}
  const ref = await db.collection('bookmarks').add({ url, title, ...favicon, createdAt: now })
  return { id: ref.id, url, title, ...favicon, createdAt: now.toDate().toISOString() }
}

// Shared by listBookmarks and getBookmark. Returns null for any document that doesn't carry the
// fields the app requires, so one malformed document can't break a whole listing.
function toBookmark(id: string, data: unknown): BookmarkDoc | null {
  const doc = data as {
    url?: unknown
    title?: unknown
    faviconUrl?: unknown
    summary?: unknown
    labels?: unknown
    createdAt?: { toDate?: () => Date }
  }
  if (
    typeof doc.url !== 'string' ||
    typeof doc.title !== 'string' ||
    typeof doc.createdAt?.toDate !== 'function'
  ) {
    return null
  }
  // faviconUrl and summary are deliberately absent from the validation above: every document
  // written before those fields existed lacks them, and gating on them would drop the entire
  // back catalogue.
  return {
    id,
    url: doc.url,
    title: doc.title,
    ...(typeof doc.faviconUrl === 'string' ? { faviconUrl: doc.faviconUrl } : {}),
    ...(typeof doc.summary === 'string' ? { summary: doc.summary } : {}),
    ...(Array.isArray(doc.labels) && doc.labels.every((label) => typeof label === 'string')
      ? { labels: doc.labels as string[] }
      : {}),
    createdAt: doc.createdAt.toDate().toISOString(),
  }
}

export async function getBookmark(id: string): Promise<BookmarkDoc | null> {
  const db = getFirestore()
  const snap = await db.collection('bookmarks').doc(id).get()
  if (!snap.exists) return null
  return toBookmark(snap.id, snap.data())
}

export async function updateSummary(id: string, summary: string): Promise<void> {
  const db = getFirestore()
  await db.collection('bookmarks').doc(id).update({ summary })
}

export async function updateLabels(id: string, labels: string[]): Promise<void> {
  const db = getFirestore()
  await db.collection('bookmarks').doc(id).update({ labels })
}

// Bounds the prompt the labeler builds from this list; an unbounded union grows forever and
// degrades the reuse instruction.
const MAX_VOCABULARY = 100

// Feeds the labeler's "prefer existing labels" vocabulary. A select-only scan of the whole
// collection is fine at single-user scale and avoids a second source of truth.
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
  await db.collection('bookmarks').doc(id).delete()
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
