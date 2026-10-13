import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { fetchAllowedUrl } from './safeFetch'

const MAX_FEED_BYTES = 5_000_000
const FETCH_TIMEOUT_MS = 5000

export interface MediumArticle {
  title: string
  html: string
}

// Only Medium-owned URLs qualify. Never derive a feed from an arbitrary site's URL.
function mediumSource(url: string): { feedUrl: string; articleId: string } | null {
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      return null
    }
    const articleId = parsed.pathname.match(/-([a-f0-9]{12})\/?$/i)?.[1].toLowerCase()
    if (!articleId) return null
    if (parsed.hostname === 'medium.com' || parsed.hostname === 'www.medium.com') {
      const author = parsed.pathname.match(/^\/@([\w.-]+)\//)?.[1]
      return author ? { feedUrl: `https://medium.com/feed/@${author}`, articleId } : null
    }
    if (/^[a-z0-9-]+\.medium\.com$/.test(parsed.hostname)) {
      return { feedUrl: `https://${parsed.hostname}/feed`, articleId }
    }
    return null
  } catch {
    return null
  }
}

export async function fetchMediumRssArticle(url: string): Promise<MediumArticle | null> {
  const source = mediumSource(url)
  if (!source) return null
  try {
    // Feeds and every redirect pass through the same SSRF guard as ordinary page fetches.
    const allowed = await fetchAllowedUrl(source.feedUrl, AbortSignal.timeout(FETCH_TIMEOUT_MS))
    if (!allowed || allowed.response.status < 200 || allowed.response.status >= 300) return null
    const reader = allowed.response.body?.getReader()
    if (!reader) return null
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > MAX_FEED_BYTES) return null
        chunks.push(value)
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
    const xml = Buffer.concat(chunks).toString('utf8')
    // No DTDs or custom entities; malformed/truncated feeds cannot supply article content.
    if (/<!DOCTYPE/i.test(xml) || XMLValidator.validate(xml) !== true) return null
    const parser = new XMLParser({
      parseTagValue: false,
      trimValues: false,
      isArray: (_name, path) => path === 'rss.channel.item',
    })
    const items = parser.parse(xml)?.rss?.channel?.item
    if (!Array.isArray(items)) return null
    for (const item of items) {
      if (typeof item.link !== 'string') continue
      if (mediumSource(item.link.trim())?.articleId !== source.articleId) continue
      const title = item.title
      const html = item['content:encoded']
      // Do not substitute the feed's description: it may be only a teaser.
      if (typeof title !== 'string' || !title.trim() || typeof html !== 'string' || !html.trim()) {
        return null
      }
      return { title: title.trim(), html }
    }
    // Medium only includes recent posts; absence is a normal fallback failure.
    return null
  } catch {
    return null
  }
}
