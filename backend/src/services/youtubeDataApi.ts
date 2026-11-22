import { fetchAllowedUrl } from './safeFetch'
import { parseIsoDuration, MAX_VIDEO_SECONDS } from './youtube'

const VIDEOS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/videos'
const FETCH_TIMEOUT_MS = 5000
const MAX_BYTES = 256 * 1024

export type VideoCheck =
  | { kind: 'ok'; durationSeconds: number; title: string | null }
  | { kind: 'too_long'; durationSeconds: number }
  | { kind: 'unavailable' }
  | { kind: 'live' }
  | { kind: 'unknown' }

interface VideoItem {
  contentDetails?: { duration?: unknown }
  status?: { privacyStatus?: unknown }
  snippet?: { title?: unknown; liveBroadcastContent?: unknown }
}

async function readBoundedText(response: Response): Promise<string | null> {
  const reader = response.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let bytesRead = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done || !value) break
      bytesRead += value.byteLength
      if (bytesRead > MAX_BYTES) return null
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return Buffer.concat(chunks).toString('utf8')
}

function classify(item: VideoItem): VideoCheck {
  const privacy = item.status?.privacyStatus
  if (privacy === 'private' || privacy === 'unlisted') return { kind: 'unavailable' }

  const live = item.snippet?.liveBroadcastContent
  if (live === 'live' || live === 'upcoming') return { kind: 'live' }

  const duration = item.contentDetails?.duration
  const durationSeconds = typeof duration === 'string' ? parseIsoDuration(duration) : null
  if (!durationSeconds) return { kind: 'unknown' }
  if (durationSeconds > MAX_VIDEO_SECONDS) return { kind: 'too_long', durationSeconds }

  const rawTitle = item.snippet?.title
  const title = typeof rawTitle === 'string' ? rawTitle.trim() : ''
  return { kind: 'ok', durationSeconds, title: title || null }
}

export async function checkVideo(videoId: string): Promise<VideoCheck> {
  const key = process.env.YOUTUBE_API_KEY
  if (!key) return { kind: 'unknown' }

  try {
    const url = `${VIDEOS_ENDPOINT}?part=contentDetails,status,snippet&id=${encodeURIComponent(videoId)}`
    const result = await fetchAllowedUrl(url, AbortSignal.timeout(FETCH_TIMEOUT_MS), {
      'X-Goog-Api-Key': key,
    })
    if (!result || !result.response.ok) return { kind: 'unknown' }

    const text = await readBoundedText(result.response)
    if (text === null) return { kind: 'unknown' }
    const items = (JSON.parse(text) as { items?: unknown }).items
    if (!Array.isArray(items)) return { kind: 'unknown' }
    if (items.length === 0) return { kind: 'unavailable' }
    return classify(items[0] as VideoItem)
  } catch (err) {
    console.error(
      'youtube data api check failed',
      videoId,
      err instanceof Error ? err.name : 'error'
    )
    return { kind: 'unknown' }
  }
}
