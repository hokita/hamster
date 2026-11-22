import { fetchAllowedUrl, isDisallowedHost } from './safeFetch'
import { fetchMediumRssArticle } from './mediumRss'

export const HTML_CONTENT_TYPE = /^(text\/html|application\/xhtml\+xml)/i
const TITLE_REGEX = /<title[^>]*>([^<]*)<\/title>/i
const MAX_BYTES = 100_000
const FETCH_TIMEOUT_MS = 5000

const NON_MARKUP_MASKS: RegExp[] = [
  /<!--[\s\S]*?-->/g,
  /<!--[\s\S]*$/,
  /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,
  /<script\b[^>]*>[\s\S]*$/i,
  /<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,
  /<style\b[^>]*>[\s\S]*$/i,
]

export function maskNonMarkup(text: string): string {
  return NON_MARKUP_MASKS.reduce(
    (masked, pattern) => masked.replace(pattern, (m) => ' '.repeat(m.length)),
    text
  )
}

function decodeNumericEntity(digits: string): string {
  const isHex = digits[0] === 'x' || digits[0] === 'X'
  const codePoint = parseInt(isHex ? digits.slice(1) : digits, isHex ? 16 : 10)
  if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return ''
  try {
    return String.fromCodePoint(codePoint)
  } catch {
    return ''
  }
}

const ENTITY_REGEX = /&amp;|&lt;|&gt;|&quot;|&#39;|&#([xX][0-9a-fA-F]+|[0-9]+);?/g

const NAMED_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
}

export function decodeEntities(text: string): string {
  return text.replace(ENTITY_REGEX, (match, digits: string | undefined) => {
    if (digits !== undefined) return decodeNumericEntity(digits)
    return NAMED_ENTITIES[match]
  })
}

export function resolveCharset(contentType: string, asciiSafeText: string): string | undefined {
  return (
    contentType.match(/charset=["']?([^"';\s]+)/i)?.[1] ??
    asciiSafeText.match(/<meta[^>]+charset=["']?([^"';\s>]+)/i)?.[1]
  )
}

export function decodeWithCharset(bytes: Uint8Array, charset: string | undefined): string {
  try {
    return new TextDecoder(charset).decode(bytes)
  } catch {
    return new TextDecoder().decode(bytes)
  }
}

type HeadScanMode =
  | 'data'
  | 'tagOpen'
  | 'closeTagOpen'
  | 'bang'
  | 'bangDash'
  | 'comment'
  | 'commentDash'
  | 'commentDashDash'
  | 'tagName'
  | 'closeTagName'
  | 'afterHeadClose'
  | 'tag'
  | 'squote'
  | 'dquote'
  | 'rawtext'
  | 'rawtextLt'
  | 'rawtextEndSlash'

interface HeadScanState {
  mode: HeadScanMode
  pos: number
  name: string
  pendingRawtext: 'script' | 'style' | null
  rawtextTag: 'script' | 'style' | null
}

function createHeadScanState(): HeadScanState {
  return { mode: 'data', pos: 0, name: '', pendingRawtext: null, rawtextTag: null }
}

function isAsciiLetter(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')
}

function isWordChar(ch: string): boolean {
  return isAsciiLetter(ch) || (ch >= '0' && ch <= '9') || ch === '_'
}

function isAsciiWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v'
}

function scanForHeadEnd(text: string, state: HeadScanState): boolean {
  const len = text.length
  while (state.pos < len) {
    const ch = text[state.pos]
    switch (state.mode) {
      case 'data':
        state.mode = ch === '<' ? 'tagOpen' : 'data'
        state.pos++
        break

      case 'tagOpen':
        if (ch === '/') {
          state.mode = 'closeTagOpen'
          state.pos++
        } else if (ch === '!') {
          state.mode = 'bang'
          state.pos++
        } else if (isAsciiLetter(ch)) {
          state.mode = 'tagName'
          state.name = ch.toLowerCase()
          state.pos++
        } else {
          state.mode = 'data'
        }
        break

      case 'closeTagOpen':
        if (isAsciiLetter(ch)) {
          state.mode = 'closeTagName'
          state.name = ch.toLowerCase()
          state.pos++
        } else {
          state.mode = 'data'
        }
        break

      case 'bang':
        if (ch === '-') {
          state.mode = 'bangDash'
          state.pos++
        } else {
          state.mode = 'tag'
          state.pendingRawtext = null
        }
        break

      case 'bangDash':
        if (ch === '-') {
          state.mode = 'comment'
          state.pos++
        } else {
          state.mode = 'tag'
          state.pendingRawtext = null
        }
        break

      case 'comment':
        state.mode = ch === '-' ? 'commentDash' : 'comment'
        state.pos++
        break

      case 'commentDash':
        state.mode = ch === '-' ? 'commentDashDash' : 'comment'
        state.pos++
        break

      case 'commentDashDash':
        if (ch === '>') {
          state.mode = 'data'
          state.pos++
        } else if (ch === '-') {
          state.pos++
        } else {
          state.mode = 'comment'
          state.pos++
        }
        break

      case 'tagName':
        if (isWordChar(ch)) {
          state.name += ch.toLowerCase()
          state.pos++
        } else if (state.name === 'body') {
          return true
        } else if (state.name === 'script' || state.name === 'style') {
          state.pendingRawtext = state.name
          state.mode = 'tag'
        } else {
          state.pendingRawtext = null
          state.mode = 'tag'
        }
        break

      case 'closeTagName':
        if (isWordChar(ch)) {
          state.name += ch.toLowerCase()
          state.pos++
        } else if (state.name === 'head') {
          state.mode = 'afterHeadClose'
        } else {
          state.pendingRawtext = null
          state.mode = 'tag'
        }
        break

      case 'afterHeadClose':
        if (isAsciiWhitespace(ch)) {
          state.pos++
        } else if (ch === '>') {
          state.pos++
          return true
        } else {
          state.mode = 'tag'
          state.pendingRawtext = null
        }
        break

      case 'tag':
        if (ch === '"') {
          state.mode = 'dquote'
          state.pos++
        } else if (ch === "'") {
          state.mode = 'squote'
          state.pos++
        } else if (ch === '>') {
          state.pos++
          if (state.pendingRawtext) {
            state.rawtextTag = state.pendingRawtext
            state.pendingRawtext = null
            state.mode = 'rawtext'
          } else {
            state.mode = 'data'
          }
        } else {
          state.pos++
        }
        break

      case 'dquote':
        state.pos++
        if (ch === '"') state.mode = 'tag'
        break

      case 'squote':
        state.pos++
        if (ch === "'") state.mode = 'tag'
        break

      case 'rawtext':
        state.mode = ch === '<' ? 'rawtextLt' : 'rawtext'
        state.pos++
        break

      case 'rawtextLt':
        if (ch === '/') {
          state.mode = 'rawtextEndSlash'
          state.name = ''
          state.pos++
        } else {
          state.mode = 'rawtext'
          state.pos++
        }
        break

      case 'rawtextEndSlash':
        if (isWordChar(ch)) {
          state.name += ch.toLowerCase()
          state.pos++
        } else if (
          state.name === state.rawtextTag &&
          (isAsciiWhitespace(ch) || ch === '/' || ch === '>')
        ) {
          state.rawtextTag = null
          state.mode = 'tag'
        } else {
          state.mode = 'rawtext'
        }
        break
    }
  }
  return false
}

async function readBoundedBytes(response: Response): Promise<Uint8Array> {
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array(0)
  const chunks: Uint8Array[] = []
  let bytesRead = 0
  let bufferedText = ''
  const headScanState = createHeadScanState()
  while (bytesRead < MAX_BYTES) {
    const { done, value } = await reader.read()
    if (done) break
    const remaining = MAX_BYTES - bytesRead
    const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value
    chunks.push(chunk)
    bytesRead += chunk.byteLength
    bufferedText += Buffer.from(chunk).toString('latin1')
    if (scanForHeadEnd(bufferedText, headScanState)) break
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

function resolveHttpUrl(href: string, baseUrl: string): string | null {
  try {
    const resolved = new URL(decodeEntities(href), baseUrl)
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null
    return resolved.toString()
  } catch {
    return null
  }
}

const BASE_TAG_REGEX = /<base\b[^>]*>/gi

function extractBaseUrl(text: string, pageUrl: string): string {
  const maskedText = maskNonMarkup(text)
  for (const match of maskedText.matchAll(BASE_TAG_REGEX)) {
    const attributes = parseAttributes(match[0])
    if (attributes.href) {
      return resolveHttpUrl(attributes.href, pageUrl) ?? pageUrl
    }
  }
  return pageUrl
}

function extractIconHref(text: string, baseUrl: string): string | null {
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
  const allowed = await fetchAllowedUrl(url, signal)
  if (!allowed) return EMPTY_METADATA
  const { response, finalUrl } = allowed

  const originFavicon = new URL('/favicon.ico', finalUrl).toString()

  if (response.status < 200 || response.status >= 300) {
    await response.body?.cancel().catch(() => {})
    return { title: null, faviconUrl: originFavicon }
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!HTML_CONTENT_TYPE.test(contentType)) return { title: null, faviconUrl: originFavicon }

  const bytes = await readBoundedBytes(response)
  const asciiSafeText = Buffer.from(bytes).toString('latin1')
  const charset = resolveCharset(contentType, asciiSafeText)
  const text = decodeWithCharset(bytes, charset)

  const baseUrl = extractBaseUrl(text, finalUrl)
  const iconCandidate = extractIconHref(text, baseUrl)
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

export async function fetchMetadata(url: string): Promise<PageMetadata> {
  const metadata = await fetchMetadataInner(url, AbortSignal.timeout(FETCH_TIMEOUT_MS)).catch(
    () => EMPTY_METADATA
  )
  if (metadata.title) return metadata
  const article = await fetchMediumRssArticle(url)
  return article ? { ...metadata, title: article.title } : metadata
}
