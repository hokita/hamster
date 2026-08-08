import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockConnectAuthEmulator = vi.fn()
const mockGetAuth = vi.fn(() => ({}))

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({})),
}))
vi.mock('firebase/auth', () => ({
  getAuth: mockGetAuth,
  connectAuthEmulator: mockConnectAuthEmulator,
}))

describe('firebase emulator wiring', () => {
  beforeEach(() => {
    vi.resetModules()
    mockConnectAuthEmulator.mockClear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('connects to the Auth emulator when VITE_E2E is true', async () => {
    vi.stubEnv('VITE_E2E', 'true')
    await import('./firebase')
    expect(mockConnectAuthEmulator).toHaveBeenCalledWith(
      expect.anything(),
      'http://localhost:9099',
      { disableWarnings: true }
    )
  })

  it('does not connect to the Auth emulator otherwise', async () => {
    vi.stubEnv('VITE_E2E', 'false')
    await import('./firebase')
    expect(mockConnectAuthEmulator).not.toHaveBeenCalled()
  })
})
