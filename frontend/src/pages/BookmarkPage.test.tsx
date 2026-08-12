import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

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
})
