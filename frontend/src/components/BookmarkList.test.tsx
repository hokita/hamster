import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import BookmarkList from './BookmarkList'

const bookmarks = [
  {
    id: '1',
    url: 'https://example.com',
    title: 'Example Site',
    createdAt: '2024-01-01T00:00:00.000Z',
  },
]

function renderList(props: React.ComponentProps<typeof BookmarkList>) {
  return render(
    <MemoryRouter>
      <BookmarkList {...props} />
    </MemoryRouter>
  )
}

describe('BookmarkList', () => {
  it('shows an empty state when there are no bookmarks', () => {
    renderList({ bookmarks: [] })
    expect(screen.getByText('No bookmarks yet — paste a URL above to add one.')).toBeInTheDocument()
  })

  it('links the bookmark title to its summary page', () => {
    renderList({ bookmarks })
    expect(screen.getByRole('link', { name: /Example Site/ })).toHaveAttribute(
      'href',
      '/bookmarks/1'
    )
  })

  it('links the external icon to the original site', () => {
    renderList({ bookmarks })
    const external = screen.getByRole('link', { name: 'Open example.com in a new tab' })
    expect(external).toHaveAttribute('href', 'https://example.com')
    expect(external).toHaveAttribute('target', '_blank')
    expect(external).toHaveAttribute('rel', 'noreferrer')
  })

  it("shows the bookmark's domain and relative time", () => {
    const recent = [{ ...bookmarks[0], createdAt: new Date().toISOString() }]
    renderList({ bookmarks: recent })
    const link = screen.getByRole('link', { name: /Example Site/ })
    expect(link).toHaveTextContent('example.com')
    expect(link).toHaveTextContent('just now')
  })

  it('shows a summarizing indicator for ids that are still generating', () => {
    renderList({ bookmarks, summarizingIds: new Set(['1']) })
    expect(screen.getByText('Summarizing…')).toBeInTheDocument()
  })

  it('shows the relative time when nothing is generating', () => {
    const recent = [{ ...bookmarks[0], createdAt: new Date().toISOString() }]
    renderList({ bookmarks: recent, summarizingIds: new Set() })
    expect(screen.queryByText('Summarizing…')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Example Site/ })).toHaveTextContent('just now')
  })

  it('offers no delete control when no onDelete handler is given', () => {
    renderList({ bookmarks })
    expect(screen.queryByRole('button', { name: /^Delete/ })).not.toBeInTheDocument()
  })

  it('deletes the row it belongs to, after confirmation', () => {
    const onDelete = vi.fn()
    renderList({ bookmarks, onDelete })

    fireEvent.click(screen.getByRole('button', { name: 'Delete Example Site on example.com' }))
    expect(onDelete).not.toHaveBeenCalled()

    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm deleting Example Site on example.com' })
    )
    expect(onDelete).toHaveBeenCalledWith('1')
  })

  it('names each delete control by hostname as well as title, so same-titled rows stay distinct', () => {
    // Two bookmarks can carry the same title, and a name built from the title alone would leave a
    // screen-reader user unable to tell which row's irreversible action they are on. The hostname
    // is the discriminator here, exactly as it is for the row's "Open … in a new tab" link.
    const sameTitle = [
      { ...bookmarks[0], id: '1', url: 'https://example.com' },
      { ...bookmarks[0], id: '2', url: 'https://other.example' },
    ]
    const onDelete = vi.fn()
    renderList({ bookmarks: sameTitle, onDelete })

    // Naming the second row's button on its own is the whole point — no indexing into a list of
    // identically named controls.
    fireEvent.click(screen.getByRole('button', { name: 'Delete Example Site on other.example' }))

    // Only the row that was asked about is confirming; the other is untouched.
    expect(
      screen.getByRole('button', { name: 'Confirm deleting Example Site on other.example' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Delete Example Site on example.com' })
    ).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm deleting Example Site on other.example' })
    )
    expect(onDelete).toHaveBeenCalledWith('2')
  })

  it('falls back to the raw URL in delete names when the URL has no parseable hostname', () => {
    const malformed = [{ ...bookmarks[0], url: 'https://exa mple.com' }]
    renderList({ bookmarks: malformed, onDelete: vi.fn() })

    expect(
      screen.getByRole('button', { name: 'Delete Example Site on https://exa mple.com' })
    ).toBeInTheDocument()
  })

  it('shows a busy indicator for a row whose delete is in flight', () => {
    renderList({ bookmarks, onDelete: vi.fn(), deletingIds: new Set(['1']) })

    expect(
      screen.getByRole('status', { name: 'Deleting Example Site on example.com' })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Delete Example Site on example.com' })
    ).not.toBeInTheDocument()
  })

  it('renders without throwing when a bookmark has a URL that new URL() rejects', () => {
    const malformed = [{ ...bookmarks[0], url: 'https://exa mple.com' }]
    expect(() => renderList({ bookmarks: malformed })).not.toThrow()
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
    renderList({ bookmarks: sameTitleDifferentDomains })
    const links = screen.getAllByRole('link', { name: /Same Title/ })
    expect(links).toHaveLength(2)
    expect(links[0]).toHaveAccessibleName(expect.stringContaining('example.com'))
    expect(links[1]).toHaveAccessibleName(expect.stringContaining('other.com'))
  })

  it('renders the empty state instead of throwing when bookmarks is not an array', () => {
    expect(() =>
      renderList({ bookmarks: null as unknown as typeof bookmarks })
    ).not.toThrow()
    expect(screen.getByText('No bookmarks yet — paste a URL above to add one.')).toBeInTheDocument()
  })
})

describe('BookmarkList favicons', () => {
  it('uses the stored faviconUrl as the icon source', () => {
    const withIcon = [{ ...bookmarks[0], faviconUrl: 'https://cdn.example.net/f.ico' }]
    const { container } = renderList({ bookmarks: withIcon })

    expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn.example.net/f.ico')
  })

  it('derives the origin favicon when the bookmark has no stored faviconUrl', () => {
    const legacy = [{ ...bookmarks[0], url: 'https://example.com/deep/page?q=1' }]
    const { container } = renderList({ bookmarks: legacy })

    expect(container.querySelector('img')).toHaveAttribute('src', 'https://example.com/favicon.ico')
  })

  it('keeps the favicon out of the accessible name and out of the referrer', () => {
    const withIcon = [{ ...bookmarks[0], faviconUrl: 'https://cdn.example.net/logo-name.ico' }]
    const { container } = renderList({ bookmarks: withIcon })
    const img = container.querySelector('img')

    expect(img).toHaveAttribute('alt', '')
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer')
    expect(img).toHaveAttribute('loading', 'lazy')
    expect(screen.getByRole('link', { name: /Example Site/ })).not.toHaveAccessibleName(
      expect.stringContaining('logo-name')
    )
  })

  it('falls back to the generic icon when the favicon fails to load', () => {
    const { container } = renderList({ bookmarks })
    const img = container.querySelector('img')
    expect(img).not.toBeNull()

    fireEvent.error(img!)

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('renders the generic icon without throwing when the URL is unparseable', () => {
    const malformed = [{ ...bookmarks[0], url: 'https://exa mple.com' }]
    const { container } = renderList({ bookmarks: malformed })

    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByRole('link', { name: /Example Site/ })).toBeInTheDocument()
  })

  it('does not derive an origin favicon for a private IPv4 host with no stored faviconUrl', () => {
    const privateHost = [{ ...bookmarks[0], url: 'https://192.168.1.1' }]
    const { container } = renderList({ bookmarks: privateHost })

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('does not derive an origin favicon for a loopback host with no stored faviconUrl', () => {
    const loopback = [{ ...bookmarks[0], url: 'http://127.0.0.1:8080/' }]
    const { container } = renderList({ bookmarks: loopback })

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('does not derive an origin favicon for a bracketed IPv6 loopback host with no stored faviconUrl', () => {
    const ipv6Loopback = [{ ...bookmarks[0], url: 'http://[::1]/' }]
    const { container } = renderList({ bookmarks: ipv6Loopback })

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('does not derive an origin favicon for an IPv4-mapped IPv6 loopback host (dotted form)', () => {
    const mapped = [{ ...bookmarks[0], url: 'http://[::ffff:127.0.0.1]/' }]
    const { container } = renderList({ bookmarks: mapped })

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('does not derive an origin favicon for an IPv4-mapped IPv6 private host (dotted form)', () => {
    const mapped = [{ ...bookmarks[0], url: 'http://[::ffff:192.168.1.1]/' }]
    const { container } = renderList({ bookmarks: mapped })

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('does not derive an origin favicon for an IPv4-mapped IPv6 loopback host (normalized hex form)', () => {
    const mapped = [{ ...bookmarks[0], url: 'http://[::ffff:7f00:1]/' }]
    const { container } = renderList({ bookmarks: mapped })

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('does not derive an origin favicon for an IPv4-mapped IPv6 private host (normalized hex form)', () => {
    const mapped = [{ ...bookmarks[0], url: 'http://[::ffff:c0a8:101]/' }]
    const { container } = renderList({ bookmarks: mapped })

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('still derives the origin favicon for an ordinary public IPv6 literal (guard against over-blocking)', () => {
    const publicV6 = [{ ...bookmarks[0], url: 'http://[2606:2800:220:1:248:1893:25c8:1946]/' }]
    const { container } = renderList({ bookmarks: publicV6 })

    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      'http://[2606:2800:220:1:248:1893:25c8:1946]/favicon.ico'
    )
  })
})
