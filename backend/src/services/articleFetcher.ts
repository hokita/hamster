import { fetchAllowedUrl } from './safeFetch'
import { fetchMediumRssArticle } from './mediumRss'
import {
  HTML_CONTENT_TYPE,
  maskNonMarkup,
  decodeEntities,
  resolveCharset,
  decodeWithCharset,
} from './metadataFetcher'

const MAX_BYTES = 1_500_000
const MAX_CHARS = 200_000
const FETCH_TIMEOUT_MS = 8000

async function readBoundedBytes(response: Response): Promise<Uint8Array> {
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array(0)
  const chunks: Uint8Array[] = []
  let bytesRead = 0
  while (bytesRead < MAX_BYTES) {
    let result: { done: boolean; value?: Uint8Array }
    try {
      result = await reader.read()
    } catch {
      break
    }
    if (result.done || !result.value) break
    const value = result.value
    const remaining = MAX_BYTES - bytesRead
    const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value
    chunks.push(chunk)
    bytesRead += chunk.byteLength
  }
  await reader.cancel().catch(() => {})
  return Buffer.concat(chunks)
}

function opensTag(html: string, index: number): boolean {
  const next = html[index + 1]
  return (
    next !== undefined && (/[a-zA-Z]/.test(next) || next === '/' || next === '!' || next === '?')
  )
}

function stripTags(html: string, quoteAware: boolean): { text: string; abortedAt: number | null } {
  let out = ''
  let index = 0
  while (index < html.length) {
    let searchFrom = index
    let tagStart = -1
    while (searchFrom < html.length) {
      const candidate = html.indexOf('<', searchFrom)
      if (candidate === -1) break
      if (opensTag(html, candidate)) {
        tagStart = candidate
        break
      }
      searchFrom = candidate + 1
    }
    if (tagStart === -1) {
      out += html.slice(index)
      return { text: out, abortedAt: null }
    }
    out += html.slice(index, tagStart)
    out += ' '

    let scan = tagStart + 1
    let quote: string | null = null
    let afterEquals = false
    while (scan < html.length) {
      const char = html[scan]
      if (quote) {
        if (char === quote) quote = null
      } else if (char === '>') {
        break
      } else if (quoteAware && afterEquals && (char === '"' || char === "'")) {
        quote = char
        afterEquals = false
      } else if (char === '=') {
        afterEquals = true
      } else if (!/\s/.test(char)) {
        afterEquals = false
      }
      scan++
    }
    if (scan >= html.length) return { text: out, abortedAt: tagStart }
    index = scan + 1
  }
  return { text: out, abortedAt: null }
}

function extractText(html: string): string {
  const masked = maskNonMarkup(html)
  const first = stripTags(masked, true)
  const text =
    first.abortedAt === null
      ? first.text
      : first.text + stripTags(masked.slice(first.abortedAt), false).text
  return decodeEntities(text).replace(/\s+/g, ' ').trim()
}

async function fetchOriginalArticleText(url: string): Promise<string | null> {
  try {
    const allowed = await fetchAllowedUrl(url, AbortSignal.timeout(FETCH_TIMEOUT_MS))
    if (!allowed) return null

    if (allowed.response.status < 200 || allowed.response.status >= 300) {
      await allowed.response.body?.cancel().catch(() => {})
      return null
    }

    const contentType = allowed.response.headers.get('content-type') ?? ''
    if (!HTML_CONTENT_TYPE.test(contentType)) return null

    const bytes = await readBoundedBytes(allowed.response)
    const asciiSafeText = Buffer.from(bytes).toString('latin1')
    const charset = resolveCharset(contentType, asciiSafeText)
    const text = extractText(decodeWithCharset(bytes, charset))

    return text ? text.slice(0, MAX_CHARS) : null
  } catch {
    return null
  }
}

export async function fetchArticleText(url: string): Promise<string | null> {
  const original = await fetchOriginalArticleText(url)
  if (original) return original
  const article = await fetchMediumRssArticle(url)
  if (!article) return null
  const text = extractText(article.html)
  return text ? text.slice(0, MAX_CHARS) : null
}
