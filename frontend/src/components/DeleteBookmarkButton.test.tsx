import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import DeleteBookmarkButton from './DeleteBookmarkButton'

describe('DeleteBookmarkButton', () => {
  it('does not delete on the first click — it asks first', () => {
    const onDelete = vi.fn()
    render(<DeleteBookmarkButton title="Example Site" onDelete={onDelete} />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete Example Site' }))

    expect(onDelete).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: 'Confirm deleting Example Site' })
    ).toBeInTheDocument()
  })

  it('deletes once the confirmation is clicked', () => {
    const onDelete = vi.fn()
    render(<DeleteBookmarkButton title="Example Site" onDelete={onDelete} />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete Example Site' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm deleting Example Site' }))

    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('returns to the resting state on cancel without deleting', () => {
    const onDelete = vi.fn()
    render(<DeleteBookmarkButton title="Example Site" onDelete={onDelete} />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete Example Site' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel deleting Example Site' }))

    expect(onDelete).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Delete Example Site' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Confirm deleting Example Site' })
    ).not.toBeInTheDocument()
  })

  it('leaves the confirmation behind once it has been answered', () => {
    // A failed delete leaves the button mounted. It should be back to a plain "Delete", not still
    // asking a question the user already answered.
    const onDelete = vi.fn()
    render(<DeleteBookmarkButton title="Example Site" onDelete={onDelete} />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete Example Site' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm deleting Example Site' }))

    expect(screen.getByRole('button', { name: 'Delete Example Site' })).toBeInTheDocument()
  })

  it('shows a busy indicator instead of the button while the delete is in flight', () => {
    render(<DeleteBookmarkButton title="Example Site" onDelete={vi.fn()} isDeleting />)

    expect(screen.getByRole('status', { name: 'Deleting Example Site' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete Example Site' })).not.toBeInTheDocument()
  })

  it('shows the word Delete in the labeled variant', () => {
    render(<DeleteBookmarkButton title="Example Site" onDelete={vi.fn()} variant="labeled" />)

    expect(screen.getByRole('button', { name: 'Delete Example Site' })).toHaveTextContent('Delete')
  })
})
