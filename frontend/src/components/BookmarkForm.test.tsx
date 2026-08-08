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

  it('does not call onAdd when a field is empty', () => {
    const onAdd = vi.fn()
    render(<BookmarkForm onAdd={onAdd} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))
    expect(onAdd).not.toHaveBeenCalled()
  })
})
