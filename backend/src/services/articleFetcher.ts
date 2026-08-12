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
// abortedAt is the index of the '<' that began an unterminated tag, or null on a clean finish.
//
// Per the HTML spec, a quote character only opens an attribute value when it is the first
// non-whitespace character after '='. Treating every quote in a tag as an opener — no matter where
// it appears — is wrong: an unescaped apostrophe inside a single-quoted value (e.g. title='it's a
// test') would then get "closed" by the next unrelated apostrophe in the page's real prose, and
// everything in between is swallowed as tag content.
function stripTags(html: string, quoteAware: boolean): { text: string; abortedAt: number | null } {
  let out = ''
  let index = 0
  while (index < html.length) {
    const tagStart = html.indexOf('<', index)
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

// Deliberately not a readability engine: leftover nav and footer text costs a few tokens and the
// model ignores it, which is a far better trade than taking on a content-extraction dependency.
function extractText(html: string): string {
  const masked = maskNonMarkup(html)
  const first = stripTags(masked, true)
  // A tag whose quoted attribute value never closes swallows everything after it — what the HTML
  // spec's tokenizer does, but not what we want: an article with one unescaped quote would summarize
  // down to its first paragraph. Recover the tail with a quote-blind pass, which ends each tag at its
  // first '>'. Only the tail is reprocessed: the quote-aware parse before the abort point is correct
  // and must not be thrown away, or a page merely truncated at MAX_BYTES would lose it.
  const text =
    first.abortedAt === null
      ? first.text
      : first.text + stripTags(masked.slice(first.abortedAt), false).text
  return decodeEntities(text)
    .replace(/\s+/g, ' ')
    .trim()
}

export async function fetchArticleText(url: string): Promise<string | null> {
  try {
    const allowed = await fetchAllowedUrl(url, AbortSignal.timeout(FETCH_TIMEOUT_MS))
    if (!allowed) return null

    // fetchAllowedUrl already chased 3xx redirects, so anything left outside 2xx is a served error
    // page (404, 500, 403, ...) rendered as ordinary HTML. That page's text is not article content —
    // extracting and summarizing it would silently present the site's error page as the bookmark.
    if (allowed.response.status < 200 || allowed.response.status >= 300) return null

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
