import { fetchAllowedUrl } from './safeFetch'
import { canonicalVideoUrl } from './youtube'

export const YOUTUBE_FAVICON_URL = 'https://www.youtube.com/favicon.ico'

const OEMBED_ENDPOINT = 'https://www.youtube.com/oembed'
const FETCH_TIMEOUT_MS = 5000
// An oEmbed reply is a few hundred bytes; anything near this cap is not one.
const MAX_BYTES = 64 * 1024
const MAX_TITLE_CHARS = 300

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

// oEmbed is the supported way to get a video's title without scraping the watch page. Any failure
// returns null and the caller falls back to the ordinary metadata fetch.
export async function fetchYouTubeTitle(videoId: string): Promise<string | null> {
  try {
    const url = `${OEMBED_ENDPOINT}?url=${encodeURIComponent(canonicalVideoUrl(videoId))}&format=json`
    const result = await fetchAllowedUrl(url, AbortSignal.timeout(FETCH_TIMEOUT_MS))
    if (!result) return null
    const { response } = result
    if (!response.ok) return null
    if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('json')) return null

    const text = await readBoundedText(response)
    if (text === null) return null
    const title = (JSON.parse(text) as { title?: unknown }).title
    if (typeof title !== 'string') return null
    const cleaned = title.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_CHARS)
    return cleaned || null
  } catch {
    return null
  }
}
