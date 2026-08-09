import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import BookmarkForm from './BookmarkForm'

describe('BookmarkForm', () => {
  it('calls onAdd with trimmed title and url, then clears the fields', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined)
    render(<BookmarkForm onAdd={onAdd} />)

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '  Example  ' } })
    fireEvent.change(screen.getByLabelText('URL'), {
      target: { value: '  https://example.com  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))

    expect(onAdd).toHaveBeenCalledWith({ url: 'https://example.com', title: 'Example' })
    await waitFor(() => {
      expect(screen.getByLabelText('Title')).toHaveValue('')
      expect(screen.getByLabelText('URL')).toHaveValue('')
    })
  })

  it('keeps the entered values when onAdd fails', async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error('failed'))
    render(<BookmarkForm onAdd={onAdd} />)

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Example' } })
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))

    await waitFor(() => expect(onAdd).toHaveBeenCalled())
    expect(screen.getByLabelText('Title')).toHaveValue('Example')
    expect(screen.getByLabelText('URL')).toHaveValue('https://example.com')
  })

  it('does not call onAdd when a field is empty', () => {
    const onAdd = vi.fn()
    render(<BookmarkForm onAdd={onAdd} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('disables the inputs while a submit is in flight, preventing edits from being lost', async () => {
    let resolveOnAdd!: () => void
    const onAdd = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveOnAdd = resolve
        })
    )
    render(<BookmarkForm onAdd={onAdd} />)

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Example' } })
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))

    expect(screen.getByLabelText('Title')).toBeDisabled()
    expect(screen.getByLabelText('URL')).toBeDisabled()

    resolveOnAdd()
    await waitFor(() => expect(screen.getByLabelText('Title')).not.toBeDisabled())
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

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Example' } })
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))

    expect(onAdd).toHaveBeenCalledTimes(1)
    resolveOnAdd()
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue(''))
  })
})
