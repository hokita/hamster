import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../api', () => ({
  api: { askQuestion: vi.fn() },
}))

import ArticleChat from './ArticleChat'
import { api } from '../api'

function ask(question: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Ask a question about this article' }), {
    target: { value: question },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ArticleChat', () => {
  it('renders a question box with an Ask button', () => {
    render(<ArticleChat bookmarkId="1" />)
    expect(
      screen.getByRole('textbox', { name: 'Ask a question about this article' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ask' })).toBeInTheDocument()
  })

  it('disables Ask while the question box is empty', () => {
    render(<ArticleChat bookmarkId="1" />)
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: 'Ask a question about this article' }), {
      target: { value: 'Why?' },
    })
    expect(screen.getByRole('button', { name: 'Ask' })).toBeEnabled()
  })

  it('shows the question and the answer once it arrives', async () => {
    vi.mocked(api.askQuestion).mockResolvedValue({ answer: 'The article argues X.' })
    render(<ArticleChat bookmarkId="1" />)

    ask('What is the main argument?')

    expect(screen.getByText('What is the main argument?')).toBeInTheDocument()
    expect(await screen.findByText('The article argues X.')).toBeInTheDocument()
    expect(api.askQuestion).toHaveBeenCalledWith('1', [
      { role: 'user', text: 'What is the main argument?' },
    ])
  })

  it('clears the question box after asking', async () => {
    vi.mocked(api.askQuestion).mockResolvedValue({ answer: 'An answer.' })
    render(<ArticleChat bookmarkId="1" />)

    ask('A question?')

    expect(
      screen.getByRole('textbox', { name: 'Ask a question about this article' })
    ).toHaveValue('')
    await screen.findByText('An answer.')
  })

  it('sends the whole conversation on a follow-up, so it sees earlier turns', async () => {
    vi.mocked(api.askQuestion).mockResolvedValueOnce({ answer: 'First answer.' })
    vi.mocked(api.askQuestion).mockResolvedValueOnce({ answer: 'Second answer.' })
    render(<ArticleChat bookmarkId="1" />)

    ask('First question?')
    await screen.findByText('First answer.')
    ask('Follow-up?')
    await screen.findByText('Second answer.')

    expect(api.askQuestion).toHaveBeenLastCalledWith('1', [
      { role: 'user', text: 'First question?' },
      { role: 'model', text: 'First answer.' },
      { role: 'user', text: 'Follow-up?' },
    ])
  })

  it('disables Ask while an answer is in flight', async () => {
    let resolveAnswer: (value: { answer: string }) => void = () => {}
    vi.mocked(api.askQuestion).mockReturnValue(
      new Promise((resolve) => {
        resolveAnswer = resolve
      })
    )
    render(<ArticleChat bookmarkId="1" />)

    ask('A question?')
    fireEvent.change(screen.getByRole('textbox', { name: 'Ask a question about this article' }), {
      target: { value: 'Another?' },
    })
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled()

    resolveAnswer({ answer: 'Done.' })
    await screen.findByText('Done.')
    expect(screen.getByRole('button', { name: 'Ask' })).toBeEnabled()
  })

  it('shows an error and a Retry button when answering fails, keeping the question', async () => {
    vi.mocked(api.askQuestion).mockRejectedValue(new Error('API error: 502'))
    render(<ArticleChat bookmarkId="1" />)

    ask('A question?')

    expect(await screen.findByText("Couldn't answer that question.")).toBeInTheDocument()
    expect(screen.getByText('A question?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('blocks new questions while a failed turn is pending', async () => {
    // Submitting another question would append a second consecutive user turn: the single answer
    // then reads as a reply to both, with the failed question left as misleading context.
    vi.mocked(api.askQuestion).mockRejectedValue(new Error('API error: 502'))
    render(<ArticleChat bookmarkId="1" />)

    ask('A question?')
    await screen.findByText("Couldn't answer that question.")

    expect(
      screen.getByRole('textbox', { name: 'Ask a question about this article' })
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled()
  })

  it('discards the failed question, clearing the error and reopening the form', async () => {
    vi.mocked(api.askQuestion).mockRejectedValue(new Error('API error: 502'))
    render(<ArticleChat bookmarkId="1" />)

    ask('A question?')
    await screen.findByText("Couldn't answer that question.")
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    expect(screen.queryByText('A question?')).not.toBeInTheDocument()
    expect(screen.queryByText("Couldn't answer that question.")).not.toBeInTheDocument()
    expect(
      screen.getByRole('textbox', { name: 'Ask a question about this article' })
    ).toBeEnabled()
  })

  it('caps the question length at the backend limit, so a long paste cannot wedge the chat', () => {
    // The backend 400s a message over 4000 chars, and a failed turn stays in the history for
    // Retry — so an over-long question would leave the chat failing forever. Never let one in.
    render(<ArticleChat bookmarkId="1" />)
    expect(
      screen.getByRole('textbox', { name: 'Ask a question about this article' })
    ).toHaveAttribute('maxLength', '4000')
  })

  it('stops accepting questions once the conversation reaches the backend cap', async () => {
    // The backend 400s a conversation over 40 messages; the 21st question would push it to 41
    // and every ask from there would fail. Close the input at the cap instead.
    for (let i = 1; i <= 20; i++) {
      vi.mocked(api.askQuestion).mockResolvedValueOnce({ answer: `Answer ${i}.` })
    }
    render(<ArticleChat bookmarkId="1" />)

    for (let i = 1; i <= 20; i++) {
      ask(`Question ${i}?`)
      await screen.findByText(`Answer ${i}.`)
    }

    expect(
      screen.getByRole('textbox', { name: 'Ask a question about this article' })
    ).toBeDisabled()
    expect(screen.getByText(/conversation is full/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled()
  })

  it('marks each message with its own language, so screen readers pronounce it right', async () => {
    // index.html declares lang="en" for the document; without an override a Japanese answer is
    // read with English pronunciation rules. Same derivation the summary uses, but per message —
    // a conversation can mix languages turn by turn.
    vi.mocked(api.askQuestion).mockResolvedValue({
      answer: 'この記事は要約について説明しています。',
    })
    render(<ArticleChat bookmarkId="1" />)

    ask('What does the article say?')

    expect(await screen.findByText('この記事は要約について説明しています。')).toHaveAttribute(
      'lang',
      'ja'
    )
    expect(screen.getByText('What does the article say?')).toHaveAttribute('lang', 'en')
  })

  it('exposes the conversation as a log, so arriving answers are announced', async () => {
    // Without a live region a screen-reader user hears the waiting status appear and vanish, and
    // then nothing: the answer lands in an ordinary list, unannounced. role="log" is the chat
    // semantic — implicitly aria-live, announcing additions but not re-reading the history.
    vi.mocked(api.askQuestion).mockResolvedValue({ answer: 'An answer.' })
    render(<ArticleChat bookmarkId="1" />)

    ask('A question?')
    await screen.findByText('An answer.')

    const log = screen.getByRole('log', { name: 'Conversation' })
    expect(log).toContainElement(screen.getByText('An answer.'))
  })

  it('retries with the same conversation and clears the error on success', async () => {
    vi.mocked(api.askQuestion).mockRejectedValueOnce(new Error('API error: 502'))
    vi.mocked(api.askQuestion).mockResolvedValueOnce({ answer: 'Recovered answer.' })
    render(<ArticleChat bookmarkId="1" />)

    ask('A question?')
    await screen.findByText("Couldn't answer that question.")
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('Recovered answer.')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByText("Couldn't answer that question.")).not.toBeInTheDocument()
    )
    expect(api.askQuestion).toHaveBeenLastCalledWith('1', [{ role: 'user', text: 'A question?' }])
  })
})
