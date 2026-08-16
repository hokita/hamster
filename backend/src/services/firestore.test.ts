import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGet = vi.fn()
const mockAdd = vi.fn()
const mockOrderBy = vi.fn(() => ({ get: mockGet }))
const mockDocGet = vi.fn()
const mockUpdate = vi.fn()
const mockDelete = vi.fn()
const mockDoc = vi.fn(() => ({ get: mockDocGet, update: mockUpdate, delete: mockDelete }))
const mockSelect = vi.fn(() => ({ get: mockGet }))
const mockCollection = vi.fn(() => ({
  orderBy: mockOrderBy,
  add: mockAdd,
  doc: mockDoc,
  select: mockSelect,
}))
const fixedDate = new Date('2024-01-01T00:00:00.000Z')

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ collection: mockCollection }),
  Timestamp: { now: () => ({ toDate: () => fixedDate }) },
  FieldValue: { delete: () => 'DELETE_SENTINEL' },
}))

import {
  listBookmarks,
  createBookmark,
  getBookmark,
  updateSummary,
  updateLabels,
  listAllLabels,
  deleteBookmark,
  setReadState,
} from './firestore'

beforeEach(() => {
  vi.clearAllMocks()
  mockAdd.mockResolvedValue({ id: 'new-id' })
})

describe('listBookmarks', () => {
  it('skips a document with a malformed createdAt instead of failing the whole list', async () => {
    mockGet.mockResolvedValue({
      docs: [
        {
          id: 'good',
          data: () => ({
            url: 'https://example.com',
            title: 'Good',
            createdAt: { toDate: () => new Date('2024-01-01T00:00:00.000Z') },
          }),
        },
        {
          id: 'bad',
          data: () => ({
            url: 'https://example.com',
            title: 'Bad',
            createdAt: 'not-a-timestamp',
          }),
        },
      ],
    })

    const result = await listBookmarks()

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('good')
  })
})

describe('createBookmark', () => {
  it('persists faviconUrl when one was resolved', async () => {
    const result = await createBookmark(
      'https://example.com',
      'Example',
      'https://example.com/f.ico'
    )

    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({ faviconUrl: 'https://example.com/f.ico' })
    )
    expect(result.faviconUrl).toBe('https://example.com/f.ico')
  })

  it('omits the faviconUrl key entirely when null, since Firestore rejects undefined', async () => {
    const result = await createBookmark('https://example.com', 'Example', null)

    expect(mockAdd).toHaveBeenCalledTimes(1)
    expect(Object.keys(mockAdd.mock.calls[0][0])).not.toContain('faviconUrl')
    expect(result).not.toHaveProperty('faviconUrl')
  })

  it('omits the faviconUrl key when the argument is not supplied at all', async () => {
    await createBookmark('https://example.com', 'Example')

    expect(Object.keys(mockAdd.mock.calls[0][0])).not.toContain('faviconUrl')
  })
})

describe('listBookmarks faviconUrl handling', () => {
  it('returns faviconUrl when the document has one', async () => {
    mockGet.mockResolvedValue({
      docs: [
        {
          id: 'a',
          data: () => ({
            url: 'https://example.com',
            title: 'A',
            faviconUrl: 'https://example.com/f.ico',
            createdAt: { toDate: () => fixedDate },
          }),
        },
      ],
    })

    const result = await listBookmarks()

    expect(result[0].faviconUrl).toBe('https://example.com/f.ico')
  })

  it('still returns documents saved before faviconUrl existed', async () => {
    mockGet.mockResolvedValue({
      docs: [
        {
          id: 'legacy',
          data: () => ({
            url: 'https://example.com',
            title: 'Legacy',
            createdAt: { toDate: () => fixedDate },
          }),
        },
      ],
    })

    const result = await listBookmarks()

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('legacy')
    expect(result[0].faviconUrl).toBeUndefined()
  })

  it('ignores a non-string faviconUrl rather than dropping the document', async () => {
    mockGet.mockResolvedValue({
      docs: [
        {
          id: 'weird',
          data: () => ({
            url: 'https://example.com',
            title: 'Weird',
            faviconUrl: 42,
            createdAt: { toDate: () => fixedDate },
          }),
        },
      ],
    })

    const result = await listBookmarks()

    expect(result).toHaveLength(1)
    expect(result[0].faviconUrl).toBeUndefined()
  })
})

describe('getBookmark', () => {
  it('returns the bookmark when the document exists', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'abc',
      data: () => ({
        url: 'https://example.com',
        title: 'Example',
        summary: 'A summary.',
        createdAt: { toDate: () => fixedDate },
      }),
    })

    const bookmark = await getBookmark('abc')

    expect(mockDoc).toHaveBeenCalledWith('abc')
    expect(bookmark).toEqual({
      id: 'abc',
      url: 'https://example.com',
      title: 'Example',
      summary: 'A summary.',
      isRead: false,
      createdAt: '2024-01-01T00:00:00.000Z',
    })
  })

  it('returns null when the document does not exist', async () => {
    mockDocGet.mockResolvedValue({ exists: false, id: 'missing', data: () => undefined })

    await expect(getBookmark('missing')).resolves.toBeNull()
  })

  it('returns null when the document is missing required fields', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'broken',
      data: () => ({ title: 'No URL', createdAt: { toDate: () => fixedDate } }),
    })

    await expect(getBookmark('broken')).resolves.toBeNull()
  })

  it('omits summary for a document saved before the field existed', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'legacy',
      data: () => ({
        url: 'https://example.com',
        title: 'Legacy',
        createdAt: { toDate: () => fixedDate },
      }),
    })

    const bookmark = await getBookmark('legacy')

    expect(bookmark).not.toHaveProperty('summary')
  })
})

describe('updateSummary', () => {
  it('writes the summary and clears any labels from the previous page version', async () => {
    mockUpdate.mockResolvedValue(undefined)

    await updateSummary('abc', 'A summary.')

    expect(mockDoc).toHaveBeenCalledWith('abc')
    expect(mockUpdate).toHaveBeenCalledWith({ summary: 'A summary.', labels: 'DELETE_SENTINEL' })
  })
})

describe('deleteBookmark', () => {
  it('deletes the document with the given id', async () => {
    mockDelete.mockResolvedValue(undefined)

    await deleteBookmark('abc')

    expect(mockCollection).toHaveBeenCalledWith('bookmarks')
    expect(mockDoc).toHaveBeenCalledWith('abc')
    expect(mockDelete).toHaveBeenCalled()
  })

  it('propagates a Firestore failure to the caller', async () => {
    mockDelete.mockRejectedValue(new Error('firestore down'))

    await expect(deleteBookmark('abc')).rejects.toThrow('firestore down')
  })
})

describe('listBookmarks summary handling', () => {
  it('returns the summary when a document has one', async () => {
    mockGet.mockResolvedValue({
      docs: [
        {
          id: 'a',
          data: () => ({
            url: 'https://example.com',
            title: 'A',
            summary: 'A summary.',
            createdAt: { toDate: () => fixedDate },
          }),
        },
      ],
    })

    const result = await listBookmarks()

    expect(result[0].summary).toBe('A summary.')
  })

  it('still returns documents saved before summary existed', async () => {
    mockGet.mockResolvedValue({
      docs: [
        {
          id: 'legacy',
          data: () => ({
            url: 'https://example.com',
            title: 'Legacy',
            createdAt: { toDate: () => fixedDate },
          }),
        },
      ],
    })

    const result = await listBookmarks()

    expect(result).toHaveLength(1)
    expect(result[0].summary).toBeUndefined()
  })

  it('ignores a non-string summary rather than dropping the document', async () => {
    mockGet.mockResolvedValue({
      docs: [
        {
          id: 'weird',
          data: () => ({
            url: 'https://example.com',
            title: 'Weird',
            summary: 42,
            createdAt: { toDate: () => fixedDate },
          }),
        },
      ],
    })

    const result = await listBookmarks()

    expect(result).toHaveLength(1)
    expect(result[0].summary).toBeUndefined()
  })
})

describe('updateLabels', () => {
  it('writes the labels array onto the document', async () => {
    mockUpdate.mockResolvedValue(undefined)

    await updateLabels('abc', ['typescript', 'testing'])

    expect(mockDoc).toHaveBeenCalledWith('abc')
    expect(mockUpdate).toHaveBeenCalledWith({ labels: ['typescript', 'testing'] })
  })
})

describe('listAllLabels', () => {
  it('returns the sorted, deduplicated union across documents', async () => {
    mockGet.mockResolvedValue({
      docs: [
        { id: 'a', data: () => ({ labels: ['typescript', 'testing'] }) },
        { id: 'b', data: () => ({ labels: ['react', 'typescript'] }) },
      ],
    })

    await expect(listAllLabels()).resolves.toEqual(['react', 'testing', 'typescript'])
    expect(mockSelect).toHaveBeenCalledWith('labels')
  })

  it('tolerates documents without labels or with a malformed labels field', async () => {
    mockGet.mockResolvedValue({
      docs: [
        { id: 'legacy', data: () => ({}) },
        { id: 'weird', data: () => ({ labels: 'not-an-array' }) },
        { id: 'mixed', data: () => ({ labels: ['ok', 42] }) },
      ],
    })

    await expect(listAllLabels()).resolves.toEqual(['ok'])
  })

  it('caps the vocabulary at the 100 most frequent labels', async () => {
    const many = Array.from({ length: 110 }, (_, i) => `a${String(i + 1).padStart(3, '0')}`)
    mockGet.mockResolvedValue({
      docs: [
        { id: 'a', data: () => ({ labels: many }) },
        { id: 'b', data: () => ({ labels: ['zpop'] }) },
        { id: 'c', data: () => ({ labels: ['zpop'] }) },
      ],
    })

    const result = await listAllLabels()

    expect(result).toHaveLength(100)
    expect(result).toContain('zpop') // count 2 → always kept
    expect(result).toContain('a001') // alphabetical tie-break keeps the earliest
    expect(result).not.toContain('a110') // lowest-priority tie dropped
  })
})

describe('bookmark labels handling', () => {
  it('returns labels when a document has them', async () => {
    mockGet.mockResolvedValue({
      docs: [
        {
          id: 'a',
          data: () => ({
            url: 'https://example.com',
            title: 'A',
            labels: ['typescript'],
            createdAt: { toDate: () => fixedDate },
          }),
        },
      ],
    })

    const result = await listBookmarks()

    expect(result[0].labels).toEqual(['typescript'])
  })

  it('still returns documents saved before labels existed', async () => {
    mockGet.mockResolvedValue({
      docs: [
        {
          id: 'legacy',
          data: () => ({
            url: 'https://example.com',
            title: 'Legacy',
            createdAt: { toDate: () => fixedDate },
          }),
        },
      ],
    })

    const result = await listBookmarks()

    expect(result).toHaveLength(1)
    expect(result[0]).not.toHaveProperty('labels')
  })

  it('ignores a labels field that is not an array of strings rather than dropping the document', async () => {
    mockGet.mockResolvedValue({
      docs: [
        {
          id: 'weird',
          data: () => ({
            url: 'https://example.com',
            title: 'Weird',
            labels: ['ok', 42],
            createdAt: { toDate: () => fixedDate },
          }),
        },
      ],
    })

    const result = await listBookmarks()

    expect(result).toHaveLength(1)
    expect(result[0]).not.toHaveProperty('labels')
  })
})

describe('read flag', () => {
  it('stores isRead: false on a new bookmark rather than leaving the field absent', async () => {
    // Absence would read as unread too, but only a stored field can ever be queried on.
    const result = await createBookmark('https://example.com', 'Example')

    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ isRead: false }))
    expect(result.isRead).toBe(false)
  })

  it('reads a stored isRead: true back', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'abc',
      data: () => ({
        url: 'https://example.com',
        title: 'Example',
        isRead: true,
        createdAt: { toDate: () => fixedDate },
      }),
    })

    await expect(getBookmark('abc')).resolves.toMatchObject({ isRead: true })
  })

  it('reports a document saved before the field existed as unread', async () => {
    mockGet.mockResolvedValue({
      docs: [
        {
          id: 'legacy',
          data: () => ({
            url: 'https://example.com',
            title: 'Legacy',
            createdAt: { toDate: () => fixedDate },
          }),
        },
      ],
    })

    const result = await listBookmarks()

    expect(result).toHaveLength(1)
    expect(result[0].isRead).toBe(false)
  })

  it('reports a non-boolean isRead as unread rather than as whatever it is truthy for', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'weird',
      data: () => ({
        url: 'https://example.com',
        title: 'Weird',
        isRead: 'yes',
        createdAt: { toDate: () => fixedDate },
      }),
    })

    await expect(getBookmark('weird')).resolves.toMatchObject({ isRead: false })
  })
})

describe('setReadState', () => {
  it('writes the flag and reports success', async () => {
    mockUpdate.mockResolvedValue(undefined)

    await expect(setReadState('abc', true)).resolves.toBe(true)

    expect(mockDoc).toHaveBeenCalledWith('abc')
    expect(mockUpdate).toHaveBeenCalledWith({ isRead: true })
  })

  it('writes false as readily as true, so unmarking is the same one write', async () => {
    mockUpdate.mockResolvedValue(undefined)

    await expect(setReadState('abc', false)).resolves.toBe(true)

    expect(mockUpdate).toHaveBeenCalledWith({ isRead: false })
  })

  it('reports a missing bookmark instead of throwing, from the write itself', async () => {
    // Firestore's NOT_FOUND. update() rejects rather than creating the document, which is what
    // keeps a bookmark deleted moments ago from coming back as a document holding only a flag.
    mockUpdate.mockRejectedValue(Object.assign(new Error('no document to update'), { code: 5 }))

    await expect(setReadState('gone', true)).resolves.toBe(false)
  })

  it('propagates any other Firestore failure rather than reporting it as missing', async () => {
    mockUpdate.mockRejectedValue(Object.assign(new Error('permission denied'), { code: 7 }))

    await expect(setReadState('abc', true)).rejects.toThrow('permission denied')
  })
})
