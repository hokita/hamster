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

// accounts:signUp fails with EMAIL_EXISTS (no localId in the response) if the
// user already exists from a prior run against this emulator session — that
// user is not guaranteed to already be verified (e.g. it may predate this
// file adding the verification step), so we still need their localId.
async function findExistingLocalId(): Promise<string | undefined> {
  const res = await fetch(
    `${AUTH_EMULATOR_URL}/identitytoolkit.googleapis.com/v1/accounts:lookup?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify({ email: [TEST_EMAIL] }),
    }
  )
  if (!res.ok) return undefined
  const data = (await res.json()) as { users?: { localId: string }[] }
  return data.users?.[0]?.localId
}

export default async function globalSetup() {
  await waitUntilListening(AUTH_EMULATOR_URL)

  const signUpRes = await fetch(
    `${AUTH_EMULATOR_URL}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, returnSecureToken: true }),
    }
  )
  const signUpData = (await signUpRes.json()) as { localId?: string }
  const localId = signUpData.localId ?? (await findExistingLocalId())

  if (!localId) {
    throw new Error(
      `Could not determine the e2e test user's localId — both accounts:signUp and the ` +
        `existing-user lookup failed for ${TEST_EMAIL}`
    )
  }

  // The Auth emulator only honors `emailVerified` in accounts:update when the
  // caller is privileged (Authorization: Bearer owner is the well-known
  // emulator admin token) and identifies the user by `localId`. A plain
  // idToken-authenticated call silently ignores the field.
  const updateRes = await fetch(
    `${AUTH_EMULATOR_URL}/identitytoolkit.googleapis.com/v1/accounts:update?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify({ localId, emailVerified: true }),
    }
  )
  if (!updateRes.ok) {
    throw new Error(`Failed to mark the e2e test user verified: ${updateRes.status}`)
  }
}
