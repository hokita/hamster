import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockSignInWithPopup, mockSignInWithEmailAndPassword } = vi.hoisted(() => ({
  mockSignInWithPopup: vi.fn().mockResolvedValue(undefined),
  mockSignInWithEmailAndPassword: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: vi.fn(),
  signInWithPopup: mockSignInWithPopup,
  signInWithEmailAndPassword: mockSignInWithEmailAndPassword,
}))
vi.mock('../firebase', () => ({ auth: {} }))

import LoginPage from './LoginPage'

describe('LoginPage', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.unstubAllEnvs())

  it('signs in with the real Google popup by default', async () => {
    render(<LoginPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }))
    await waitFor(() => expect(mockSignInWithPopup).toHaveBeenCalled())
    expect(mockSignInWithEmailAndPassword).not.toHaveBeenCalled()
  })

  it('signs in against the Auth emulator with a fixed test user in e2e mode', async () => {
    vi.stubEnv('VITE_E2E', 'true')
    vi.stubEnv('VITE_E2E_TEST_EMAIL', 'e2e@example.com')
    vi.stubEnv('VITE_E2E_TEST_PASSWORD', 'e2e-test-password-123')

    render(<LoginPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }))
    await waitFor(() =>
      expect(mockSignInWithEmailAndPassword).toHaveBeenCalledWith(
        {},
        'e2e@example.com',
        'e2e-test-password-123'
      )
    )
    expect(mockSignInWithPopup).not.toHaveBeenCalled()
  })
})
