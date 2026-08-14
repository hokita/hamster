const FIRESTORE_EMULATOR_URL = 'http://localhost:8081'
const PROJECT_ID = 'demo-hamster-e2e'

// Writes a bookmark straight into the emulator, bypassing the app's own add flow. The e2e
// environment has no GEMINI_API_KEY, so a bookmark added through the UI can never reach the
// "summary present" state — seeding is the only way to exercise what the page does once a
// summary exists. Returns the new document's id so the test can navigate to /bookmarks/<id>.
export async function seedBookmark(fields: {
  url: string
  title: string
  summary: string
}): Promise<string> {
  const res = await fetch(
    `${FIRESTORE_EMULATOR_URL}/v1/projects/${PROJECT_ID}/databases/(default)/documents/bookmarks`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify({
        fields: {
          url: { stringValue: fields.url },
          title: { stringValue: fields.title },
          summary: { stringValue: fields.summary },
          createdAt: { timestampValue: new Date().toISOString() },
        },
      }),
    }
  )
  if (!res.ok) {
    throw new Error(`Failed to seed bookmark: ${res.status}`)
  }
  const { name } = (await res.json()) as { name: string }
  return name.split('/').pop() as string
}

export async function clearFirestore() {
  const res = await fetch(
    `${FIRESTORE_EMULATOR_URL}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' }
  )
  if (!res.ok) {
    throw new Error(`Failed to clear Firestore emulator: ${res.status}`)
  }
}
