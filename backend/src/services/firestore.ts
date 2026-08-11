import { getFirestore, Timestamp } from 'firebase-admin/firestore'

export interface BookmarkDoc {
  id: string
  url: string
  title: string
  faviconUrl?: string
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

export async function listBookmarks(): Promise<BookmarkDoc[]> {
  const db = getFirestore()
  const snap = await db.collection('bookmarks').orderBy('createdAt', 'desc').get()
  const bookmarks: BookmarkDoc[] = []
  for (const doc of snap.docs) {
    const data = doc.data() as {
      url?: unknown
      title?: unknown
      faviconUrl?: unknown
      createdAt?: { toDate?: () => Date }
    }
    if (
      typeof data.url !== 'string' ||
      typeof data.title !== 'string' ||
      typeof data.createdAt?.toDate !== 'function'
    ) {
      continue
    }
    // faviconUrl is deliberately absent from the validation above: every document written
    // before this field existed lacks it, and gating on it would drop the entire back catalogue.
    bookmarks.push({
      id: doc.id,
      url: data.url,
      title: data.title,
      ...(typeof data.faviconUrl === 'string' ? { faviconUrl: data.faviconUrl } : {}),
      createdAt: data.createdAt.toDate().toISOString(),
    })
  }
  return bookmarks
}
