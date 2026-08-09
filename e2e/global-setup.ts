import { AUTH_EMULATOR_URL, TEST_EMAIL, TEST_PASSWORD } from './fixtures/auth'

async function waitUntilListening(url: string, attempts = 20, delayMs = 500) {
  for (let i = 0; i < attempts; i++) {
    try {
      await fetch(url)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  throw new Error(`Timed out waiting for ${url} to accept connections`)
}

export default async function globalSetup() {
  await waitUntilListening(AUTH_EMULATOR_URL)

  await fetch(
    `${AUTH_EMULATOR_URL}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, returnSecureToken: true }),
    }
  ).catch(() => {})
}
