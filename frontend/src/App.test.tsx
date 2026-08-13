import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockOnAuthStateChanged } = vi.hoisted(() => ({
  mockOnAuthStateChanged: vi.fn(),
}))

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: mockOnAuthStateChanged,
}))
vi.mock('./firebase', () => ({ auth: {} }))
vi.mock('./pages/LoginPage', () => ({ default: () => <div>login page</div> }))
vi.mock('./pages/BookmarksPage', () => ({ default: () => <div>bookmarks page</div> }))
vi.mock('./pages/BookmarkPage', () => ({ default: () => <div>bookmark page</div> }))

import App from './App'

describe('App', () => {
  beforeEach(() => window.history.pushState({}, '', '/'))

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

  it('renders BookmarkPage at /bookmarks/:id when signed in', () => {
    mockOnAuthStateChanged.mockImplementation((_auth, callback) => {
      callback({ uid: 'u1' })
      return () => {}
    })
    window.history.pushState({}, '', '/bookmarks/abc123')
    render(<App />)
    expect(screen.getByText('bookmark page')).toBeInTheDocument()
  })

  it('redirects an unknown path to the bookmark list', () => {
    mockOnAuthStateChanged.mockImplementation((_auth, callback) => {
      callback({ uid: 'u1' })
      return () => {}
    })
    window.history.pushState({}, '', '/nonsense')
    render(<App />)
    expect(screen.getByText('bookmarks page')).toBeInTheDocument()
  })

  it('shows the login page for a deep link when signed out', () => {
    mockOnAuthStateChanged.mockImplementation((_auth, callback) => {
      callback(null)
      return () => {}
    })
    window.history.pushState({}, '', '/bookmarks/abc123')
    render(<App />)
    expect(screen.getByText('login page')).toBeInTheDocument()
  })
})
