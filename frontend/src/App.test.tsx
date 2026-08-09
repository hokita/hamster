import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

const { mockOnAuthStateChanged } = vi.hoisted(() => ({
  mockOnAuthStateChanged: vi.fn(),
}))

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: mockOnAuthStateChanged,
}))
vi.mock('./firebase', () => ({ auth: {} }))
vi.mock('./pages/LoginPage', () => ({ default: () => <div>login page</div> }))
vi.mock('./pages/BookmarksPage', () => ({ default: () => <div>bookmarks page</div> }))

import App from './App'

describe('App', () => {
  it('renders nothing while auth state is unknown', () => {
    mockOnAuthStateChanged.mockImplementation(() => () => {})
    const { container } = render(<App />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders LoginPage when signed out', () => {
    mockOnAuthStateChanged.mockImplementation((_auth, callback) => {
      callback(null)
      return () => {}
    })
    render(<App />)
    expect(screen.getByText('login page')).toBeInTheDocument()
  })

  it('renders BookmarksPage when signed in', () => {
    mockOnAuthStateChanged.mockImplementation((_auth, callback) => {
      callback({ uid: 'u1' })
      return () => {}
    })
    render(<App />)
    expect(screen.getByText('bookmarks page')).toBeInTheDocument()
  })
})
