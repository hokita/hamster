import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../api', () => ({
  api: {
    listBookmarks: vi.fn(),
    createBookmark: vi.fn(),
  },
}))
vi.mock('../firebase', () => ({ auth: {} }))
vi.mock('firebase/auth', () => ({ signOut: vi.fn() }))

import { signOut } from 'firebase/auth'
import { api } from '../api'
import BookmarksPage from './BookmarksPage'

describe('BookmarksPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.listBookmarks).mockResolvedValue([])
  })

  it('loads and shows bookmarks on mount', async () => {
    vi.mocked(api.listBookmarks).mockResolvedValue([
      {
        id: '1',
        url: 'https://example.com',
        title: 'Example Site',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ])
    render(<BookmarksPage />)
    expect(await screen.findByRole('link', { name: /Example Site/ })).toBeInTheDocument()
  })

  it('adds a bookmark and refreshes the list', async () => {
    vi.mocked(api.createBookmark).mockResolvedValue({
      id: '2',
      url: 'https://example.com',
      title: 'New Site',
      createdAt: '2024-01-01T00:00:00.000Z',
    })
    render(<BookmarksPage />)
    await waitFor(() => expect(api.listBookmarks).toHaveBeenCalledTimes(1))

    vi.mocked(api.listBookmarks).mockResolvedValue([
      {
        id: '2',
        url: 'https://example.com',
        title: 'New Site',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ])
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))

    expect(await screen.findByRole('link', { name: /New Site/ })).toBeInTheDocument()
    expect(api.listBookmarks).toHaveBeenCalledTimes(2)
  })

  it('shows an error message when loading bookmarks fails', async () => {
    vi.mocked(api.listBookmarks).mockRejectedValue(new Error('network error'))
    render(<BookmarksPage />)
    expect(await screen.findByText('Failed to load bookmarks.')).toBeInTheDocument()
  })

  it('does not show the empty-state message when the initial load fails', async () => {
    vi.mocked(api.listBookmarks).mockRejectedValue(new Error('network error'))
    render(<BookmarksPage />)
    expect(await screen.findByText('Failed to load bookmarks.')).toBeInTheDocument()
    expect(
      screen.queryByText('No bookmarks yet — paste a URL above to add one.')
    ).not.toBeInTheDocument()
  })

  it('still shows the empty-state message alongside the error when adding fails on an already-verified-empty list', async () => {
    vi.mocked(api.listBookmarks).mockResolvedValue([])
    render(<BookmarksPage />)
    expect(
      await screen.findByText('No bookmarks yet — paste a URL above to add one.')
    ).toBeInTheDocument()

    vi.mocked(api.createBookmark).mockRejectedValue(new Error('network error'))
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))

    expect(await screen.findByText('Failed to add bookmark.')).toBeInTheDocument()
    expect(screen.getByText('No bookmarks yet — paste a URL above to add one.')).toBeInTheDocument()
  })

  it('ignores a stale mount-fetch response that resolves after a newer add', async () => {
    let resolveMountFetch!: (value: Awaited<ReturnType<typeof api.listBookmarks>>) => void
    const mountFetchPromise = new Promise<Awaited<ReturnType<typeof api.listBookmarks>>>(
      (resolve) => {
        resolveMountFetch = resolve
      }
    )
    vi.mocked(api.listBookmarks).mockReturnValueOnce(mountFetchPromise)
    vi.mocked(api.createBookmark).mockResolvedValue({
      id: '2',
      url: 'https://example.com',
      title: 'New Site',
      createdAt: '2024-01-01T00:00:00.000Z',
    })

    render(<BookmarksPage />)
    await waitFor(() => expect(api.listBookmarks).toHaveBeenCalledTimes(1))

    vi.mocked(api.listBookmarks).mockResolvedValueOnce([
      {
        id: '2',
        url: 'https://example.com',
        title: 'New Site',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ])
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))

    expect(await screen.findByRole('link', { name: /New Site/ })).toBeInTheDocument()

    // The stale mount-time fetch finally resolves with the pre-add (empty) list — it must
    // not clobber the newer state that the add-triggered refresh already applied.
    resolveMountFetch([])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.getByRole('link', { name: /New Site/ })).toBeInTheDocument()
  })

  it('keeps the add-failure error visible even if a slower, earlier load succeeds afterward', async () => {
    let resolveMountFetch!: (value: Awaited<ReturnType<typeof api.listBookmarks>>) => void
    const mountFetchPromise = new Promise<Awaited<ReturnType<typeof api.listBookmarks>>>(
      (resolve) => {
        resolveMountFetch = resolve
      }
    )
    vi.mocked(api.listBookmarks).mockReturnValueOnce(mountFetchPromise)
    vi.mocked(api.createBookmark).mockRejectedValue(new Error('network error'))

    render(<BookmarksPage />)
    await waitFor(() => expect(api.listBookmarks).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))

    expect(await screen.findByText('Failed to add bookmark.')).toBeInTheDocument()

    // The slower, earlier mount fetch finally resolves successfully — it must not
    // silently clear the add-failure error the user is currently looking at.
    resolveMountFetch([])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.getByText('Failed to add bookmark.')).toBeInTheDocument()
  })

  it('signs out when the sign out button is clicked', async () => {
    render(<BookmarksPage />)
    await waitFor(() => expect(api.listBookmarks).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(signOut).toHaveBeenCalled()
  })

  it('shows an error message when adding a bookmark fails', async () => {
    vi.mocked(api.createBookmark).mockRejectedValue(new Error('network error'))
    render(<BookmarksPage />)
    await waitFor(() => expect(api.listBookmarks).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))

    expect(await screen.findByText('Failed to add bookmark.')).toBeInTheDocument()
  })

  it('shows a loading indicator until the initial fetch resolves, then hides it', async () => {
    let resolveMountFetch!: (value: Awaited<ReturnType<typeof api.listBookmarks>>) => void
    const mountFetchPromise = new Promise<Awaited<ReturnType<typeof api.listBookmarks>>>(
      (resolve) => {
        resolveMountFetch = resolve
      }
    )
    vi.mocked(api.listBookmarks).mockReturnValueOnce(mountFetchPromise)

    render(<BookmarksPage />)
    expect(screen.getByRole('status', { name: 'Loading bookmarks' })).toBeInTheDocument()

    resolveMountFetch([])
    await waitFor(() =>
      expect(screen.queryByRole('status', { name: 'Loading bookmarks' })).not.toBeInTheDocument()
    )
  })

  it('hides the loading indicator even when the initial fetch fails', async () => {
    vi.mocked(api.listBookmarks).mockRejectedValueOnce(new Error('network error'))
    render(<BookmarksPage />)
    await screen.findByText('Failed to load bookmarks.')
    expect(screen.queryByRole('status', { name: 'Loading bookmarks' })).not.toBeInTheDocument()
  })

  it('keeps the loading spinner visible when a stale mount-fetch resolves before a newer refresh completes', async () => {
    let resolveMountFetch!: (value: Awaited<ReturnType<typeof api.listBookmarks>>) => void
    const mountFetchPromise = new Promise<Awaited<ReturnType<typeof api.listBookmarks>>>(
      (resolve) => {
        resolveMountFetch = resolve
      }
    )
    vi.mocked(api.listBookmarks).mockReturnValueOnce(mountFetchPromise)

    let resolveRefreshFetch!: (value: Awaited<ReturnType<typeof api.listBookmarks>>) => void
    const refreshFetchPromise = new Promise<Awaited<ReturnType<typeof api.listBookmarks>>>(
      (resolve) => {
        resolveRefreshFetch = resolve
      }
    )
    vi.mocked(api.listBookmarks).mockReturnValueOnce(refreshFetchPromise)

    vi.mocked(api.createBookmark).mockResolvedValue({
      id: '2',
      url: 'https://example.com',
      title: 'New Site',
      createdAt: '2024-01-01T00:00:00.000Z',
    })

    render(<BookmarksPage />)
    expect(screen.getByRole('status', { name: 'Loading bookmarks' })).toBeInTheDocument()
    await waitFor(() => expect(api.listBookmarks).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))
    await waitFor(() => expect(api.listBookmarks).toHaveBeenCalledTimes(2))

    // The stale mount-time fetch resolves first, before the newer add-triggered refresh
    // completes. It must not prematurely clear the loading spinner.
    resolveMountFetch([])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.getByRole('status', { name: 'Loading bookmarks' })).toBeInTheDocument()

    resolveRefreshFetch([
      {
        id: '2',
        url: 'https://example.com',
        title: 'New Site',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ])
    await waitFor(() =>
      expect(screen.queryByRole('status', { name: 'Loading bookmarks' })).not.toBeInTheDocument()
    )
    expect(screen.getByRole('link', { name: /New Site/ })).toBeInTheDocument()
  })

  it('clears the loading spinner even when an add fails before the initial fetch settles', async () => {
    let resolveMountFetch!: (value: Awaited<ReturnType<typeof api.listBookmarks>>) => void
    const mountFetchPromise = new Promise<Awaited<ReturnType<typeof api.listBookmarks>>>(
      (resolve) => {
        resolveMountFetch = resolve
      }
    )
    vi.mocked(api.listBookmarks).mockReturnValueOnce(mountFetchPromise)
    vi.mocked(api.createBookmark).mockRejectedValue(new Error('network error'))

    render(<BookmarksPage />)
    expect(screen.getByRole('status', { name: 'Loading bookmarks' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))
    await screen.findByText('Failed to add bookmark.')

    // The initial fetch hasn't settled yet — the spinner should still be showing.
    expect(screen.getByRole('status', { name: 'Loading bookmarks' })).toBeInTheDocument()

    resolveMountFetch([])
    await waitFor(() =>
      expect(screen.queryByRole('status', { name: 'Loading bookmarks' })).not.toBeInTheDocument()
    )
  })

  it('still applies the initial list even when an earlier add failed before it settled', async () => {
    let resolveMountFetch!: (value: Awaited<ReturnType<typeof api.listBookmarks>>) => void
    const mountFetchPromise = new Promise<Awaited<ReturnType<typeof api.listBookmarks>>>(
      (resolve) => {
        resolveMountFetch = resolve
      }
    )
    vi.mocked(api.listBookmarks).mockReturnValueOnce(mountFetchPromise)
    vi.mocked(api.createBookmark).mockRejectedValue(new Error('network error'))

    render(<BookmarksPage />)
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))
    await screen.findByText('Failed to add bookmark.')

    resolveMountFetch([
      {
        id: '1',
        url: 'https://example.com',
        title: 'Example Site',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ])

    expect(await screen.findByRole('link', { name: /Example Site/ })).toBeInTheDocument()
    expect(screen.getByText('Failed to add bookmark.')).toBeInTheDocument()
  })
})
