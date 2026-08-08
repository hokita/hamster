const FIRESTORE_EMULATOR_URL = 'http://localhost:8081'
const PROJECT_ID = 'demo-hamster-e2e'

export async function clearFirestore() {
  await fetch(
    `${FIRESTORE_EMULATOR_URL}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' }
  )
}
