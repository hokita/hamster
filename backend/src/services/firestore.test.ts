import { describe, it, expect, vi } from 'vitest'

const mockGet = vi.fn()
const mockOrderBy = vi.fn(() => ({ get: mockGet }))
const mockCollection = vi.fn(() => ({ orderBy: mockOrderBy }))

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ collection: mockCollection }),
  Timestamp: { now: vi.fn() },
}))

import { listBookmarks } from './firestore'

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
