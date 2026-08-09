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

  let localId: string | undefined
  try {
    const res = await fetch(
      `${AUTH_EMULATOR_URL}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, returnSecureToken: true }),
      }
    )
    const data = (await res.json()) as { localId?: string }
    localId = data.localId
  } catch {
    // User already exists from a prior run against this emulator session —
    // it was already marked verified the first time, so there's nothing to do.
  }

  if (!localId) return

  // The Auth emulator only honors `emailVerified` in accounts:update when the
  // caller is privileged (Authorization: Bearer owner is the well-known
  // emulator admin token) and identifies the user by `localId`. A plain
  // idToken-authenticated call silently ignores the field.
  await fetch(
    `${AUTH_EMULATOR_URL}/identitytoolkit.googleapis.com/v1/accounts:update?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify({ localId, emailVerified: true }),
    }
  ).catch(() => {})
}
