import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import type { VisualSummary } from '../visualSummary'

const mockGet = vi.fn()
const mockAdd = vi.fn()
const mockOrderBy = vi.fn(() => ({ get: mockGet }))
const mockDocGet = vi.fn()
const mockUpdate = vi.fn()
const mockDelete = vi.fn()
const mockTransactionGet = vi.fn()
const mockTransactionUpdate = vi.fn()
const mockRunTransaction = vi.fn(async (callback) =>
  callback({ get: mockTransactionGet, update: mockTransactionUpdate })
)
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
  getFirestore: () => ({ collection: mockCollection, runTransaction: mockRunTransaction }),
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
  saveVisualSummary,
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
    expect(mockUpdate).toHaveBeenCalledWith({
      summary: 'A summary.',
      summaryVersion: expect.any(String),
      labels: 'DELETE_SENTINEL',
      visualSummary: 'DELETE_SENTINEL',
    })
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

describe('visual summary persistence', () => {
  const source = 'Saved summary.'
  const value: VisualSummary = {
    blocks: [
      {
        type: 'comparison',
        title: 'Options',
        columns: ['Option', 'Price'],
        rows: [
          ['A', '$10'],
          ['B', '$20'],
        ],
      },
    ],
  }
  const saved = {
    sourceHash: createHash('sha256').update(source).digest('hex'),
    summaryVersion: 'v1',
    json: JSON.stringify(value),
  }
  const data = {
    url: 'https://example.com',
    title: 'Article',
    summary: source,
    summaryVersion: 'v1',
    visualSummary: saved,
    createdAt: { toDate: () => fixedDate },
  }

  it('restores validated saved JSON through the detail read but omits it from the list', async () => {
    mockDocGet.mockResolvedValue({ exists: true, id: '1', data: () => data })
    expect((await getBookmark('1'))?.visualSummary).toEqual(value)
    mockGet.mockResolvedValue({ docs: [{ id: '1', data: () => data }] })
    expect((await listBookmarks())[0].visualSummary).toBeUndefined()
  })
  it.each([
    { ...saved, sourceHash: 'wrong' },
    { ...saved, summaryVersion: 'v0' },
    { ...saved, json: '{invalid' },
    { ...saved, json: '{"blocks":[]}' },
    { ...saved, json: 'x'.repeat(60_001) },
  ])(
    'ignores stale, corrupt or oversized persisted UI without hiding the summary: %#',
    async (visualSummary) => {
      mockDocGet.mockResolvedValue({
        exists: true,
        id: '1',
        data: () => ({ ...data, visualSummary }),
      })
      const result = await getBookmark('1')
      expect(result?.summary).toBe(source)
      expect(result?.visualSummary).toBeUndefined()
    }
  )
  it('atomically saves JSON as a string, including comparison rows with nested arrays', async () => {
    mockTransactionGet.mockResolvedValue({ exists: true, data: () => data })
    expect(await saveVisualSummary('1', source, 'v1', value)).toBe(true)
    expect(mockTransactionUpdate).toHaveBeenCalledWith(expect.anything(), { visualSummary: saved })
  })
  it.each([
    { exists: false, data: () => undefined },
    { exists: true, data: () => ({ ...data, summary: 'Updated summary.' }) },
    { exists: true, data: () => ({ ...data, summaryVersion: 'v2' }) },
  ])('never writes obsolete UI or resurrects a deleted article: %#', async (snapshot) => {
    mockTransactionGet.mockResolvedValue(snapshot)
    expect(await saveVisualSummary('1', source, 'v1', value)).toBe(false)
    expect(mockTransactionUpdate).not.toHaveBeenCalled()
  })
  it('supports legacy summaries with no version field', async () => {
    mockTransactionGet.mockResolvedValue({ exists: true, data: () => ({ summary: source }) })
    expect(await saveVisualSummary('1', source, undefined, value)).toBe(true)
    const stored = mockTransactionUpdate.mock.calls[0][1].visualSummary
    expect(stored.summaryVersion).toBeNull()
    mockDocGet.mockResolvedValue({
      exists: true,
      id: '1',
      data: () => ({ ...data, summaryVersion: undefined, visualSummary: stored }),
    })
    expect((await getBookmark('1'))?.visualSummary).toEqual(value)
  })
  it('rejects invalid persisted input and propagates storage failure', async () => {
    await expect(saveVisualSummary('1', source, 'v1', { blocks: [] })).rejects.toThrow()
    expect(mockTransactionUpdate).not.toHaveBeenCalled()
    mockRunTransaction.mockRejectedValueOnce(new Error('storage unavailable'))
    await expect(saveVisualSummary('1', source, 'v1', value)).rejects.toThrow('storage unavailable')
  })
  it('invalidates saved UI and changes the version even when summary text is regenerated identically', async () => {
    mockUpdate.mockResolvedValue(undefined)
    await updateSummary('1', source)
    await updateSummary('1', source)
    const first = mockUpdate.mock.calls[0][0]
    const second = mockUpdate.mock.calls[1][0]
    expect(first.visualSummary).toBe('DELETE_SENTINEL')
    expect(first.summaryVersion).not.toBe(second.summaryVersion)
  })
})
