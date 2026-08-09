import { getFirestore, Timestamp } from 'firebase-admin/firestore'

export interface BookmarkDoc {
  id: string
  url: string
  title: string
  createdAt: string
}

export async function createBookmark(url: string, title: string): Promise<BookmarkDoc> {
  const db = getFirestore()
  const now = Timestamp.now()
  const ref = await db.collection('bookmarks').add({ url, title, createdAt: now })
  return { id: ref.id, url, title, createdAt: now.toDate().toISOString() }
}

export async function listBookmarks(): Promise<BookmarkDoc[]> {
  const db = getFirestore()
  const snap = await db.collection('bookmarks').orderBy('createdAt', 'desc').get()
  const bookmarks: BookmarkDoc[] = []
  for (const doc of snap.docs) {
    const data = doc.data() as {
      url?: unknown
      title?: unknown
      createdAt?: { toDate?: () => Date }
    }
    if (
      typeof data.url !== 'string' ||
      typeof data.title !== 'string' ||
      typeof data.createdAt?.toDate !== 'function'
    ) {
      continue
    }
    bookmarks.push({
      id: doc.id,
      url: data.url,
      title: data.title,
      createdAt: data.createdAt.toDate().toISOString(),
    })
  }
  return bookmarks
}
