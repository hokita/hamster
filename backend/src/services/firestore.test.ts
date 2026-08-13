import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGet = vi.fn()
const mockAdd = vi.fn()
const mockOrderBy = vi.fn(() => ({ get: mockGet }))
const mockDocGet = vi.fn()
const mockUpdate = vi.fn()
const mockDoc = vi.fn(() => ({ get: mockDocGet, update: mockUpdate }))
const mockCollection = vi.fn(() => ({ orderBy: mockOrderBy, add: mockAdd, doc: mockDoc }))
const fixedDate = new Date('2024-01-01T00:00:00.000Z')

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ collection: mockCollection }),
  Timestamp: { now: () => ({ toDate: () => fixedDate }) },
}))

import { listBookmarks, createBookmark, getBookmark, updateSummary } from './firestore'

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
  it('writes the summary onto the document', async () => {
    mockUpdate.mockResolvedValue(undefined)

    await updateSummary('abc', 'A summary.')

    expect(mockDoc).toHaveBeenCalledWith('abc')
    expect(mockUpdate).toHaveBeenCalledWith({ summary: 'A summary.' })
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
