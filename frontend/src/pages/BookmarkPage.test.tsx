import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Routes, Route, Link } from 'react-router-dom'

vi.mock('../api', () => ({
  api: {
    getBookmark: vi.fn(),
    generateSummary: vi.fn(),
  },
}))

import { api } from '../api'
import BookmarkPage from './BookmarkPage'

const bookmark = {
  id: '1',
  url: 'https://example.com/article',
  title: 'Example Article',
  createdAt: '2024-01-01T00:00:00.000Z',
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/bookmarks/1']}>
      <Routes>
        <Route path="/bookmarks/:id" element={<BookmarkPage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('BookmarkPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.getBookmark).mockResolvedValue(bookmark)
  })

  it('shows a loading indicator while the bookmark loads', () => {
    vi.mocked(api.getBookmark).mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByRole('status', { name: 'Loading bookmark' })).toBeInTheDocument()
  })

  it('shows the title and a link to the original site', async () => {
    renderPage()
    expect(await screen.findByText('Example Article')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /example\.com/ })).toHaveAttribute(
      'href',
      'https://example.com/article'
    )
  })

  it('renders the summary paragraph and bullets', async () => {
    vi.mocked(api.getBookmark).mockResolvedValue({
      ...bookmark,
      summary: 'This article explains widgets.\n- First point\n- Second point\n- Third point',
    })
    renderPage()
    expect(await screen.findByText('This article explains widgets.')).toBeInTheDocument()
    const items = screen.getAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual([
      'First point',
      'Second point',
      'Third point',
    ])
  })

  it('offers to generate a summary when the bookmark has none', async () => {
    renderPage()
    expect(await screen.findByText('No summary yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate summary' })).toBeInTheDocument()
  })

  it('generates a summary when the button is clicked', async () => {
    vi.mocked(api.generateSummary).mockResolvedValue({
      summary: 'Freshly generated.\n- a\n- b\n- c',
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Generate summary' }))
    expect(api.generateSummary).toHaveBeenCalledWith('1')
    expect(await screen.findByText('Freshly generated.')).toBeInTheDocument()
  })

  it('renders label chips from the generate response without a refetch', async () => {
    vi.mocked(api.generateSummary).mockResolvedValue({
      summary: 'A summary.',
      labels: ['typescript'],
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Generate summary' }))
    expect(await screen.findByText('typescript')).toBeInTheDocument()
    expect(api.getBookmark).toHaveBeenCalledTimes(1)
  })

  it('shows a retry button when generation fails', async () => {
    vi.mocked(api.generateSummary).mockRejectedValue(new Error('API error: 502'))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Generate summary' }))
    expect(await screen.findByText("Couldn't generate a summary.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('retries generation from the retry button', async () => {
    vi.mocked(api.generateSummary)
      .mockRejectedValueOnce(new Error('API error: 502'))
      .mockResolvedValueOnce({ summary: 'Second time lucky.' })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Generate summary' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Second time lucky.')).toBeInTheDocument()
  })

  it('disables the button while generation is in flight', async () => {
    vi.mocked(api.generateSummary).mockReturnValue(new Promise(() => {}))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Generate summary' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Generating/ })).toBeDisabled())
  })

  it('shows an error with a way back when the bookmark cannot be loaded', async () => {
    vi.mocked(api.getBookmark).mockRejectedValue(new Error('API error: 404'))
    renderPage()
    expect(await screen.findByText('Failed to load this bookmark.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Back/ })).toHaveAttribute('href', '/')
  })

  it("resets loading and stale state when the route's id changes", async () => {
    vi.mocked(api.getBookmark).mockResolvedValueOnce(bookmark)
    render(
      <MemoryRouter initialEntries={['/bookmarks/1']}>
        <Link to="/bookmarks/2">Bookmark 2</Link>
        <Routes>
          <Route path="/bookmarks/:id" element={<BookmarkPage />} />
        </Routes>
      </MemoryRouter>
    )
    expect(await screen.findByText('Example Article')).toBeInTheDocument()

    let resolveSecond: (value: typeof bookmark) => void = () => {}
    vi.mocked(api.getBookmark).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSecond = resolve
      })
    )
    fireEvent.click(screen.getByRole('link', { name: 'Bookmark 2' }))

    expect(screen.getByRole('status', { name: 'Loading bookmark' })).toBeInTheDocument()
    expect(screen.queryByText('Example Article')).not.toBeInTheDocument()

    resolveSecond({ ...bookmark, id: '2', title: 'Second Article' })
    expect(await screen.findByText('Second Article')).toBeInTheDocument()
  })

  it("does not show bookmark 1's in-flight generation state on bookmark 2", async () => {
    vi.mocked(api.getBookmark).mockResolvedValueOnce(bookmark)
    render(
      <MemoryRouter initialEntries={['/bookmarks/1']}>
        <Link to="/bookmarks/2">Bookmark 2</Link>
        <Routes>
          <Route path="/bookmarks/:id" element={<BookmarkPage />} />
        </Routes>
      </MemoryRouter>
    )
    expect(await screen.findByRole('button', { name: 'Generate summary' })).toBeInTheDocument()

    vi.mocked(api.generateSummary).mockReturnValue(new Promise(() => {}))
    fireEvent.click(screen.getByRole('button', { name: 'Generate summary' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Generating/ })).toBeDisabled())

    vi.mocked(api.getBookmark).mockResolvedValueOnce({
      ...bookmark,
      id: '2',
      title: 'Second Article',
    })
    fireEvent.click(screen.getByRole('link', { name: 'Bookmark 2' }))

    expect(await screen.findByText('Second Article')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate summary' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /Generating/ })).not.toBeInTheDocument()
  })

  it("does not write bookmark 1's late-arriving summary onto bookmark 2", async () => {
    vi.mocked(api.getBookmark).mockResolvedValueOnce(bookmark)
    render(
      <MemoryRouter initialEntries={['/bookmarks/1']}>
        <Link to="/bookmarks/2">Bookmark 2</Link>
        <Routes>
          <Route path="/bookmarks/:id" element={<BookmarkPage />} />
        </Routes>
      </MemoryRouter>
    )
    expect(await screen.findByRole('button', { name: 'Generate summary' })).toBeInTheDocument()

    let resolveGenerate: (value: { summary: string }) => void = () => {}
    const pendingGenerate = new Promise<{ summary: string }>((resolve) => {
      resolveGenerate = resolve
    })
    vi.mocked(api.generateSummary).mockReturnValue(pendingGenerate)
    fireEvent.click(screen.getByRole('button', { name: 'Generate summary' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Generating/ })).toBeDisabled())

    vi.mocked(api.getBookmark).mockResolvedValueOnce({
      ...bookmark,
      id: '2',
      title: 'Second Article',
      summary: 'Second summary already here.',
    })
    fireEvent.click(screen.getByRole('link', { name: 'Bookmark 2' }))
    expect(await screen.findByText('Second summary already here.')).toBeInTheDocument()

    await act(async () => {
      resolveGenerate({ summary: 'Stale summary from bookmark 1.' })
      await pendingGenerate
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.queryByText('Stale summary from bookmark 1.')).not.toBeInTheDocument()
    expect(screen.getByText('Second summary already here.')).toBeInTheDocument()
  })
})

describe('BookmarkPage summary polling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.getBookmark).mockResolvedValue(bookmark)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function flush() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
  }

  it('picks up a summary that arrives from a later poll', async () => {
    vi.mocked(api.getBookmark)
      .mockResolvedValueOnce(bookmark)
      .mockResolvedValueOnce({ ...bookmark, summary: 'Polled summary.' })
    renderPage()
    await flush()
    expect(screen.getByText('No summary yet.')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    expect(screen.getByText('Polled summary.')).toBeInTheDocument()
    expect(api.getBookmark).toHaveBeenCalledTimes(2)
  })

  it('does not poll when a summary and labels are already present', async () => {
    vi.mocked(api.getBookmark).mockResolvedValueOnce({
      ...bookmark,
      summary: 'Existing summary.',
      labels: ['typescript'],
    })
    renderPage()
    await flush()
    expect(screen.getByText('Existing summary.')).toBeInTheDocument()
    expect(api.getBookmark).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(40000)
    })

    expect(api.getBookmark).toHaveBeenCalledTimes(1)
  })

  it('stops polling once the budget is exhausted', async () => {
    vi.mocked(api.getBookmark).mockResolvedValue(bookmark)
    renderPage()
    await flush()
    expect(api.getBookmark).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000)
    })
    const countAtBudget = vi.mocked(api.getBookmark).mock.calls.length
    expect(countAtBudget).toBe(16) // 1 initial load + 15 polls

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000)
    })
    expect(api.getBookmark).toHaveBeenCalledTimes(countAtBudget)
    expect(screen.getByText('No summary yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate summary' })).toBeInTheDocument()
  })

  it('cancels polling on unmount', async () => {
    vi.mocked(api.getBookmark).mockResolvedValue(bookmark)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { unmount } = renderPage()
    await flush()
    expect(api.getBookmark).toHaveBeenCalledTimes(1)

    unmount()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(40000)
    })

    expect(api.getBookmark).toHaveBeenCalledTimes(1)
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('keeps polling for labels that arrive after the summary', async () => {
    vi.mocked(api.getBookmark)
      .mockResolvedValueOnce({ ...bookmark, summary: 'A summary.' })
      .mockResolvedValueOnce({ ...bookmark, summary: 'A summary.', labels: ['typescript'] })
    renderPage()
    await flush()
    expect(screen.getByText('A summary.')).toBeInTheDocument()
    expect(screen.queryByText('typescript')).not.toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    expect(screen.getByText('typescript')).toBeInTheDocument()
    expect(api.getBookmark).toHaveBeenCalledTimes(2)
  })

  it('swallows a failed poll without surfacing an error, keeping the remaining budget', async () => {
    vi.mocked(api.getBookmark)
      .mockResolvedValueOnce(bookmark)
      .mockRejectedValueOnce(new Error('API error: 500'))
      .mockResolvedValueOnce({ ...bookmark, summary: 'Recovered summary.' })
    renderPage()
    await flush()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(screen.queryByText('Failed to load this bookmark.')).not.toBeInTheDocument()
    expect(screen.getByText('No summary yet.')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(screen.getByText('Recovered summary.')).toBeInTheDocument()
    expect(api.getBookmark).toHaveBeenCalledTimes(3)
  })
})

describe('labels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders label chips when the bookmark has labels', async () => {
    vi.mocked(api.getBookmark).mockResolvedValue({
      ...bookmark,
      summary: 'A summary.',
      labels: ['typescript', 'testing'],
    })
    renderPage()
    expect(await screen.findByText('typescript')).toBeInTheDocument()
    expect(screen.getByText('testing')).toBeInTheDocument()
  })

  it('renders no chip container when the bookmark has no labels', async () => {
    vi.mocked(api.getBookmark).mockResolvedValue({
      ...bookmark,
      summary: 'A summary.',
    })
    renderPage()
    await screen.findByText('Example Article')
    expect(screen.queryByTestId('bookmark-labels')).not.toBeInTheDocument()
  })

  it('offers to regenerate when the bookmark has a summary but no labels', async () => {
    vi.mocked(api.getBookmark).mockResolvedValue({
      ...bookmark,
      summary: 'A summary.',
    })
    renderPage()
    await screen.findByText('A summary.')
    expect(screen.getByRole('button', { name: 'Regenerate summary' })).toBeInTheDocument()
  })

  it('regenerates the summary and labels when the regenerate button is clicked', async () => {
    vi.mocked(api.getBookmark).mockResolvedValue({
      ...bookmark,
      summary: 'A summary.',
    })
    vi.mocked(api.generateSummary).mockResolvedValue({
      summary: 'A summary.',
      labels: ['typescript'],
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Regenerate summary' }))
    expect(api.generateSummary).toHaveBeenCalledWith('1')
    expect(await screen.findByText('typescript')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Regenerate summary' })).not.toBeInTheDocument()
  })

  it('does not show a regenerate button when the bookmark already has labels', async () => {
    vi.mocked(api.getBookmark).mockResolvedValue({
      ...bookmark,
      summary: 'A summary.',
      labels: ['typescript'],
    })
    renderPage()
    await screen.findByText('typescript')
    expect(screen.queryByRole('button', { name: 'Regenerate summary' })).not.toBeInTheDocument()
  })
})
