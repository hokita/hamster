import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'

export interface BookmarkDoc {
  id: string
  url: string
  title: string
  faviconUrl?: string
  summary?: string
  labels?: string[]
  // Always present, unlike the optional fields above: a bookmark is either read or not, and
  // "the field is missing" is not a third state a caller should have to think about. Documents
  // written before this feature simply have no `isRead` key, which toBookmark reads as unread.
  isRead: boolean
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
  // isRead is written explicitly rather than left implicit-by-absence: a stored field is what
  // lets a future query filter on it, and Firestore cannot match documents that lack the key.
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

// Shared by listBookmarks and getBookmark. Returns null for any document that doesn't carry the
// fields the app requires, so one malformed document can't break a whole listing.
function toBookmark(id: string, data: unknown): BookmarkDoc | null {
  const doc = data as {
    url?: unknown
    title?: unknown
    faviconUrl?: unknown
    summary?: unknown
    labels?: unknown
    isRead?: unknown
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
    // Compared against true rather than coerced, so a document carrying anything other than a
    // boolean here (a hand-edited field, a future migration mid-flight) reads as unread instead
    // of as whatever that value happens to be truthy for. Absent — every bookmark saved before
    // this feature — is unread, which is what "I haven't marked it read" means.
    isRead: doc.isRead === true,
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
  // Within one process, a stored document can never pair a new summary with the previous
  // page-version's labels: the labeler runs afterward and may fail (network, quota, a bad
  // response), which would otherwise leave stale topics attached to text they no longer describe.
  // Clearing labels atomically in this same write — not as a second call — means any snapshot a
  // client reads has either the old summary with its old labels, or the new summary with no
  // labels, never a mixed pair, as long as one process owns the sequence. That is also what lets
  // the detail page's poll treat "labels present" as a reliable completion signal.
  //
  // Two Cloud Run instances regenerating the same bookmark concurrently — the per-process dedup
  // gap the route documents and accepts — can still interleave their summary and label writes, so
  // a client can transiently observe a summary from one run paired with labels from the other.
  // That pairing is still both from the same, current regeneration attempt, never a previous page
  // version's labels, and it self-heals the next time either run's labels write lands.
  await db.collection('bookmarks').doc(id).update({ summary, labels: FieldValue.delete() })
}

// Firestore's status code for "no document to update" (google.rpc.Code.NOT_FOUND). update()
// rejects with it rather than creating the document, which is what lets setReadState below report
// a missing bookmark instead of resurrecting a deleted one as a document holding nothing but a
// read flag — a row the list would then have to skip as malformed.
const NOT_FOUND = 5

// Returns false when the bookmark no longer exists. Reported from the write's own failure rather
// than from a preceding existence check: one round trip instead of two, and no window in between
// where a concurrent delete lands after the check said the document was there.
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
