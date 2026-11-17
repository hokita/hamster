import { fetchAllowedUrl } from './safeFetch'
import { parseIsoDuration, MAX_VIDEO_SECONDS } from './youtube'

const VIDEOS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/videos'
const FETCH_TIMEOUT_MS = 5000
// A single-video reply is a few KB; anything near this cap is not one.
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

// Reads at most MAX_BYTES. Returns null when the body is larger: a truncated JSON document would
// not parse anyway, so there is nothing useful to salvage.
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
  // Private and unlisted videos can't be watched by Gemini's public-URL access.
  const privacy = item.status?.privacyStatus
  if (privacy === 'private' || privacy === 'unlisted') return { kind: 'unavailable' }

  // Live and upcoming streams report a zero/absent duration, so this must come before the
  // duration check or they would be misreported as an unknown length.
  const live = item.snippet?.liveBroadcastContent
  if (live === 'live' || live === 'upcoming') return { kind: 'live' }

  const duration = item.contentDetails?.duration
  const durationSeconds = typeof duration === 'string' ? parseIsoDuration(duration) : null
  // A zero duration on a non-live video means the length is not actually known.
  if (!durationSeconds) return { kind: 'unknown' }
  if (durationSeconds > MAX_VIDEO_SECONDS) return { kind: 'too_long', durationSeconds }

  const rawTitle = item.snippet?.title
  const title = typeof rawTitle === 'string' ? rawTitle.trim() : ''
  return { kind: 'ok', durationSeconds, title: title || null }
}

// Checks length and availability before we spend a Gemini call. Any failure is `unknown` so the
// caller can refuse rather than guess. The key goes in a header (never the URL, which ends up in
// logs) and nothing here logs error messages, since they can carry URLs or headers.
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
