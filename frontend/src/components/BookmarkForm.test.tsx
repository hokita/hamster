import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import BookmarkForm from './BookmarkForm'

describe('BookmarkForm', () => {
  it('calls onAdd with the trimmed url, then clears the field', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined)
    render(<BookmarkForm onAdd={onAdd} />)

    fireEvent.change(screen.getByLabelText('URL'), {
      target: { value: '  https://example.com  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))

    expect(onAdd).toHaveBeenCalledWith({ url: 'https://example.com' })
    await waitFor(() => {
      expect(screen.getByLabelText('URL')).toHaveValue('')
    })
  })

  it('keeps the entered value when onAdd fails', async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error('failed'))
    render(<BookmarkForm onAdd={onAdd} />)

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))

    await waitFor(() => expect(onAdd).toHaveBeenCalled())
    expect(screen.getByLabelText('URL')).toHaveValue('https://example.com')
  })

  it('does not call onAdd when the URL is empty', () => {
    const onAdd = vi.fn()
    render(<BookmarkForm onAdd={onAdd} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('disables the input while a submit is in flight, preventing edits from being lost', async () => {
    let resolveOnAdd!: () => void
    const onAdd = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveOnAdd = resolve
        })
    )
    render(<BookmarkForm onAdd={onAdd} />)

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))

    expect(screen.getByLabelText('URL')).toBeDisabled()

    resolveOnAdd()
    await waitFor(() => expect(screen.getByLabelText('URL')).not.toBeDisabled())
  })

  it('ignores a second submit while the first is still in flight', async () => {
    let resolveOnAdd!: () => void
    const onAdd = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveOnAdd = resolve
        })
    )
    render(<BookmarkForm onAdd={onAdd} />)

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))

    expect(onAdd).toHaveBeenCalledTimes(1)
    resolveOnAdd()
    await waitFor(() => expect(screen.getByLabelText('URL')).toHaveValue(''))
  })
})
