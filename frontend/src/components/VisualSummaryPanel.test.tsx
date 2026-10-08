import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
vi.mock('../api', () => ({ api: { generateVisualSummary: vi.fn() } }))
import { api } from '../api'
import VisualSummaryPanel from './VisualSummaryPanel'
import type { VisualSummary } from '../../../backend/src/visualSummary'

const source = 'Saved summary.'
const value: VisualSummary = {
  blocks: [
    { type: 'cards', title: 'Points', items: [{ title: 'Key fact', text: 'Supported fact.' }] },
    {
      type: 'comparison',
      title: 'Options',
      columns: ['Product', 'Cost'],
      rows: [
        ['A', '$10'],
        ['B', '$20'],
      ],
    },
    { type: 'steps', title: 'Procedure', items: ['Read the summary', 'Check the result'] },
    {
      type: 'qa',
      title: 'Questions',
      items: [{ question: 'What is covered?', answer: 'The saved summary.' }],
    },
  ],
}
const clickGenerate = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Generate visual summary' }))
function deferred() {
  let resolve!: (value: { visualSummary: VisualSummary; source: string }) => void
  let reject!: (error: Error) => void
  const promise = new Promise<{ visualSummary: VisualSummary; source: string }>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.generateVisualSummary).mockResolvedValue({ visualSummary: value, source })
})
afterEach(() => vi.useRealTimers())

describe('VisualSummaryPanel', () => {
  it('does not generate on mount and renders only the selected blocks after clicking', async () => {
    vi.mocked(api.generateVisualSummary).mockResolvedValue({
      source,
      visualSummary: { blocks: [value.blocks[0]] },
    })
    render(<VisualSummaryPanel bookmarkId="1" summary={source} />)
    expect(api.generateVisualSummary).not.toHaveBeenCalled()
    clickGenerate()
    expect(await screen.findByText('Supported fact.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(api.generateVisualSummary).toHaveBeenCalledWith('1', expect.any(AbortSignal))
  })
  it('announces loading and prevents repeated clicks while pending', async () => {
    const response = deferred()
    vi.mocked(api.generateVisualSummary).mockReturnValue(response.promise)
    render(<VisualSummaryPanel bookmarkId="1" summary={source} />)
    clickGenerate()
    const button = screen.getByRole('button', { name: 'Generating visual summary…' })
    expect(button).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Generating visual summary…')
    fireEvent.click(button)
    expect(api.generateVisualSummary).toHaveBeenCalledTimes(1)
    await act(async () => response.resolve({ source, visualSummary: value }))
    expect(screen.getByRole('status')).toHaveTextContent('Visual summary generated.')
  })
  it.each([
    ['API error: 502', "Couldn't generate a visual summary"],
    ['API error: 503', 'GEMINI_API_KEY'],
    ['API error: 504', 'timed out'],
    ['API error: 409', 'saved summary changed'],
  ])('shows a helpful failure and permits retry: %s', async (error, message) => {
    vi.mocked(api.generateVisualSummary).mockRejectedValueOnce(new Error(error))
    render(<VisualSummaryPanel bookmarkId="1" summary={source} />)
    clickGenerate()
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Supported fact.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('rejects a response generated from a different saved summary', async () => {
    vi.mocked(api.generateVisualSummary).mockResolvedValue({
      source: 'Different summary.',
      visualSummary: value,
    })
    render(<VisualSummaryPanel bookmarkId="1" summary={source} />)
    clickGenerate()
    expect(await screen.findByRole('alert')).toHaveTextContent('saved summary changed')
    expect(screen.queryByText('Supported fact.')).not.toBeInTheDocument()
  })
  it.each(['navigate', 'summary', 'regenerate', 'unmount'])(
    'aborts and ignores late success when %s occurs',
    async (change) => {
      const response = deferred()
      vi.mocked(api.generateVisualSummary).mockReturnValue(response.promise)
      const view = render(<VisualSummaryPanel bookmarkId="1" summary={source} />)
      clickGenerate()
      const signal = vi.mocked(api.generateVisualSummary).mock.calls[0][1]!
      if (change === 'unmount') view.unmount()
      else
        view.rerender(
          <VisualSummaryPanel
            bookmarkId={change === 'navigate' ? '2' : '1'}
            summary={change === 'summary' ? 'Updated summary.' : source}
            disabled={change === 'regenerate'}
          />
        )
      expect(signal.aborted).toBe(true)
      await act(async () => response.resolve({ source, visualSummary: value }))
      expect(screen.queryByText('Supported fact.')).not.toBeInTheDocument()
      expect(screen.queryByText('Generating visual summary…')).not.toBeInTheDocument()
    }
  )
  it('ignores a late failure after navigation, including leaving and returning to the same article', async () => {
    const response = deferred()
    vi.mocked(api.generateVisualSummary).mockReturnValueOnce(response.promise)
    const view = render(<VisualSummaryPanel bookmarkId="1" summary={source} />)
    clickGenerate()
    view.rerender(<VisualSummaryPanel bookmarkId="2" summary={source} />)
    view.rerender(<VisualSummaryPanel bookmarkId="1" summary={source} />)
    await act(async () => response.reject(new Error('API error: 502')))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    clickGenerate()
    expect(await screen.findByText('Supported fact.')).toBeInTheDocument()
  })
  it('disables generation during summary regeneration, then starts a fresh session', async () => {
    const view = render(<VisualSummaryPanel bookmarkId="1" summary={source} disabled />)
    expect(screen.getByRole('button')).toBeDisabled()
    fireEvent.click(screen.getByRole('button'))
    expect(api.generateVisualSummary).not.toHaveBeenCalled()
    view.rerender(<VisualSummaryPanel bookmarkId="1" summary={source} />)
    clickGenerate()
    expect(await screen.findByText('Supported fact.')).toBeInTheDocument()
    view.rerender(<VisualSummaryPanel bookmarkId="1" summary={source} disabled />)
    expect(screen.queryByText('Supported fact.')).not.toBeInTheDocument()
    view.rerender(<VisualSummaryPanel bookmarkId="1" summary={source} />)
    expect(screen.getByRole('button', { name: 'Generate visual summary' })).toBeEnabled()
  })
  it('renders a semantic comparison and supports checkbox and native Q&A interaction', async () => {
    render(<VisualSummaryPanel bookmarkId="1" summary={source} />)
    clickGenerate()
    expect(await screen.findByRole('table', { name: 'Options' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Product' })).toHaveAttribute('scope', 'col')
    expect(screen.getByRole('rowheader', { name: 'A' })).toHaveAttribute('scope', 'row')
    const checkbox = screen.getByRole('checkbox', { name: '1. Read the summary' })
    expect(checkbox).not.toBeChecked()
    fireEvent.click(checkbox)
    expect(checkbox).toBeChecked()
    fireEvent.click(checkbox)
    expect(checkbox).not.toBeChecked()
    const question = screen.getByText('What is covered?')
    expect(question.closest('details')).not.toHaveAttribute('open')
    fireEvent.click(question)
    expect(question.closest('details')).toHaveAttribute('open')
    fireEvent.click(question)
    expect(question.closest('details')).not.toHaveAttribute('open')
  })
  it('discards generated UI and interaction state on source replacement', async () => {
    const view = render(<VisualSummaryPanel bookmarkId="1" summary={source} />)
    clickGenerate()
    const checkbox = await screen.findByRole('checkbox', { name: '1. Read the summary' })
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByText('What is covered?'))
    view.rerender(<VisualSummaryPanel bookmarkId="1" summary="Updated summary." />)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    vi.mocked(api.generateVisualSummary).mockResolvedValue({
      source: 'Updated summary.',
      visualSummary: value,
    })
    clickGenerate()
    expect(await screen.findByRole('checkbox', { name: '1. Read the summary' })).not.toBeChecked()
    expect(screen.getByText('What is covered?').closest('details')).not.toHaveAttribute('open')
  })
  it('renders HTML, JavaScript and JSX as inert text without inserting elements', async () => {
    const payload = '<img src=x onerror=alert(1)><script>alert(1)</script>{danger()}'
    vi.mocked(api.generateVisualSummary).mockResolvedValue({
      source,
      visualSummary: {
        blocks: [{ type: 'cards', title: 'Points', items: [{ title: '<App />', text: payload }] }],
      },
    })
    const { container } = render(<VisualSummaryPanel bookmarkId="1" summary={source} />)
    clickGenerate()
    expect(await screen.findByText(payload)).toBeInTheDocument()
    expect(screen.getByText('<App />')).toBeInTheDocument()
    expect(container.querySelector('img, script')).toBeNull()
  })
  it('bounds client waiting and permits retry after timeout', async () => {
    vi.useFakeTimers()
    vi.mocked(api.generateVisualSummary).mockImplementation(
      (_id, signal) =>
        new Promise((_resolve, reject) => {
          signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        })
    )
    render(<VisualSummaryPanel bookmarkId="1" summary={source} />)
    clickGenerate()
    await act(async () => vi.advanceTimersByTimeAsync(35_000))
    expect(screen.getByRole('alert')).toHaveTextContent('timed out')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
  })
})
