const FIRESTORE_EMULATOR_URL = 'http://localhost:8081'
const PROJECT_ID = 'demo-hamster-e2e'

export async function clearFirestore() {
  const res = await fetch(
    `${FIRESTORE_EMULATOR_URL}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' }
  )
  if (!res.ok) {
    throw new Error(`Failed to clear Firestore emulator: ${res.status}`)
  }
}
