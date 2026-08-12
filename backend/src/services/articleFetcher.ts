import { fetchAllowedUrl } from './safeFetch'
import {
  HTML_CONTENT_TYPE,
  maskNonMarkup,
  decodeEntities,
  resolveCharset,
  decodeWithCharset,
} from './metadataFetcher'

// The whole page body is read here, not just the head, so the bound is larger than
// metadataFetcher's — but still bounded: a runaway response must not be able to exhaust memory.
const MAX_BYTES = 300_000
// Matches eagle's maxPromptChars. Well past the length of any article worth summarizing, and
// short enough to keep one request's token cost predictable.
const MAX_CHARS = 20_000
const FETCH_TIMEOUT_MS = 8000

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
  }
  await reader.cancel().catch(() => {})
  return Buffer.concat(chunks)
}

// quoteAware=false ends every tag at its first '>', ignoring quotes entirely. Both modes visit each
// character at most once, so both are O(n) — see extractText for why the second mode exists.
function stripTags(html: string, quoteAware: boolean): { text: string; aborted: boolean } {
  let out = ''
  let index = 0
  while (index < html.length) {
    const tagStart = html.indexOf('<', index)
    if (tagStart === -1) {
      out += html.slice(index)
      return { text: out, aborted: false }
    }
    out += html.slice(index, tagStart)
    out += ' '

    let scan = tagStart + 1
    let quote: string | null = null
    while (scan < html.length) {
      const char = html[scan]
      if (quoteAware && quote) {
        if (char === quote) quote = null
      } else if (quoteAware && (char === '"' || char === "'")) {
        quote = char
      } else if (char === '>') {
        break
      }
      scan++
    }
    if (scan >= html.length) return { text: out, aborted: true }
    index = scan + 1
  }
  return { text: out, aborted: false }
}

// Deliberately not a readability engine: leftover nav and footer text costs a few tokens and the
// model ignores it, which is a far better trade than taking on a content-extraction dependency.
function extractText(html: string): string {
  const masked = maskNonMarkup(html)
  // A tag whose quoted attribute value never closes swallows everything after it — exactly what the
  // HTML spec's tokenizer does, but not what we want: an article with one unescaped quote in an ad
  // tag would summarize down to its first paragraph. Retry quote-blind, which ends each tag at its
  // first '>'. That can leak an attribute fragment on a malformed page; losing the article is worse.
  let stripped = stripTags(masked, true)
  if (stripped.aborted) stripped = stripTags(masked, false)
  return decodeEntities(stripped.text)
    .replace(/\s+/g, ' ')
    .trim()
}

export async function fetchArticleText(url: string): Promise<string | null> {
  try {
    const allowed = await fetchAllowedUrl(url, AbortSignal.timeout(FETCH_TIMEOUT_MS))
    if (!allowed) return null

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
