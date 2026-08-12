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

// Tag stripping is a single left-to-right pass rather than a regex. A regex that is quote-aware
// (so a '>' inside title="a > b" doesn't end the tag early) necessarily backtracks when a quote or
// a '>' never arrives, which is O(n^2) over the up-to-300KB of untrusted HTML this reads — a
// hostile page could stall the event loop for seconds. This visits each character once instead.
function stripTags(html: string): string {
  let out = ''
  let index = 0
  while (index < html.length) {
    const tagStart = html.indexOf('<', index)
    if (tagStart === -1) {
      out += html.slice(index)
      break
    }
    out += html.slice(index, tagStart)
    out += ' '

    let scan = tagStart + 1
    let quote: string | null = null
    while (scan < html.length) {
      const char = html[scan]
      if (quote) {
        if (char === quote) quote = null
      } else if (char === '"' || char === "'") {
        quote = char
      } else if (char === '>') {
        break
      }
      scan++
    }
    // An unterminated tag can only be the tail of a page truncated at MAX_BYTES (or a malformed
    // one); there is no complete markup left to extract, so the remainder is dropped.
    if (scan >= html.length) break
    index = scan + 1
  }
  return out
}

// Deliberately not a readability engine: leftover nav and footer text costs a few tokens and the
// model ignores it, which is a far better trade than taking on a content-extraction dependency.
function extractText(html: string): string {
  return decodeEntities(stripTags(maskNonMarkup(html)))
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
