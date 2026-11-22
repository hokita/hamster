const FIRESTORE_EMULATOR_URL = 'http://localhost:8081'
const PROJECT_ID = 'demo-hamster-e2e'

export async function seedBookmark(fields: {
  url: string
  title: string
  summary?: string
  shortSummary?: string
  videoSummaryState?: { status: string; code?: string; updatedAt: string }
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
          ...(fields.summary !== undefined ? { summary: { stringValue: fields.summary } } : {}),
          ...(fields.shortSummary ? { shortSummary: { stringValue: fields.shortSummary } } : {}),
          ...(fields.videoSummaryState
            ? {
                videoSummaryState: {
                  mapValue: {
                    fields: {
                      status: { stringValue: fields.videoSummaryState.status },
                      ...(fields.videoSummaryState.code
                        ? { code: { stringValue: fields.videoSummaryState.code } }
                        : {}),
                      updatedAt: { timestampValue: fields.videoSummaryState.updatedAt },
                    },
                  },
                },
              }
            : {}),
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
