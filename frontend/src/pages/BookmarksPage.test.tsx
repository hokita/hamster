import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../api', () => ({
  api: {
    listBookmarks: vi.fn(),
    createBookmark: vi.fn(),
    generateSummary: vi.fn(),
    deleteBookmark: vi.fn(),
    setReadState: vi.fn(),
  },
}))
vi.mock('../firebase', () => ({ auth: {} }))
vi.mock('firebase/auth', () => ({ signOut: vi.fn() }))

import { signOut } from 'firebase/auth'
import { api } from '../api'
import type { Bookmark } from '../api'
import BookmarksPage from './BookmarksPage'

function renderPage() {
  return render(
    <MemoryRouter>
      <BookmarksPage />
    </MemoryRouter>
  )
}

describe('BookmarksPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.listBookmarks).mockResolvedValue([])
    vi.mocked(api.generateSummary).mockResolvedValue({ summary: 'A summary.' })
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
    renderPage()
    expect(await screen.findByRole('link', { name: /Example Site/ })).toBeInTheDocument()
  })

  it('adds a bookmark and refreshes the list', async () => {
    vi.mocked(api.createBookmark).mockResolvedValue({
      id: '2',
      url: 'https://example.com',
      title: 'New Site',
      createdAt: '2024-01-01T00:00:00.000Z',
    })
    renderPage()
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
    await waitFor(() => expect(api.listBookmarks).toHaveBeenCalledTimes(3))
  })

  it('shows an error message when loading bookmarks fails', async () => {
    vi.mocked(api.listBookmarks).mockRejectedValue(new Error('network error'))
    renderPage()
    expect(await screen.findByText('Failed to load bookmarks.')).toBeInTheDocument()
  })

  it('does not show the empty-state message when the initial load fails', async () => {
    vi.mocked(api.listBookmarks).mockRejectedValue(new Error('network error'))
    renderPage()
    expect(await screen.findByText('Failed to load bookmarks.')).toBeInTheDocument()
    expect(
      screen.queryByText('No bookmarks yet — paste a URL above to add one.')
    ).not.toBeInTheDocument()
  })

  it('still shows the empty-state message alongside the error when adding fails on an already-verified-empty list', async () => {
    vi.mocked(api.listBookmarks).mockResolvedValue([])
    renderPage()
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

    renderPage()
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
    await waitFor(() => expect(api.generateSummary).toHaveBeenCalled())

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

    renderPage()
    await waitFor(() => expect(api.listBookmarks).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))

    expect(await screen.findByText('Failed to add bookmark.')).toBeInTheDocument()

    resolveMountFetch([])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.getByText('Failed to add bookmark.')).toBeInTheDocument()
  })

  it('signs out when the sign out button is clicked', async () => {
    renderPage()
    await waitFor(() => expect(api.listBookmarks).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(signOut).toHaveBeenCalled()
  })

  it('shows an error message when adding a bookmark fails', async () => {
    vi.mocked(api.createBookmark).mockRejectedValue(new Error('network error'))
    renderPage()
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

    renderPage()
    expect(screen.getByRole('status', { name: 'Loading bookmarks' })).toBeInTheDocument()

    resolveMountFetch([])
    await waitFor(() =>
      expect(screen.queryByRole('status', { name: 'Loading bookmarks' })).not.toBeInTheDocument()
    )
  })

  it('hides the loading indicator even when the initial fetch fails', async () => {
    vi.mocked(api.listBookmarks).mockRejectedValueOnce(new Error('network error'))
    renderPage()
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
    vi.mocked(api.listBookmarks).mockResolvedValueOnce([
      {
        id: '2',
        url: 'https://example.com',
        title: 'New Site',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ])

    vi.mocked(api.createBookmark).mockResolvedValue({
      id: '2',
      url: 'https://example.com',
      title: 'New Site',
      createdAt: '2024-01-01T00:00:00.000Z',
    })

    renderPage()
    expect(screen.getByRole('status', { name: 'Loading bookmarks' })).toBeInTheDocument()
    await waitFor(() => expect(api.listBookmarks).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))
    await waitFor(() => expect(api.listBookmarks).toHaveBeenCalledTimes(2))

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

    renderPage()
    expect(screen.getByRole('status', { name: 'Loading bookmarks' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))
    await screen.findByText('Failed to add bookmark.')

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

    renderPage()
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

  it('generates a summary for the bookmark it just created', async () => {
    vi.mocked(api.createBookmark).mockResolvedValue({
      id: '42',
      url: 'https://example.com',
      title: 'New Site',
      createdAt: '2024-01-01T00:00:00.000Z',
    })
    renderPage()
    await waitFor(() => expect(api.listBookmarks).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))

    await waitFor(() => expect(api.generateSummary).toHaveBeenCalledWith('42'))
  })

  it('refreshes the list once the summary lands, and the refreshed data is what renders', async () => {
    vi.mocked(api.createBookmark).mockResolvedValue({
      id: '42',
      url: 'https://example.com',
      title: 'New Site',
      createdAt: '2024-01-01T00:00:00.000Z',
    })
    renderPage()
    await waitFor(() => expect(api.listBookmarks).toHaveBeenCalledTimes(1))

    vi.mocked(api.listBookmarks).mockResolvedValueOnce([
      {
        id: '42',
        url: 'https://example.com',
        title: 'New Site',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ])
    vi.mocked(api.listBookmarks).mockResolvedValueOnce([
      {
        id: '42',
        url: 'https://example.com',
        title: 'New Site (summarized)',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ])

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))

    expect(
      await screen.findByRole('link', { name: /New Site \(summarized\)/ })
    ).toBeInTheDocument()
    await waitFor(() => expect(api.listBookmarks).toHaveBeenCalledTimes(3))
  })

  it('shows "Summarizing…" for the newly added bookmark while its summary is generating', async () => {
    let resolveGenerateSummary!: (value: { summary: string }) => void
    const generateSummaryPromise = new Promise<{ summary: string }>((resolve) => {
      resolveGenerateSummary = resolve
    })
    vi.mocked(api.generateSummary).mockReturnValueOnce(generateSummaryPromise)
    vi.mocked(api.createBookmark).mockResolvedValue({
      id: '42',
      url: 'https://example.com',
      title: 'New Site',
      createdAt: '2024-01-01T00:00:00.000Z',
    })
    renderPage()
    await waitFor(() => expect(api.listBookmarks).toHaveBeenCalledTimes(1))

    vi.mocked(api.listBookmarks).mockResolvedValue([
      {
        id: '42',
        url: 'https://example.com',
        title: 'New Site',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ])

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))

    expect(await screen.findByText('Summarizing…')).toBeInTheDocument()

    resolveGenerateSummary({ summary: 'A summary.' })
    await waitFor(() => expect(screen.queryByText('Summarizing…')).not.toBeInTheDocument())
  })

  it('does not clear an unrelated, newer add-failure error when a background summary refresh lands late', async () => {
    let resolveGenerateSummaryA!: (value: { summary: string }) => void
    const generateSummaryAPromise = new Promise<{ summary: string }>((resolve) => {
      resolveGenerateSummaryA = resolve
    })
    vi.mocked(api.generateSummary).mockReturnValueOnce(generateSummaryAPromise)

    vi.mocked(api.createBookmark)
      .mockResolvedValueOnce({
        id: 'A',
        url: 'https://example.com/a',
        title: 'Site A',
        createdAt: '2024-01-01T00:00:00.000Z',
      })
      .mockRejectedValueOnce(new Error('network error'))

    renderPage()
    await waitFor(() => expect(api.listBookmarks).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com/a' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))
    await waitFor(() => expect(api.generateSummary).toHaveBeenCalledWith('A'))

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com/b' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))
    expect(await screen.findByText('Failed to add bookmark.')).toBeInTheDocument()

    resolveGenerateSummaryA({ summary: 'A summary.' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.getByText('Failed to add bookmark.')).toBeInTheDocument()
  })

  it('applies a foreground refresh that resolves after a background refresh has already failed', async () => {
    renderPage()
    await waitFor(() => expect(api.listBookmarks).toHaveBeenCalledTimes(1))

    let resolveSummaryEarlier!: (value: { summary: string }) => void
    const summaryEarlierPromise = new Promise<{ summary: string }>((resolve) => {
      resolveSummaryEarlier = resolve
    })
    vi.mocked(api.generateSummary).mockReturnValueOnce(summaryEarlierPromise)
    vi.mocked(api.createBookmark).mockResolvedValueOnce({
      id: 'earlier',
      url: 'https://example.com/earlier',
      title: 'Earlier',
      createdAt: '2024-01-01T00:00:00.000Z',
    })
    vi.mocked(api.listBookmarks).mockResolvedValueOnce([
      {
        id: 'earlier',
        url: 'https://example.com/earlier',
        title: 'Earlier',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ])

    fireEvent.change(screen.getByLabelText('URL'), {
      target: { value: 'https://example.com/earlier' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))
    await waitFor(() => expect(api.generateSummary).toHaveBeenCalledWith('earlier'))

    let resolveForegroundFetch!: (value: Awaited<ReturnType<typeof api.listBookmarks>>) => void
    const foregroundFetchPromise = new Promise<Awaited<ReturnType<typeof api.listBookmarks>>>(
      (resolve) => {
        resolveForegroundFetch = resolve
      }
    )
    vi.mocked(api.listBookmarks).mockReturnValueOnce(foregroundFetchPromise)
    vi.mocked(api.createBookmark).mockResolvedValueOnce({
      id: 'new',
      url: 'https://example.com/new',
      title: 'New Site',
      createdAt: '2024-01-01T00:00:00.000Z',
    })
    vi.mocked(api.generateSummary).mockReturnValueOnce(new Promise(() => {}))

    let rejectBackgroundFetch!: (error: Error) => void
    const backgroundFetchPromise = new Promise<Awaited<ReturnType<typeof api.listBookmarks>>>(
      (_resolve, reject) => {
        rejectBackgroundFetch = reject
      }
    )
    vi.mocked(api.listBookmarks).mockReturnValueOnce(backgroundFetchPromise)

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com/new' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))
    await waitFor(() => expect(api.listBookmarks).toHaveBeenCalledTimes(3))

    resolveSummaryEarlier({ summary: 'A summary.' })
    await waitFor(() => expect(api.listBookmarks).toHaveBeenCalledTimes(4))

    rejectBackgroundFetch(new Error('network error'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    resolveForegroundFetch([
      {
        id: 'earlier',
        url: 'https://example.com/earlier',
        title: 'Earlier',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
      {
        id: 'new',
        url: 'https://example.com/new',
        title: 'New Site',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ])

    expect(await screen.findByRole('link', { name: /New Site/ })).toBeInTheDocument()
    expect(screen.queryByText('Failed to load bookmarks.')).not.toBeInTheDocument()
    expect(screen.queryByText('Failed to add bookmark.')).not.toBeInTheDocument()
  })

  it('does not let a slow older refresh response overwrite a newer one already applied', async () => {
    renderPage()
    await waitFor(() => expect(api.listBookmarks).toHaveBeenCalledTimes(1))

    let resolveSummaryOld!: (value: { summary: string }) => void
    const summaryOldPromise = new Promise<{ summary: string }>((resolve) => {
      resolveSummaryOld = resolve
    })
    vi.mocked(api.generateSummary).mockReturnValueOnce(summaryOldPromise)
    vi.mocked(api.createBookmark).mockResolvedValueOnce({
      id: 'old',
      url: 'https://example.com/old',
      title: 'Old Site',
      createdAt: '2024-01-01T00:00:00.000Z',
    })
    vi.mocked(api.listBookmarks).mockResolvedValueOnce([
      { id: 'old', url: 'https://example.com/old', title: 'Old Site', createdAt: '2024-01-01T00:00:00.000Z' },
    ])

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com/old' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))
    await waitFor(() => expect(api.generateSummary).toHaveBeenCalledWith('old'))

    let resolveOldBackgroundFetch!: (value: Awaited<ReturnType<typeof api.listBookmarks>>) => void
    const oldBackgroundFetchPromise = new Promise<Awaited<ReturnType<typeof api.listBookmarks>>>(
      (resolve) => {
        resolveOldBackgroundFetch = resolve
      }
    )
    vi.mocked(api.listBookmarks).mockReturnValueOnce(oldBackgroundFetchPromise)

    resolveSummaryOld({ summary: 'A summary.' })
    await waitFor(() => expect(api.listBookmarks).toHaveBeenCalledTimes(3))

    vi.mocked(api.createBookmark).mockResolvedValueOnce({
      id: 'new',
      url: 'https://example.com/new',
      title: 'New Site',
      createdAt: '2024-01-01T00:00:00.000Z',
    })
    vi.mocked(api.listBookmarks).mockResolvedValueOnce([
      { id: 'old', url: 'https://example.com/old', title: 'Old Site', createdAt: '2024-01-01T00:00:00.000Z' },
      { id: 'new', url: 'https://example.com/new', title: 'New Site', createdAt: '2024-01-01T00:00:00.000Z' },
    ])
    vi.mocked(api.generateSummary).mockReturnValueOnce(new Promise(() => {}))

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com/new' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))

    expect(await screen.findByRole('link', { name: /New Site/ })).toBeInTheDocument()

    resolveOldBackgroundFetch([
      { id: 'old', url: 'https://example.com/old', title: 'Old Site', createdAt: '2024-01-01T00:00:00.000Z' },
    ])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.getByRole('link', { name: /New Site/ })).toBeInTheDocument()
  })

  it('deletes a bookmark and drops it from the list', async () => {
    vi.mocked(api.listBookmarks).mockResolvedValue([
      {
        id: '1',
        url: 'https://example.com',
        title: 'Example Site',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
      {
        id: '2',
        url: 'https://other.example',
        title: 'Other Site',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ])
    vi.mocked(api.deleteBookmark).mockResolvedValue(undefined)
    renderPage()
    await screen.findByRole('link', { name: /Example Site/ })

    fireEvent.click(screen.getByRole('button', { name: 'Delete Example Site on example.com' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm deleting Example Site on example.com' })
    )

    await waitFor(() =>
      expect(screen.queryByRole('link', { name: /Example Site/ })).not.toBeInTheDocument()
    )
    expect(api.deleteBookmark).toHaveBeenCalledWith('1')
    expect(api.listBookmarks).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('link', { name: /Other Site/ })).toBeInTheDocument()
  })

  it('keeps the bookmark and shows an error when the delete fails', async () => {
    vi.mocked(api.listBookmarks).mockResolvedValue([
      {
        id: '1',
        url: 'https://example.com',
        title: 'Example Site',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ])
    vi.mocked(api.deleteBookmark).mockRejectedValue(new Error('API error: 500'))
    renderPage()
    await screen.findByRole('link', { name: /Example Site/ })

    fireEvent.click(screen.getByRole('button', { name: 'Delete Example Site on example.com' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm deleting Example Site on example.com' })
    )

    expect(await screen.findByText('Failed to delete bookmark.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Example Site/ })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Delete Example Site on example.com' })
    ).toBeInTheDocument()
  })

  it('does not let a list fetch issued before a delete put the deleted row back', async () => {
    let resolveStaleFetch!: (value: Bookmark[]) => void
    const initial = [
      {
        id: '1',
        url: 'https://example.com',
        title: 'Example Site',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ]
    vi.mocked(api.listBookmarks).mockResolvedValueOnce(initial)
    vi.mocked(api.deleteBookmark).mockResolvedValue(undefined)
    renderPage()
    await screen.findByRole('link', { name: /Example Site/ })

    vi.mocked(api.createBookmark).mockResolvedValue({
      id: '2',
      url: 'https://other.example',
      title: 'Other Site',
      createdAt: '2024-01-01T00:00:00.000Z',
    })
    vi.mocked(api.generateSummary).mockReturnValue(new Promise(() => {}))
    vi.mocked(api.listBookmarks).mockReturnValueOnce(
      new Promise<Bookmark[]>((resolve) => {
        resolveStaleFetch = resolve
      })
    )
    fireEvent.change(screen.getByLabelText('URL'), {
      target: { value: 'https://other.example' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))
    await waitFor(() => expect(api.listBookmarks).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByRole('button', { name: 'Delete Example Site on example.com' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm deleting Example Site on example.com' })
    )
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: /Example Site/ })).not.toBeInTheDocument()
    )

    await act(async () => {
      resolveStaleFetch(initial)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(screen.queryByRole('link', { name: /Example Site/ })).not.toBeInTheDocument()
  })

  it('keeps a concurrently added bookmark from the same in-flight fetch it filters the deleted one out of', async () => {
    let resolveAddRefresh!: (value: Bookmark[]) => void
    const deleted = {
      id: '1',
      url: 'https://example.com',
      title: 'Example Site',
      createdAt: '2024-01-01T00:00:00.000Z',
    }
    const added = {
      id: '2',
      url: 'https://other.example',
      title: 'Other Site',
      createdAt: '2024-01-01T00:00:00.000Z',
    }
    vi.mocked(api.listBookmarks).mockResolvedValueOnce([deleted])
    vi.mocked(api.deleteBookmark).mockResolvedValue(undefined)
    vi.mocked(api.createBookmark).mockResolvedValue(added)
    vi.mocked(api.generateSummary).mockRejectedValue(new Error('API error: 503'))
    renderPage()
    await screen.findByRole('link', { name: /Example Site/ })

    vi.mocked(api.listBookmarks).mockReturnValueOnce(
      new Promise<Bookmark[]>((resolve) => {
        resolveAddRefresh = resolve
      })
    )
    fireEvent.change(screen.getByLabelText('URL'), {
      target: { value: 'https://other.example' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))
    await waitFor(() => expect(api.listBookmarks).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByRole('button', { name: 'Delete Example Site on example.com' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm deleting Example Site on example.com' })
    )
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: /Example Site/ })).not.toBeInTheDocument()
    )

    await act(async () => {
      resolveAddRefresh([deleted, added])
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(screen.getByRole('link', { name: /Other Site/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Example Site/ })).not.toBeInTheDocument()
  })

  it('does not surface an error when summary generation fails', async () => {
    vi.mocked(api.createBookmark).mockResolvedValue({
      id: '42',
      url: 'https://example.com',
      title: 'New Site',
      createdAt: '2024-01-01T00:00:00.000Z',
    })
    vi.mocked(api.generateSummary).mockRejectedValue(new Error('API error: 502'))
    renderPage()
    await waitFor(() => expect(api.listBookmarks).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))

    await waitFor(() => expect(api.generateSummary).toHaveBeenCalled())
    expect(screen.queryByText('Failed to add bookmark.')).not.toBeInTheDocument()
  })

  it('clears the summarizing state when summary generation fails', async () => {
    let rejectGenerateSummary!: (reason: Error) => void
    vi.mocked(api.generateSummary).mockReturnValueOnce(
      new Promise<{ summary: string }>((_resolve, reject) => {
        rejectGenerateSummary = reject
      })
    )
    vi.mocked(api.createBookmark).mockResolvedValue({
      id: '42',
      url: 'https://example.com',
      title: 'New Site',
      createdAt: '2024-01-01T00:00:00.000Z',
    })
    renderPage()
    await waitFor(() => expect(api.listBookmarks).toHaveBeenCalledTimes(1))

    vi.mocked(api.listBookmarks).mockResolvedValue([
      {
        id: '42',
        url: 'https://example.com',
        title: 'New Site',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ])

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))

    expect(await screen.findByText('Summarizing…')).toBeInTheDocument()

    rejectGenerateSummary(new Error('API error: 502'))
    await waitFor(() => expect(screen.queryByText('Summarizing…')).not.toBeInTheDocument())
    expect(screen.queryByText('Failed to add bookmark.')).not.toBeInTheDocument()
  })
})

describe('BookmarksPage read flag', () => {
  const unread: Bookmark = {
    id: '1',
    url: 'https://example.com',
    title: 'Example Site',
    isRead: false,
    createdAt: '2024-01-01T00:00:00.000Z',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.listBookmarks).mockResolvedValue([unread])
    vi.mocked(api.setReadState).mockResolvedValue(undefined)
    vi.mocked(api.generateSummary).mockResolvedValue({ summary: 'A summary.' })
  })

  it('stores the flag for the row that was clicked', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /as read/ }))
    await waitFor(() => expect(api.setReadState).toHaveBeenCalledWith('1', true))
  })

  it('marks the row read straight away, before the write settles', async () => {
    let resolveWrite!: () => void
    vi.mocked(api.setReadState).mockReturnValue(
      new Promise<void>((resolve) => {
        resolveWrite = resolve
      })
    )

    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /as read/ }))

    expect(await screen.findByRole('button', { name: /as unread/ })).toBeInTheDocument()
    await act(async () => {
      resolveWrite()
    })
    expect(screen.getByRole('button', { name: /as unread/ })).toBeInTheDocument()
  })

  it('puts the row back and says so when the write fails', async () => {
    vi.mocked(api.setReadState).mockRejectedValue(new Error('API error: 500'))

    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /as read/ }))

    expect(await screen.findByText('Failed to mark as read.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /as read/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Example Site/ })).not.toHaveTextContent('Read')
  })

  it('names the direction that failed when unmarking', async () => {
    vi.mocked(api.listBookmarks).mockResolvedValue([{ ...unread, isRead: true }])
    vi.mocked(api.setReadState).mockRejectedValue(new Error('API error: 500'))

    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /as unread/ }))

    expect(await screen.findByText('Failed to mark as unread.')).toBeInTheDocument()
  })

  it('keeps the flag when a response from a fetch issued before the write lands afterwards', async () => {
    const newSite: Bookmark = { ...unread, id: '2', title: 'New Site' }
    let resolveWrite!: () => void
    vi.mocked(api.setReadState).mockReturnValue(
      new Promise<void>((resolve) => {
        resolveWrite = resolve
      })
    )
    vi.mocked(api.generateSummary).mockReturnValue(new Promise(() => {}))
    vi.mocked(api.listBookmarks)
      .mockResolvedValueOnce([unread])
      .mockResolvedValueOnce([unread, newSite])
    vi.mocked(api.createBookmark).mockResolvedValue(newSite)

    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Example Site.* as read/ }))
    await waitFor(() => expect(api.setReadState).toHaveBeenCalledWith('1', true))

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))
    await screen.findByRole('link', { name: /New Site/ })

    expect(screen.getByRole('button', { name: /Example Site.* as unread/ })).toBeInTheDocument()

    await act(async () => {
      resolveWrite()
    })
    expect(screen.getByRole('button', { name: /Example Site.* as unread/ })).toBeInTheDocument()
  })

  it('keeps a flag a refresh already confirmed when the write then reports failure', async () => {
    const newSite: Bookmark = { ...unread, id: '2', title: 'New Site' }
    let failWrite!: (error: Error) => void
    vi.mocked(api.setReadState).mockReturnValue(
      new Promise<void>((_resolve, reject) => {
        failWrite = reject
      })
    )
    vi.mocked(api.generateSummary).mockReturnValue(new Promise(() => {}))
    vi.mocked(api.listBookmarks)
      .mockResolvedValueOnce([unread])
      .mockResolvedValueOnce([{ ...unread, isRead: true }, newSite])
    vi.mocked(api.createBookmark).mockResolvedValue(newSite)

    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Example Site.* as read/ }))
    await waitFor(() => expect(api.setReadState).toHaveBeenCalledWith('1', true))

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))
    await screen.findByRole('link', { name: /New Site/ })

    await act(async () => {
      failWrite(new Error('API error: 500'))
    })

    expect(screen.getByRole('button', { name: /Example Site.* as unread/ })).toBeInTheDocument()
    expect(screen.queryByText('Failed to mark as read.')).not.toBeInTheDocument()
  })

  it('believes a fetch issued after the write, even when it disagrees', async () => {
    const newSite: Bookmark = { ...unread, id: '2', title: 'New Site' }
    vi.mocked(api.generateSummary).mockReturnValue(new Promise(() => {}))
    vi.mocked(api.listBookmarks)
      .mockResolvedValueOnce([unread])
      .mockResolvedValue([unread, newSite])
    vi.mocked(api.createBookmark).mockResolvedValue(newSite)

    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Example Site.* as read/ }))
    await waitFor(() => expect(api.setReadState).toHaveBeenCalledWith('1', true))
    expect(screen.getByRole('button', { name: /Example Site.* as unread/ })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))
    await screen.findByRole('link', { name: /New Site/ })

    expect(
      await screen.findByRole('button', { name: /Example Site.* as read/ })
    ).toBeInTheDocument()
  })

  it('lets the server win again once a response agrees with what was stored', async () => {
    const newSite: Bookmark = { ...unread, id: '2', title: 'New Site' }
    const otherSite: Bookmark = { ...unread, id: '3', title: 'Other Site' }
    vi.mocked(api.generateSummary).mockReturnValue(new Promise(() => {}))
    vi.mocked(api.listBookmarks)
      .mockResolvedValueOnce([unread])
      .mockResolvedValueOnce([{ ...unread, isRead: true }, newSite])
      .mockResolvedValue([unread, newSite, otherSite])
    vi.mocked(api.createBookmark).mockResolvedValueOnce(newSite).mockResolvedValueOnce(otherSite)

    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Example Site.* as read/ }))
    await waitFor(() => expect(api.setReadState).toHaveBeenCalledWith('1', true))

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))
    await screen.findByRole('link', { name: /New Site/ })
    expect(screen.getByRole('button', { name: /Example Site.* as unread/ })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://other.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))
    await screen.findByRole('link', { name: /Other Site/ })

    expect(
      await screen.findByRole('button', { name: /Example Site.* as read/ })
    ).toBeInTheDocument()
  })
})

describe('BookmarksPage read filter', () => {
  const unreadBookmark = {
    id: '1',
    url: 'https://example.com',
    title: 'Unread Site',
    isRead: false,
    createdAt: '2024-01-01T00:00:00.000Z',
  }
  const readBookmark = {
    id: '2',
    url: 'https://other.example',
    title: 'Read Site',
    isRead: true,
    createdAt: '2024-01-01T00:00:00.000Z',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.listBookmarks).mockResolvedValue([unreadBookmark, readBookmark])
    vi.mocked(api.setReadState).mockResolvedValue(undefined)
  })

  it('shows every bookmark under the All filter, which is where the page starts', async () => {
    renderPage()

    expect(await screen.findByRole('link', { name: /Unread Site/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Read Site/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('hides read bookmarks under the Unread filter', async () => {
    renderPage()
    await screen.findByRole('link', { name: /Unread Site/ })

    fireEvent.click(screen.getByRole('button', { name: 'Unread' }))

    expect(screen.getByRole('link', { name: /Unread Site/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Read Site/ })).not.toBeInTheDocument()
  })

  it('hides unread bookmarks under the Read filter', async () => {
    renderPage()
    await screen.findByRole('link', { name: /Unread Site/ })

    fireEvent.click(screen.getByRole('button', { name: 'Read' }))

    expect(screen.getByRole('link', { name: /Read Site/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Unread Site/ })).not.toBeInTheDocument()
  })

  it('filters the list it already holds, without refetching', async () => {
    renderPage()
    await screen.findByRole('link', { name: /Unread Site/ })

    fireEvent.click(screen.getByRole('button', { name: 'Unread' }))
    fireEvent.click(screen.getByRole('button', { name: 'Read' }))

    expect(api.listBookmarks).toHaveBeenCalledTimes(1)
  })

  it('tells the user the filter is empty rather than that they have no bookmarks', async () => {
    vi.mocked(api.listBookmarks).mockResolvedValue([readBookmark])
    renderPage()
    await screen.findByRole('link', { name: /Read Site/ })

    fireEvent.click(screen.getByRole('button', { name: 'Unread' }))

    expect(screen.getByText('Nothing unread.')).toBeInTheDocument()
    expect(
      screen.queryByText('No bookmarks yet — paste a URL above to add one.')
    ).not.toBeInTheDocument()
  })

  it('says nothing is read yet under an empty Read filter', async () => {
    vi.mocked(api.listBookmarks).mockResolvedValue([unreadBookmark])
    renderPage()
    await screen.findByRole('link', { name: /Unread Site/ })

    fireEvent.click(screen.getByRole('button', { name: 'Read' }))

    expect(screen.getByText('Nothing read yet.')).toBeInTheDocument()
  })

  it('drops a bookmark out of the Unread filter as soon as it is marked read', async () => {
    renderPage()
    await screen.findByRole('link', { name: /Unread Site/ })
    fireEvent.click(screen.getByRole('button', { name: 'Unread' }))

    fireEvent.click(screen.getByRole('button', { name: 'Mark Unread Site on example.com as read' }))

    await waitFor(() =>
      expect(screen.queryByRole('link', { name: /Unread Site/ })).not.toBeInTheDocument()
    )
  })

  it('brings the row back into the Unread filter when the write fails', async () => {
    vi.mocked(api.setReadState).mockRejectedValue(new Error('API error: 500'))
    renderPage()
    await screen.findByRole('link', { name: /Unread Site/ })
    fireEvent.click(screen.getByRole('button', { name: 'Unread' }))

    fireEvent.click(screen.getByRole('button', { name: 'Mark Unread Site on example.com as read' }))

    expect(await screen.findByText('Failed to mark as read.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Unread Site/ })).toBeInTheDocument()
  })

  it('keeps the chosen filter across a list refresh', async () => {
    renderPage()
    await screen.findByRole('link', { name: /Unread Site/ })
    fireEvent.click(screen.getByRole('button', { name: 'Read' }))

    vi.mocked(api.createBookmark).mockResolvedValue(unreadBookmark)
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))

    await waitFor(() => expect(api.listBookmarks).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('button', { name: 'Read' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('link', { name: /Unread Site/ })).not.toBeInTheDocument()
  })
})

describe('BookmarksPage empty library under a filter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.listBookmarks).mockResolvedValue([])
  })

  it('keeps the add-a-bookmark prompt when the library itself is empty', async () => {
    renderPage()
    await screen.findByText('No bookmarks yet — paste a URL above to add one.')

    fireEvent.click(screen.getByRole('button', { name: 'Unread' }))

    expect(screen.getByText('No bookmarks yet — paste a URL above to add one.')).toBeInTheDocument()
    expect(screen.queryByText('Nothing unread.')).not.toBeInTheDocument()
  })

  it('keeps it under the Read filter too', async () => {
    renderPage()
    await screen.findByText('No bookmarks yet — paste a URL above to add one.')

    fireEvent.click(screen.getByRole('button', { name: 'Read' }))

    expect(screen.getByText('No bookmarks yet — paste a URL above to add one.')).toBeInTheDocument()
    expect(screen.queryByText('Nothing read yet.')).not.toBeInTheDocument()
  })
})

describe('BookmarksPage malformed list response', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders the empty state when the API resolves with something that is not a list', async () => {
    vi.mocked(api.listBookmarks).mockResolvedValue({ oops: true } as unknown as Bookmark[])
    renderPage()

    expect(
      await screen.findByText('No bookmarks yet — paste a URL above to add one.')
    ).toBeInTheDocument()
  })

  it('still filters without throwing on a malformed list', async () => {
    vi.mocked(api.listBookmarks).mockResolvedValue({ oops: true } as unknown as Bookmark[])
    renderPage()
    await screen.findByText('No bookmarks yet — paste a URL above to add one.')

    fireEvent.click(screen.getByRole('button', { name: 'Unread' }))

    expect(screen.getByText('No bookmarks yet — paste a URL above to add one.')).toBeInTheDocument()
  })
})
