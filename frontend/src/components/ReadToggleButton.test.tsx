import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import ReadToggleButton from './ReadToggleButton'

describe('ReadToggleButton', () => {
  it('offers to mark an unread bookmark as read', () => {
    render(<ReadToggleButton label="Example on example.com" isRead={false} onToggle={vi.fn()} />)
    expect(
      screen.getByRole('button', { name: 'Mark Example on example.com as read' })
    ).toBeInTheDocument()
  })

  it('offers to mark a read bookmark as unread', () => {
    render(<ReadToggleButton label="Example on example.com" isRead={true} onToggle={vi.fn()} />)
    expect(
      screen.getByRole('button', { name: 'Mark Example on example.com as unread' })
    ).toBeInTheDocument()
  })

  it('reports the state to move to rather than that it was clicked', () => {
    const onToggle = vi.fn()
    render(<ReadToggleButton label="Example" isRead={false} onToggle={onToggle} />)
    fireEvent.click(screen.getByRole('button', { name: 'Mark Example as read' }))
    expect(onToggle).toHaveBeenCalledWith(true)
  })

  it('asks for false when the bookmark is already read', () => {
    const onToggle = vi.fn()
    render(<ReadToggleButton label="Example" isRead={true} onToggle={onToggle} />)
    fireEvent.click(screen.getByRole('button', { name: 'Mark Example as unread' }))
    expect(onToggle).toHaveBeenCalledWith(false)
  })

  it('stays a button while the write is in flight, so keyboard focus is not dropped', () => {
    render(<ReadToggleButton label="Example" isRead={true} onToggle={vi.fn()} isPending />)
    expect(screen.getByRole('button', { name: 'Mark Example as unread' })).toBeDisabled()
  })

  it('cannot fire a second, contradicting write while one is pending', () => {
    const onToggle = vi.fn()
    render(<ReadToggleButton label="Example" isRead={false} onToggle={onToggle} isPending />)
    fireEvent.click(screen.getByRole('button', { name: 'Mark Example as read' }))
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('shows the wording on the labeled variant, for the page that has room for it', () => {
    render(<ReadToggleButton label="Example" isRead={false} onToggle={vi.fn()} variant="labeled" />)
    expect(screen.getByRole('button', { name: /as read/ })).toHaveTextContent('Mark as read')
  })

  it('leaves the icon variant unlabelled on screen but named for a screen reader', () => {
    render(<ReadToggleButton label="Example" isRead={false} onToggle={vi.fn()} />)
    const button = screen.getByRole('button', { name: 'Mark Example as read' })
    expect(button).toHaveTextContent('')
    expect(button).toHaveAttribute('title', 'Mark as read')
  })
})
