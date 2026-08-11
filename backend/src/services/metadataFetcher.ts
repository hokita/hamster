import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { isDisallowedIp } from './ipGuard'

const HTML_CONTENT_TYPE = /^(text\/html|application\/xhtml\+xml)/i
const TITLE_REGEX = /<title[^>]*>([^<]*)<\/title>/i
const HEAD_END_REGEX = /<\/head\s*>|<body\b/i
const MAX_REDIRECTS = 3
const MAX_BYTES = 100_000
const FETCH_TIMEOUT_MS = 5000

// Regions whose text content must not be scanned as real markup: a hostile or merely careless
// page can write "<body", "</head>", or even a fake "<link rel=icon>" as plain text inside a
// <script>/<style> block (e.g. document.write("<body>"), or a JS string literal containing an
// HTML template) or an HTML comment. Used both to keep the end-of-head check below from firing on
// non-markup text, and to keep extractIconHref from picking up a fake <link> that isn't real
// markup. Complete blocks are masked first; a trailing "unterminated" variant handles a block
// whose closing tag hasn't arrived yet in the accumulated buffer (masking to end-of-buffer is
// intentionally conservative — it can only delay the head-end early exit or hide a not-yet-
// complete icon candidate, never fabricate a match, since MAX_BYTES still bounds the read
// independently).
const NON_MARKUP_MASKS: RegExp[] = [
  /<!--[\s\S]*?-->/g,
  /<!--[\s\S]*$/,
  /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,
  /<script\b[^>]*>[\s\S]*$/i,
  /<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,
  /<style\b[^>]*>[\s\S]*$/i,
]

function maskNonMarkup(text: string): string {
  return NON_MARKUP_MASKS.reduce(
    (masked, pattern) => masked.replace(pattern, (m) => ' '.repeat(m.length)),
    text
  )
}

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
    // Stop at the end of <head> rather than at </title>: <link rel="icon"> commonly follows
    // the title, so exiting at the title would truncate the icon away on most real pages.
    // These markers are ASCII-range markup and decode identically under latin1 regardless of
    // the page's real charset, so this is a safe early-exit check without yet knowing — or
    // mis-decoding non-ASCII bytes with the wrong guess for — the actual encoding, which
    // isn't resolved until the whole (bounded) body has been read.
    const bufferedText = Buffer.concat(chunks).toString('latin1')
    if (HEAD_END_REGEX.test(maskNonMarkup(bufferedText))) break
  }
  await reader.cancel().catch(() => {})
  return Buffer.concat(chunks)
}

export interface PageMetadata {
  title: string | null
  faviconUrl: string | null
}

const EMPTY_METADATA: PageMetadata = { title: null, faviconUrl: null }

function extractTitle(text: string): string | null {
  const match = TITLE_REGEX.exec(text)
  if (!match) return null
  return decodeEntities(match[1]).replace(/\s+/g, ' ').trim() || null
}

const LINK_TAG_REGEX = /<link\b[^>]*>/gi
const ATTR_REGEX = /([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g

function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  for (const match of tag.matchAll(ATTR_REGEX)) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? ''
  }
  return attributes
}

// The browser — not this server — loads whatever ends up here, so ipGuard never sees it.
// Restricting to http(s) is what keeps a hostile page from steering an <img src> elsewhere.
function resolveHttpUrl(href: string, baseUrl: string): string | null {
  try {
    const resolved = new URL(decodeEntities(href), baseUrl)
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null
    return resolved.toString()
  } catch {
    return null
  }
}

function extractIconHref(text: string, baseUrl: string): string | null {
  // Mask <script>/<style> contents and HTML comments before scanning: inline script text
  // (e.g. a JS string literal holding an HTML template) or a commented-out <link> is not real
  // markup and must not be treated as a candidate icon — see NON_MARKUP_MASKS above.
  const maskedText = maskNonMarkup(text)
  let appleTouchIcon: string | null = null

  for (const match of maskedText.matchAll(LINK_TAG_REGEX)) {
    const attributes = parseAttributes(match[0])
    if (!attributes.href) continue
    const relTokens = (attributes.rel ?? '').toLowerCase().split(/\s+/)

    if (relTokens.includes('icon')) {
      const resolved = resolveHttpUrl(attributes.href, baseUrl)
      if (resolved) return resolved
    } else if (relTokens.includes('apple-touch-icon') && !appleTouchIcon) {
      appleTouchIcon = resolveHttpUrl(attributes.href, baseUrl)
    }
  }

  return appleTouchIcon
}

async function fetchMetadataInner(url: string, signal: AbortSignal): Promise<PageMetadata> {
  let currentUrl = url

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = new URL(currentUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return EMPTY_METADATA
    if (await isDisallowedHost(parsed.hostname, signal)) return EMPTY_METADATA

    const response = await fetch(currentUrl, { redirect: 'manual', signal })

    if (response.status >= 300 && response.status < 400) {
      if (hop === MAX_REDIRECTS) return EMPTY_METADATA
      const location = response.headers.get('location')
      if (!location) return EMPTY_METADATA
      currentUrl = new URL(location, currentUrl).toString()
      continue
    }

    // Past this point the final URL is known and its host passed the SSRF guard, so an
    // origin favicon is always a usable answer even when the body is unparseable.
    const originFavicon = new URL('/favicon.ico', currentUrl).toString()

    const contentType = response.headers.get('content-type') ?? ''
    if (!HTML_CONTENT_TYPE.test(contentType)) return { title: null, faviconUrl: originFavicon }

    const bytes = await readBoundedBytes(response)
    const asciiSafeText = Buffer.from(bytes).toString('latin1')
    const charset = resolveCharset(contentType, asciiSafeText)
    const text = decodeWithCharset(bytes, charset)

    // extractIconHref already picks the single best candidate (icon over apple-touch-icon,
    // first-icon-wins); only that final candidate's host is guard-checked here — if it's
    // disallowed we fall back to the origin default rather than walking to another <link>.
    // The origin default itself is never re-checked: its host already passed the guard at
    // the top of this loop iteration, and a redundant DNS lookup would just be wasted work.
    // Note: this only guards what this server does with the href server-side (it never
    // fetches it) — the browser resolves and loads the chosen URL independently later, so
    // DNS-rebinding between this check and the browser's own load isn't (and can't be) closed
    // here, same caveat as isDisallowedHost above.
    const iconCandidate = extractIconHref(text, currentUrl)
    let faviconUrl = originFavicon
    if (iconCandidate) {
      const iconHost = new URL(iconCandidate).hostname
      if (!(await isDisallowedHost(iconHost, signal))) {
        faviconUrl = iconCandidate
      }
    }

    return {
      title: extractTitle(text),
      faviconUrl,
    }
  }

  return EMPTY_METADATA
}

export async function fetchMetadata(url: string): Promise<PageMetadata> {
  try {
    return await fetchMetadataInner(url, AbortSignal.timeout(FETCH_TIMEOUT_MS))
  } catch {
    return EMPTY_METADATA
  }
}
