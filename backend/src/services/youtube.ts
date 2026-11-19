// Videos longer than this are refused (inclusive: exactly 3600 s is allowed).
export const MAX_VIDEO_SECONDS = 3600

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

// Exact matches only: a suffix check would accept youtube.com.evil.test.
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtube-nocookie.com',
])

// Kill switch for the video path. Anything but the exact string 'on' keeps the article path.
export function isYouTubeSummariesEnabled(): boolean {
  return process.env.YOUTUBE_SUMMARIES === 'on'
}

export function canonicalVideoUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`
}

// Returns the video id only for links that point at one video. Channels, playlists and search
// pages return null so they keep the article path. Extra query params (list, si, t) and any path
// after the id (a trailing slash or extra segment, spec §5) are ignored.
export function parseYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) return null
    if (parsed.username || parsed.password || parsed.port) return null
    const host = parsed.hostname.toLowerCase()
    if (!YOUTUBE_HOSTS.has(host)) return null

    let candidate: string | null | undefined
    if (host === 'youtu.be') {
      candidate = parsed.pathname.match(/^\/([^/]+)(?:\/.*)?$/)?.[1]
    } else if (parsed.pathname === '/watch') {
      candidate = parsed.searchParams.get('v')
    } else {
      candidate = parsed.pathname.match(/^\/(?:shorts|live|embed|v)\/([^/]+)(?:\/.*)?$/)?.[1]
    }
    return candidate && VIDEO_ID.test(candidate) ? candidate : null
  } catch {
    return null
  }
}

// The Data API reports length as ISO-8601 (PT17M30S). Returns seconds, or null if malformed.
export function parseIsoDuration(value: string): number | null {
  const match = value.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/)
  // An empty match ("P", "PT") or a dangling "T" carries no duration.
  if (!match || value === 'P' || value.endsWith('T')) return null
  const [days, hours, minutes, seconds] = match.slice(1).map((part) => Number(part ?? 0))
  return days * 86400 + hours * 3600 + minutes * 60 + seconds
}
