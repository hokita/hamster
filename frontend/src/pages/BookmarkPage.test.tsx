import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Routes, Route, Link } from 'react-router-dom'

vi.mock('../api', () => ({
  api: {
    getBookmark: vi.fn(),
    generateSummary: vi.fn(),
    deleteBookmark: vi.fn(),
    setReadState: vi.fn(),
    askQuestion: vi.fn(),
  },
}))

import { api } from '../api'
import BookmarkPage from './BookmarkPage'

const bookmark = {
  id: '1',
  url: 'https://example.com/article',
  title: 'Example Article',
  isRead: false,
  createdAt: '2024-01-01T00:00:00.000Z',
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/bookmarks/1']}>
      <Routes>
        <Route path="/bookmarks/:id" element={<BookmarkPage />} />
        {/* Stands in for the list page, so a delete's navigation is observable here. */}
        <Route path="/" element={<p>Bookmarks list</p>} />
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

  it('renders markdown headings, bullets and bold as formatted elements', async () => {
    vi.mocked(api.getBookmark).mockResolvedValue({
      ...bookmark,
      summary:
        'This article explains widgets.\n\n## Key points\n\n' +
        '- **Widgets ship early** — the first batch left in March.\n' +
        '- **Cost fell** — a unit now costs $4.\n\n' +
        '## Takeaway\n\nWorth reading for widget buyers.',
    })
    renderPage()

    // The heading sits under the page's own "Summary" <h2>, so it has to be an <h3>.
    const heading = await screen.findByRole('heading', { name: 'Key points', level: 3 })
    expect(heading).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Takeaway', level: 3 })).toBeInTheDocument()
    expect(screen.getByText('This article explains widgets.')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    // The bold lead-in is an element, not literal asterisks around the text.
    expect(screen.getByText('Widgets ship early').tagName).toBe('STRONG')
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument()
  })

  it('drops links and images from a summary, keeping their text', async () => {
    // The summary is written from an untrusted page, and the prompt never asks for a link — so a
    // URL in one came from the page, and rendering it would hand a hostile page a live link on a
    // page the user trusts.
    vi.mocked(api.getBookmark).mockResolvedValue({
      ...bookmark,
      summary:
        'Read [the vendor page](https://evil.example/phish) for more.\n\n' +
        '![a banner](https://evil.example/banner.png)',
    })
    renderPage()

    // The page's own chrome has links, so this asks about the summary's would-be link by name.
    expect(await screen.findByText(/Read the vendor page for more\./)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'the vendor page' })).not.toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByText(/evil\.example/)).not.toBeInTheDocument()
    // An image's text lives in its alt attribute rather than its children, so dropping the node
    // would take the caption with it. The URL is what had to go, not the words.
    expect(screen.getByText('a banner')).toBeInTheDocument()
  })

  it('renders a plain-text summary saved before summaries were markdown', async () => {
    vi.mocked(api.getBookmark).mockResolvedValue({
      ...bookmark,
      summary: 'This article explains widgets.\n- First point\n- Second point\n- Third point',
    })
    renderPage()
    expect(await screen.findByText('This article explains widgets.')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'First point',
      'Second point',
      'Third point',
    ])
  })

  it('keeps "・" bullets in an older summary as a list', async () => {
    // CommonMark does not know "・" as a list marker, so without a rewrite these lines collapse
    // into one paragraph with the breaks rendered as spaces — the bullets would run together.
    vi.mocked(api.getBookmark).mockResolvedValue({
      ...bookmark,
      summary:
        'この記事はウィジェットについて説明している。\n・最初の点\n・二つ目の点\n・三つ目の点',
    })
    renderPage()

    expect(
      await screen.findByText('この記事はウィジェットについて説明している。')
    ).toBeInTheDocument()
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '最初の点',
      '二つ目の点',
      '三つ目の点',
    ])
  })

  it('leaves a "・" inside a sentence alone', async () => {
    // Japanese uses "・" between the halves of a compound name, mid-line and mid-sentence. Only a
    // line that opens with one is a bullet.
    vi.mocked(api.getBookmark).mockResolvedValue({
      ...bookmark,
      summary: 'テスト・ドリブン開発について論じている。',
    })
    renderPage()

    expect(await screen.findByText('テスト・ドリブン開発について論じている。')).toBeInTheDocument()
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
  })

  it('offers to regenerate an existing summary', async () => {
    vi.mocked(api.getBookmark).mockResolvedValue({ ...bookmark, summary: 'First take.' })
    vi.mocked(api.generateSummary).mockResolvedValue({ summary: 'Second take.' })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Regenerate' }))
    expect(api.generateSummary).toHaveBeenCalledWith('1')
    expect(await screen.findByText('Second take.')).toBeInTheDocument()
    expect(screen.queryByText('First take.')).not.toBeInTheDocument()
  })

  it('keeps the summary visible and disables the button while regenerating', async () => {
    vi.mocked(api.getBookmark).mockResolvedValue({ ...bookmark, summary: 'First take.' })
    vi.mocked(api.generateSummary).mockReturnValue(new Promise(() => {}))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Regenerate' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Regenerating/ })).toBeDisabled())
    expect(screen.getByText('First take.')).toBeInTheDocument()
  })

  it('keeps the existing summary when regeneration fails', async () => {
    vi.mocked(api.getBookmark).mockResolvedValue({ ...bookmark, summary: 'First take.' })
    vi.mocked(api.generateSummary).mockRejectedValue(new Error('API error: 502'))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Regenerate' }))
    expect(await screen.findByText(/Couldn't regenerate the summary/)).toBeInTheDocument()
    expect(screen.getByText('First take.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeEnabled()
  })

  it('adopts a summary the failed request had already persisted', async () => {
    vi.mocked(api.getBookmark)
      .mockResolvedValueOnce({ ...bookmark, summary: 'First take.' })
      .mockResolvedValueOnce({ ...bookmark, summary: 'Written before the connection dropped.' })
    vi.mocked(api.generateSummary).mockRejectedValue(new Error('API error: 502'))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Regenerate' }))
    expect(await screen.findByText('Written before the connection dropped.')).toBeInTheDocument()
    expect(screen.queryByText(/Couldn't regenerate the summary/)).not.toBeInTheDocument()
  })

  it('reports failure when the re-read after a failed regeneration also fails', async () => {
    vi.mocked(api.getBookmark)
      .mockResolvedValueOnce({ ...bookmark, summary: 'First take.' })
      .mockRejectedValueOnce(new Error('API error: 500'))
    vi.mocked(api.generateSummary).mockRejectedValue(new Error('API error: 502'))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Regenerate' }))
    expect(await screen.findByText(/Couldn't regenerate the summary/)).toBeInTheDocument()
    expect(screen.getByText('First take.')).toBeInTheDocument()
  })

  // index.html declares lang="en" for the document, so a Japanese summary needs its own lang or a
  // screen reader announces it with English pronunciation rules.
  it('marks a Japanese summary as Japanese', async () => {
    vi.mocked(api.getBookmark).mockResolvedValue({
      ...bookmark,
      summary:
        'この記事はウィジェットの仕組みを説明しています。\n- 最初の要点\n- 二つ目の要点\n- 三つ目の要点',
    })
    renderPage()
    const paragraph = await screen.findByText('この記事はウィジェットの仕組みを説明しています。')
    expect(paragraph.closest('[lang]')).toHaveAttribute('lang', 'ja')
  })

  it('leaves an English summary in English, even when it quotes a Japanese term', async () => {
    vi.mocked(api.getBookmark).mockResolvedValue({
      ...bookmark,
      summary:
        'The article explains the widget process, which it calls "改善", in detail for newcomers.',
    })
    renderPage()
    const paragraph = await screen.findByText(/The article explains the widget process/)
    expect(paragraph.closest('[lang]')).toHaveAttribute('lang', 'en')
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

describe('BookmarkPage delete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.getBookmark).mockResolvedValue(bookmark)
  })

  it('asks before deleting', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Example Article' })

    fireEvent.click(
      screen.getByRole('button', { name: 'Delete Example Article on example.com/article' })
    )

    expect(api.deleteBookmark).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', {
        name: 'Confirm deleting Example Article on example.com/article',
      })
    ).toBeInTheDocument()
  })

  it('deletes the bookmark and goes back to the list', async () => {
    vi.mocked(api.deleteBookmark).mockResolvedValue(undefined)
    renderPage()
    await screen.findByRole('heading', { name: 'Example Article' })

    fireEvent.click(
      screen.getByRole('button', { name: 'Delete Example Article on example.com/article' })
    )
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Confirm deleting Example Article on example.com/article',
      })
    )

    expect(await screen.findByText('Bookmarks list')).toBeInTheDocument()
    expect(api.deleteBookmark).toHaveBeenCalledWith('1')
  })

  it('stays on the page and reports a failed delete', async () => {
    vi.mocked(api.deleteBookmark).mockRejectedValue(new Error('API error: 500'))
    renderPage()
    await screen.findByRole('heading', { name: 'Example Article' })

    fireEvent.click(
      screen.getByRole('button', { name: 'Delete Example Article on example.com/article' })
    )
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Confirm deleting Example Article on example.com/article',
      })
    )

    expect(await screen.findByText("Couldn't delete this bookmark.")).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Example Article' })).toBeInTheDocument()
    // Ready for another attempt rather than stuck showing a spinner.
    expect(
      screen.getByRole('button', { name: 'Delete Example Article on example.com/article' })
    ).toBeInTheDocument()
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

  it('clears an earlier failure when polling installs a summary', async () => {
    vi.mocked(api.getBookmark)
      .mockResolvedValueOnce(bookmark)
      .mockResolvedValueOnce(bookmark)
      .mockResolvedValueOnce({ ...bookmark, summary: 'Summary from the background run.' })
    vi.mocked(api.generateSummary).mockRejectedValue(new Error('API error: 502'))
    renderPage()
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Generate summary' }))
    await flush()
    expect(screen.getByText("Couldn't generate a summary.")).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    expect(screen.getByText('Summary from the background run.')).toBeInTheDocument()
    expect(screen.queryByText(/Couldn't regenerate the summary/)).not.toBeInTheDocument()
  })

  // The backend keeps generating after the client goes away, so a regeneration whose request died
  // can still land — the one immediate re-read in the failure path is only the first sample.
  it('keeps watching for a regeneration that lands after its request failed', async () => {
    vi.mocked(api.getBookmark)
      .mockResolvedValueOnce({ ...bookmark, summary: 'First take.' })
      .mockResolvedValueOnce({ ...bookmark, summary: 'First take.' })
      .mockResolvedValueOnce({ ...bookmark, summary: 'Landed after the request died.' })
    vi.mocked(api.generateSummary).mockRejectedValue(new Error('API error: 502'))
    renderPage()
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    await flush()
    expect(screen.getByText(/Couldn't regenerate the summary/)).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    expect(screen.getByText('Landed after the request died.')).toBeInTheDocument()
    expect(screen.queryByText(/Couldn't regenerate the summary/)).not.toBeInTheDocument()
  })

  it('stops watching a superseded summary once the budget is spent', async () => {
    vi.mocked(api.getBookmark).mockResolvedValue({ ...bookmark, summary: 'First take.' })
    vi.mocked(api.generateSummary).mockRejectedValue(new Error('API error: 502'))
    renderPage()
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    await flush()
    const countAfterFailure = vi.mocked(api.getBookmark).mock.calls.length

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000)
    })

    expect(vi.mocked(api.getBookmark).mock.calls.length).toBe(countAfterFailure + 30) // poll budget
    expect(screen.getByText('First take.')).toBeInTheDocument()
    expect(screen.getByText(/Couldn't regenerate the summary/)).toBeInTheDocument()
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
      await vi.advanceTimersByTimeAsync(60000)
    })
    const countAtBudget = vi.mocked(api.getBookmark).mock.calls.length
    expect(countAtBudget).toBe(31) // 1 initial load + 30 polls

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

  it('adopts replacement labels when a failed regeneration reproduced the same summary text', async () => {
    vi.mocked(api.getBookmark)
      .mockResolvedValueOnce({ ...bookmark, summary: 'Same take.', labels: ['old-topic'] })
      .mockResolvedValueOnce({ ...bookmark, summary: 'Same take.', labels: ['old-topic'] })
      .mockResolvedValueOnce({ ...bookmark, summary: 'Same take.' })
      .mockResolvedValueOnce({ ...bookmark, summary: 'Same take.', labels: ['fresh-topic'] })
    vi.mocked(api.generateSummary).mockRejectedValue(new Error('API error: 502'))
    renderPage()
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    await flush()
    expect(screen.getByText(/Couldn't regenerate the summary/)).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(screen.queryByText('old-topic')).not.toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(screen.getByText('fresh-topic')).toBeInTheDocument()
    expect(screen.queryByText(/Couldn't regenerate the summary/)).not.toBeInTheDocument()
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

  // The always-present Regenerate button doubles as the labels backfill path for bookmarks
  // whose summary predates labels: the response carries the labels, and merging them into
  // state is what makes the chips appear without a refetch.
  it('surfaces labels from a regeneration', async () => {
    vi.mocked(api.getBookmark).mockResolvedValue({
      ...bookmark,
      summary: 'A summary.',
    })
    vi.mocked(api.generateSummary).mockResolvedValue({
      summary: 'A summary.',
      labels: ['typescript'],
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Regenerate' }))
    expect(api.generateSummary).toHaveBeenCalledWith('1')
    expect(await screen.findByText('typescript')).toBeInTheDocument()
  })

  // If the labels step of a regeneration fails server-side, the response carries a new summary
  // but no labels — the server has already cleared the old ones (see updateSummary), and the
  // page must not paper over that by keeping the previous topics attached to text they no
  // longer describe.
  it('drops stale label chips when a regeneration response carries no labels', async () => {
    vi.mocked(api.getBookmark).mockResolvedValue({
      ...bookmark,
      summary: 'Old summary.',
      labels: ['old-topic'],
    })
    vi.mocked(api.generateSummary).mockResolvedValue({ summary: 'New summary.' })
    renderPage()
    expect(await screen.findByText('old-topic')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }))

    expect(await screen.findByText('New summary.')).toBeInTheDocument()
    expect(screen.queryByText('old-topic')).not.toBeInTheDocument()
    expect(screen.queryByTestId('bookmark-labels')).not.toBeInTheDocument()
  })
})

describe('article chat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.getBookmark).mockResolvedValue(bookmark)
  })

  it('offers a question box once the bookmark has loaded', async () => {
    renderPage()
    expect(
      await screen.findByRole('textbox', { name: 'Ask a question about this article' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ask' })).toBeInTheDocument()
  })

  it('asks about this bookmark, not some other one', async () => {
    vi.mocked(api.askQuestion).mockResolvedValue({ answer: 'An answer.' })
    renderPage()

    fireEvent.change(
      await screen.findByRole('textbox', { name: 'Ask a question about this article' }),
      { target: { value: 'A question?' } }
    )
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))

    await screen.findByText('An answer.')
    expect(api.askQuestion).toHaveBeenCalledWith('1', [{ role: 'user', text: 'A question?' }])
  })
})

describe('BookmarkPage read flag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.getBookmark).mockResolvedValue(bookmark)
    vi.mocked(api.setReadState).mockResolvedValue(undefined)
  })

  it('offers to mark an unread bookmark as read', async () => {
    renderPage()
    expect(await screen.findByRole('button', { name: /as read/ })).toHaveTextContent('Mark as read')
  })

  it('stores the flag and flips the button without waiting for the write', async () => {
    let resolveWrite!: () => void
    vi.mocked(api.setReadState).mockReturnValue(
      new Promise<void>((resolve) => {
        resolveWrite = resolve
      })
    )

    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /as read/ }))

    expect(await screen.findByRole('button', { name: /as unread/ })).toBeInTheDocument()
    expect(api.setReadState).toHaveBeenCalledWith('1', true)
    await act(async () => {
      resolveWrite()
    })
    expect(screen.getByRole('button', { name: /as unread/ })).toBeEnabled()
  })

  it('unmarks a bookmark that is already read', async () => {
    vi.mocked(api.getBookmark).mockResolvedValue({ ...bookmark, isRead: true })

    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /as unread/ }))

    await waitFor(() => expect(api.setReadState).toHaveBeenCalledWith('1', false))
    expect(await screen.findByRole('button', { name: /as read/ })).toBeInTheDocument()
  })

  it('puts the button back and reports a failed write', async () => {
    vi.mocked(api.setReadState).mockRejectedValue(new Error('API error: 500'))

    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /as read/ }))

    expect(await screen.findByText("Couldn't save the read state.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /as read/ })).toBeInTheDocument()
  })

  it('keeps the flag when a poll snapshot taken before the write lands afterwards', async () => {
    vi.useFakeTimers()
    try {
      // No summary yet, so the page polls. The first snapshot predates the toggle and still
      // reports the bookmark unread; adopting that wholesale would flip the button back.
      let resolveWrite!: () => void
      vi.mocked(api.setReadState).mockReturnValue(
        new Promise<void>((resolve) => {
          resolveWrite = resolve
        })
      )
      vi.mocked(api.getBookmark).mockResolvedValue(bookmark)

      render(
        <MemoryRouter initialEntries={['/bookmarks/1']}>
          <Routes>
            <Route path="/bookmarks/:id" element={<BookmarkPage />} />
          </Routes>
        </MemoryRouter>
      )
      await act(async () => {})

      fireEvent.click(screen.getByRole('button', { name: /as read/ }))
      await act(async () => {})

      // A poll now returns the pre-toggle document, carrying a summary so the result is adopted.
      vi.mocked(api.getBookmark).mockResolvedValue({ ...bookmark, summary: 'A summary.' })
      await act(async () => {
        vi.advanceTimersByTime(2000)
      })

      expect(screen.getByRole('button', { name: /as unread/ })).toBeInTheDocument()

      await act(async () => {
        resolveWrite()
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
