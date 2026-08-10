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

// A charset extracted from the HTTP Content-Type header always wins over an in-document
// <meta charset> declaration, matching how browsers resolve the two when both are present.
function resolveCharset(contentType: string, asciiSafeText: string): string | undefined {
  return (
    contentType.match(/charset=["']?([^"';\s]+)/i)?.[1] ??
    asciiSafeText.match(/<meta[^>]+charset=["']?([^"';\s>]+)/i)?.[1]
  )
}

function decodeWithCharset(bytes: Uint8Array, charset: string | undefined): string {
  try {
    return new TextDecoder(charset).decode(bytes)
  } catch {
    return new TextDecoder().decode(bytes)
  }
}

async function readBoundedBytes(response: Response): Promise<Uint8Array> {
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array(0)
  const chunks: Uint8Array[] = []
  let bytesRead = 0
  while (bytesRead < MAX_BYTES) {
    const { done, value } = await reader.read()
    if (done) break
    const remaining = MAX_BYTES - bytesRead
    const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value
    chunks.push(chunk)
    bytesRead += chunk.byteLength
    // ASCII-range markup (a <title> tag) decodes identically under latin1 regardless of
    // the page's real charset, so this is a safe way to check for an early exit without
    // yet knowing — or mis-decoding non-ASCII bytes with the wrong guess for — the actual
    // encoding, which isn't resolved until the whole (bounded) body has been read.
    if (TITLE_REGEX.test(Buffer.concat(chunks).toString('latin1'))) break
  }
  await reader.cancel().catch(() => {})
  return Buffer.concat(chunks)
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

    const bytes = await readBoundedBytes(response)
    const asciiSafeText = Buffer.from(bytes).toString('latin1')
    const charset = resolveCharset(contentType, asciiSafeText)
    const text = decodeWithCharset(bytes, charset)
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
