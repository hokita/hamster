import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { isDisallowedIp } from './ipGuard'

const HTML_CONTENT_TYPE = /^(text\/html|application\/xhtml\+xml)/i
const TITLE_REGEX = /<title[^>]*>([^<]*)<\/title>/i
const MAX_REDIRECTS = 3
const MAX_BYTES = 100_000
const FETCH_TIMEOUT_MS = 5000

export function withSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

async function isDisallowedHost(hostname: string, signal: AbortSignal): Promise<boolean> {
  // URL.hostname brackets IPv6 literals (e.g. "[::1]"); dns.lookup() rejects that form,
  // so literal IPs are checked directly instead of going through DNS at all.
  const literal =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  const literalFamily = isIP(literal)
  if (literalFamily) return isDisallowedIp(literal, literalFamily)

  try {
    const { address, family } = await withSignal(lookup(hostname), signal)
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

async function readBoundedText(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder()
  let text = ''
  let bytesRead = 0
  while (bytesRead < MAX_BYTES) {
    const { done, value } = await reader.read()
    if (done) break
    bytesRead += value.byteLength
    text += decoder.decode(value, { stream: true })
    if (TITLE_REGEX.test(text)) break
  }
  await reader.cancel().catch(() => {})
  return text
}

async function fetchTitleInner(url: string, signal: AbortSignal): Promise<string | null> {
  let currentUrl = url

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = new URL(currentUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    if (await isDisallowedHost(parsed.hostname, signal)) return null

    const response = await fetch(currentUrl, { redirect: 'manual', signal })

    if (response.status >= 300 && response.status < 400) {
      if (hop === MAX_REDIRECTS) return null
      const location = response.headers.get('location')
      if (!location) return null
      currentUrl = new URL(location, currentUrl).toString()
      continue
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (!HTML_CONTENT_TYPE.test(contentType)) return null

    const text = await readBoundedText(response)
    const match = TITLE_REGEX.exec(text)
    if (!match) return null

    const title = decodeEntities(match[1]).replace(/\s+/g, ' ').trim()
    return title || null
  }

  return null
}

export async function fetchTitle(url: string): Promise<string | null> {
  try {
    return await fetchTitleInner(url, AbortSignal.timeout(FETCH_TIMEOUT_MS))
  } catch {
    return null
  }
}
