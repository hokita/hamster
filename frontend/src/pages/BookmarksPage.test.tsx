import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../api', () => ({
  api: {
    listBookmarks: vi.fn(),
    createBookmark: vi.fn(),
    generateSummary: vi.fn(),
    deleteBookmark: vi.fn(),
  },
}))
vi.mock('../firebase', () => ({ auth: {} }))
vi.mock('firebase/auth', () => ({ signOut: vi.fn() }))

import { signOut } from 'firebase/auth'
import { api } from '../api'
import type { Bookmark } from '../api'
import BookmarksPage from './BookmarksPage'

// BookmarksPage renders BookmarkList, whose rows are now react-router <Link>s, so every
// render here needs a router in the tree. This file otherwise belongs to a later task
// (the summary page's own routing); this wrapper is the minimum needed to keep it green.
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
    // once on mount, once right after the create, once after generation settles
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

    // mockResolvedValue (not Once): the add triggers two refreshes now — one right after
    // create, one after the generateSummary call it kicks off settles — and both should
    // see the post-add list.
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

    renderPage()
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
    // The add also kicks off generateSummary, which triggers a third refresh once it
    // settles. Queue it up front so it resolves with the post-add list, same as the second.
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

    renderPage()
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

    // Second call: the refresh right after create.
    vi.mocked(api.listBookmarks).mockResolvedValueOnce([
      {
        id: '42',
        url: 'https://example.com',
        title: 'New Site',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ])
    // Third call: the background refresh once generateSummary settles. Distinct title so an
    // assertion on it can only pass if this call's data — not the second call's — is what
    // actually reaches the rendered list.
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
    // A's generateSummary is held open so we can control exactly when its background
    // refresh lands, relative to B's failure.
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

    // Add A: succeeds. Its summary generation starts but does not resolve yet.
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com/a' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))
    await waitFor(() => expect(api.generateSummary).toHaveBeenCalledWith('A'))

    // Add B: fails, while A's generation is still in flight. The user is now looking at a
    // correct, up-to-date error about B.
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com/b' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))
    expect(await screen.findByText('Failed to add bookmark.')).toBeInTheDocument()

    // A's generation now lands, seconds later, and its background refresh runs. It has
    // nothing to do with B's failure and must not silently clear it.
    resolveGenerateSummaryA({ summary: 'A summary.' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.getByText('Failed to add bookmark.')).toBeInTheDocument()
  })

  it('applies a foreground refresh that resolves after a background refresh has already failed', async () => {
    renderPage()
    await waitFor(() => expect(api.listBookmarks).toHaveBeenCalledTimes(1))

    // Add "Earlier": its own foreground refresh resolves promptly. Its summary generation is
    // held open so we can control exactly when its background refresh fires, relative to the
    // "New" bookmark's foreground refresh below.
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
    // call #2: Earlier's foreground refresh.
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

    // Add "New": its foreground refresh (call #3) is held open under our control, so we can
    // resolve it after a newer background refresh has already been issued (and failed).
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
    // New's own summary generation is held open indefinitely so it never triggers a fifth
    // listBookmarks call during this test.
    vi.mocked(api.generateSummary).mockReturnValueOnce(new Promise(() => {}))

    // call #4: Earlier's background refresh (fired once its summary settles below), held open
    // under our control so it can be made to reject.
    let rejectBackgroundFetch!: (error: Error) => void
    const backgroundFetchPromise = new Promise<Awaited<ReturnType<typeof api.listBookmarks>>>(
      (_resolve, reject) => {
        rejectBackgroundFetch = reject
      }
    )
    vi.mocked(api.listBookmarks).mockReturnValueOnce(backgroundFetchPromise)

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com/new' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))
    // handleAdd is awaiting refresh() (call #3) here, so New's own generateSummary has not
    // been invoked yet.
    await waitFor(() => expect(api.listBookmarks).toHaveBeenCalledTimes(3))

    // Earlier's summary lands now, while New's foreground refresh is still in flight. This
    // issues Earlier's background refresh (call #4) — a newer fetch than New's foreground one.
    resolveSummaryEarlier({ summary: 'A summary.' })
    await waitFor(() => expect(api.listBookmarks).toHaveBeenCalledTimes(4))

    // That newer background refresh fails outright and is silently swallowed (background
    // refreshes never touch error state).
    rejectBackgroundFetch(new Error('network error'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    // New's foreground refresh — older, but still in flight — now resolves successfully. Its
    // result must still be applied even though a newer request was issued (and failed) first.
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

    // Add "Old": its own foreground refresh resolves promptly. Its summary generation is held
    // open so we control exactly when its (older) background refresh is issued.
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
    // call #2: Old's foreground refresh.
    vi.mocked(api.listBookmarks).mockResolvedValueOnce([
      { id: 'old', url: 'https://example.com/old', title: 'Old Site', createdAt: '2024-01-01T00:00:00.000Z' },
    ])

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com/old' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))
    await waitFor(() => expect(api.generateSummary).toHaveBeenCalledWith('old'))

    // call #3: Old's background refresh (issued once its summary settles below), held open so
    // it can be resolved last, with stale data, after a newer refresh has already applied.
    let resolveOldBackgroundFetch!: (value: Awaited<ReturnType<typeof api.listBookmarks>>) => void
    const oldBackgroundFetchPromise = new Promise<Awaited<ReturnType<typeof api.listBookmarks>>>(
      (resolve) => {
        resolveOldBackgroundFetch = resolve
      }
    )
    vi.mocked(api.listBookmarks).mockReturnValueOnce(oldBackgroundFetchPromise)

    resolveSummaryOld({ summary: 'A summary.' })
    await waitFor(() => expect(api.listBookmarks).toHaveBeenCalledTimes(3))

    // Add "New": its foreground refresh (call #4) is newer than Old's still-pending background
    // refresh, and resolves right away.
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
    // New's own summary generation is held open indefinitely so it never triggers a further
    // listBookmarks call during this test.
    vi.mocked(api.generateSummary).mockReturnValueOnce(new Promise(() => {}))

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com/new' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))

    expect(await screen.findByRole('link', { name: /New Site/ })).toBeInTheDocument()

    // Old's background refresh — issued earlier, but still in flight — now resolves last, with
    // stale data that doesn't include New. It must not overwrite the newer, already-applied state.
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
    // The row goes away on its own, without a second listBookmarks round trip.
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
    // Back to a resting delete button, ready for another attempt.
    expect(
      screen.getByRole('button', { name: 'Delete Example Site on example.com' })
    ).toBeInTheDocument()
  })

  it('does not let a list fetch issued before a delete put the deleted row back', async () => {
    // The add flow's refresh is in flight when the delete lands. Its response was assembled while
    // the bookmark still existed, so applying it afterwards would resurrect a deleted row.
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

    // Kick off an add whose refresh never settles until this test says so.
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
    // The add's own refresh is the only carrier of the new bookmark: its response was issued
    // before the delete, so the deleted row has to be filtered out of it — but discarding the
    // whole response would lose the addition with it, leaving a bookmark that was saved
    // successfully invisible until a reload. Summary generation is made to fail here, as it does
    // whenever GEMINI_API_KEY is unset, so no later background refresh can paper over it.
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

    // The add's refresh finally lands, carrying both bookmarks.
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
})
