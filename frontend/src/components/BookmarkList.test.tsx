import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import BookmarkList from './BookmarkList'

const bookmarks = [
  {
    id: '1',
    url: 'https://example.com',
    title: 'Example Site',
    createdAt: '2024-01-01T00:00:00.000Z',
  },
]

describe('BookmarkList', () => {
  it('shows an empty state when there are no bookmarks', () => {
    render(<BookmarkList bookmarks={[]} />)
    expect(screen.getByText('No bookmarks yet — paste a URL above to add one.')).toBeInTheDocument()
  })

  it('renders each bookmark as a link to its URL', () => {
    render(<BookmarkList bookmarks={bookmarks} />)
    const link = screen.getByRole('link', { name: 'Example Site' })
    expect(link).toHaveAttribute('href', 'https://example.com')
  })

  it("shows the bookmark's domain and relative time", () => {
    const recent = [{ ...bookmarks[0], createdAt: new Date().toISOString() }]
    render(<BookmarkList bookmarks={recent} />)
    const link = screen.getByRole('link', { name: 'Example Site' })
    expect(link).toHaveTextContent('example.com')
    expect(link).toHaveTextContent('just now')
  })

  it('renders without throwing when a bookmark has a URL that new URL() rejects', () => {
    const malformed = [{ ...bookmarks[0], url: 'https://exa mple.com' }]
    expect(() => render(<BookmarkList bookmarks={malformed} />)).not.toThrow()
    expect(screen.getByRole('link', { name: 'Example Site' })).toBeInTheDocument()
  })
})
