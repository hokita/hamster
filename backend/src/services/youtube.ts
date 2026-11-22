export const MAX_VIDEO_SECONDS = 3600

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtube-nocookie.com',
])

export function isYouTubeSummariesEnabled(): boolean {
  return process.env.YOUTUBE_SUMMARIES === 'on'
}

export function canonicalVideoUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`
}

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

export function parseIsoDuration(value: string): number | null {
  const match = value.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/)
  if (!match || value === 'P' || value.endsWith('T')) return null
  const [days, hours, minutes, seconds] = match.slice(1).map((part) => Number(part ?? 0))
  return days * 86400 + hours * 3600 + minutes * 60 + seconds
}
