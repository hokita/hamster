import { render, screen, fireEvent } from '@testing-library/react'
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
    const link = screen.getByRole('link', { name: /Example Site/ })
    expect(link).toHaveAttribute('href', 'https://example.com')
  })

  it("shows the bookmark's domain and relative time", () => {
    const recent = [{ ...bookmarks[0], createdAt: new Date().toISOString() }]
    render(<BookmarkList bookmarks={recent} />)
    const link = screen.getByRole('link', { name: /Example Site/ })
    expect(link).toHaveTextContent('example.com')
    expect(link).toHaveTextContent('just now')
  })

  it('renders without throwing when a bookmark has a URL that new URL() rejects', () => {
    const malformed = [{ ...bookmarks[0], url: 'https://exa mple.com' }]
    expect(() => render(<BookmarkList bookmarks={malformed} />)).not.toThrow()
    expect(screen.getByRole('link', { name: /Example Site/ })).toBeInTheDocument()
  })

  it('gives two same-titled bookmarks from different domains distinguishable accessible names', () => {
    const sameTitleDifferentDomains = [
      {
        id: '1',
        url: 'https://example.com',
        title: 'Same Title',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
      {
        id: '2',
        url: 'https://other.com',
        title: 'Same Title',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ]
    render(<BookmarkList bookmarks={sameTitleDifferentDomains} />)
    const links = screen.getAllByRole('link', { name: /Same Title/ })
    expect(links).toHaveLength(2)
    expect(links[0]).toHaveAccessibleName(expect.stringContaining('example.com'))
    expect(links[1]).toHaveAccessibleName(expect.stringContaining('other.com'))
  })

  it('renders the empty state instead of throwing when bookmarks is not an array', () => {
    expect(() =>
      render(<BookmarkList bookmarks={null as unknown as typeof bookmarks} />)
    ).not.toThrow()
    expect(screen.getByText('No bookmarks yet — paste a URL above to add one.')).toBeInTheDocument()
  })
})

describe('BookmarkList favicons', () => {
  it('uses the stored faviconUrl as the icon source', () => {
    const withIcon = [{ ...bookmarks[0], faviconUrl: 'https://cdn.example.net/f.ico' }]
    const { container } = render(<BookmarkList bookmarks={withIcon} />)

    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      'https://cdn.example.net/f.ico'
    )
  })

  it('derives the origin favicon when the bookmark has no stored faviconUrl', () => {
    const legacy = [{ ...bookmarks[0], url: 'https://example.com/deep/page?q=1' }]
    const { container } = render(<BookmarkList bookmarks={legacy} />)

    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      'https://example.com/favicon.ico'
    )
  })

  it('keeps the favicon out of the accessible name and out of the referrer', () => {
    const withIcon = [{ ...bookmarks[0], faviconUrl: 'https://cdn.example.net/logo-name.ico' }]
    const { container } = render(<BookmarkList bookmarks={withIcon} />)
    const img = container.querySelector('img')

    expect(img).toHaveAttribute('alt', '')
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer')
    expect(img).toHaveAttribute('loading', 'lazy')
    expect(screen.getByRole('link', { name: /Example Site/ })).not.toHaveAccessibleName(
      expect.stringContaining('logo-name')
    )
  })

  it('falls back to the generic icon when the favicon fails to load', () => {
    const { container } = render(<BookmarkList bookmarks={bookmarks} />)
    const img = container.querySelector('img')
    expect(img).not.toBeNull()

    fireEvent.error(img!)

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('renders the generic icon without throwing when the URL is unparseable', () => {
    const malformed = [{ ...bookmarks[0], url: 'https://exa mple.com' }]
    const { container } = render(<BookmarkList bookmarks={malformed} />)

    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByRole('link', { name: /Example Site/ })).toBeInTheDocument()
  })
})
