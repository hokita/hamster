import { lookup } from 'node:dns/promises'
import { isDisallowedIp } from './ipGuard'

const HTML_CONTENT_TYPE = /^(text\/html|application\/xhtml\+xml)/i
const TITLE_REGEX = /<title[^>]*>([^<]*)<\/title>/i

async function isDisallowedHost(hostname: string): Promise<boolean> {
  try {
    const { address, family } = await lookup(hostname)
    return isDisallowedIp(address, family)
  } catch {
    return true
  }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

export async function fetchTitle(url: string): Promise<string | null> {
  const parsed = new URL(url)
  if (await isDisallowedHost(parsed.hostname)) return null

  const response = await fetch(url, { redirect: 'manual' })

  const contentType = response.headers.get('content-type') ?? ''
  if (!HTML_CONTENT_TYPE.test(contentType)) return null

  const text = await response.text()
  const match = TITLE_REGEX.exec(text)
  if (!match) return null

  const title = decodeEntities(match[1]).replace(/\s+/g, ' ').trim()
  return title || null
}
