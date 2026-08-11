import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { isDisallowedIp } from './ipGuard'

const HTML_CONTENT_TYPE = /^(text\/html|application\/xhtml\+xml)/i
const TITLE_REGEX = /<title[^>]*>([^<]*)<\/title>/i
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

// --- Head-end scanner -------------------------------------------------------------------------
//
// readBoundedBytes (below) needs to know, as bytes stream in, whether the document's <head> has
// genuinely ended — either a real closing `</head>` tag, or the start of a real `<body` tag (the
// same two markers HEAD_END_REGEX used to match directly with a plain regex). "Genuine" excludes
// three regions where a page can legitimately contain that literal text without it meaning the
// head actually ended:
//   - inside an HTML comment (<!-- ... -->)
//   - inside <script>/<style> element content (e.g. document.write("<body>"), a JS template string)
//   - inside a quoted attribute value (e.g. <meta content="... the <body> tag">) — this was the
//     regression: the old masking covered the first two but not this one.
//
// A regex can't express "not inside a quote" without re-deriving tag structure itself, so this is
// a small character-by-character state machine instead. It doubles as a fully general tokenizer of
// "are we currently inside real markup, or inside one of the three regions above" — the exact same
// question NON_MARKUP_MASKS answers for extractIconHref/extractBaseUrl, just answered per-character
// instead of via a final regex pass. It intentionally does NOT replace NON_MARKUP_MASKS: that masks
// script/style/comment content to blank spaces but leaves quoted attribute values completely intact
// (parseAttributes needs the quotes to extract a real href), whereas this scanner also treats quoted
// attribute values as "not real markup" for the narrower purpose of the </head>/<body> check. Making
// NON_MARKUP_MASKS quote-aware in the same way would blank out every href="..." along with it, which
// would break icon extraction — so the two intentionally stay separate.
//
// The scanner is resumable: `HeadScanState` carries `pos` (how far into the accumulated text it has
// already scanned) plus enough in-progress state (current mode, any partially-read tag/attribute
// name) to pick up exactly where it left off when called again with more text appended. Each
// character is visited at most once across the whole read, so scanning the growing buffer stays
// O(total bytes) instead of being re-scanned from the start on every chunk.

type HeadScanMode =
  | 'data' // outside any tag — real markup; '<' here may start a tag
  | 'tagOpen' // just consumed '<', deciding what kind of construct follows
  | 'closeTagOpen' // just consumed '</', expecting a tag name
  | 'bang' // just consumed '<!', deciding whether this is a comment
  | 'bangDash' // just consumed '<!-', need one more '-' to confirm a comment
  | 'comment' // inside <!-- ... -->, watching for '-->'
  | 'commentDash' // inside a comment, just saw one trailing '-'
  | 'commentDashDash' // inside a comment, just saw '--', watching for the closing '>'
  | 'tagName' // accumulating an opening tag's name (to detect <body, <script, <style)
  | 'closeTagName' // accumulating a closing tag's name (to detect </head)
  | 'afterHeadClose' // saw a closing "head" tag name; only whitespace may precede the closing '>'
  | 'tag' // inside a tag, outside any quoted attribute value
  | 'squote' // inside a tag, inside a '...'-quoted attribute value
  | 'dquote' // inside a tag, inside a "..."-quoted attribute value
  | 'rawtext' // inside <script>/<style> element content
  | 'rawtextLt' // inside rawtext content, just saw '<'
  | 'rawtextEndSlash' // inside rawtext content, just saw '</', accumulating the end tag's name

interface HeadScanState {
  mode: HeadScanMode
  pos: number
  name: string // accumulator shared by tagName / closeTagName / rawtextEndSlash
  pendingRawtext: 'script' | 'style' | null // set while inside an opening <script>/<style> tag
  rawtextTag: 'script' | 'style' | null // which element's content we're currently inside
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

// Advances `state` across `text` starting at `state.pos`, mutating it in place. Returns true as
// soon as a genuine end-of-head marker is found (matching state.pos is left where it was — the
// caller is about to stop reading anyway). Returns false once it has consumed all of `text` without
// finding one; `state` is left ready to resume from the same point once more text is appended.
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
          // '<' wasn't followed by a valid tag/comment start, so it wasn't a real tag after all —
          // reprocess this same character as plain data (do not consume it here).
          state.mode = 'data'
        }
        break

      case 'closeTagOpen':
        if (isAsciiLetter(ch)) {
          state.mode = 'closeTagName'
          state.name = ch.toLowerCase()
          state.pos++
        } else {
          state.mode = 'data' // "</" not followed by a letter — not a real closing tag
        }
        break

      case 'bang':
        if (ch === '-') {
          state.mode = 'bangDash'
          state.pos++
        } else {
          state.mode = 'tag' // e.g. <!DOCTYPE ...> — treat as an ordinary tag
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
          state.pos++ // absorb runs of dashes, still watching for the closing '>'
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
          return true // genuine <body\b
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
          return true // genuine </head\s*>
        } else {
          state.mode = 'tag' // e.g. "</headfoo>" — not a real closing head tag after all
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
        } else if (state.name === state.rawtextTag) {
          state.rawtextTag = null
          state.mode = 'tag' // let 'tag' consume the rest of the closing tag up to '>'
        } else {
          state.mode = 'rawtext' // not the matching close tag — just more content
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
  // Built up incrementally (one chunk's worth of latin1 text appended at a time) rather than
  // re-decoding Buffer.concat(chunks) on every iteration, so decoding stays O(total bytes) instead
  // of O(bytes^2) over the read. These markers are ASCII-range markup and decode identically under
  // latin1 regardless of the page's real charset, so this is a safe early-exit check without yet
  // knowing — or mis-decoding non-ASCII bytes with the wrong guess for — the actual encoding, which
  // isn't resolved until the whole (bounded) body has been read.
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
    // Stop at the end of <head> rather than at </title>: <link rel="icon"> commonly follows
    // the title, so exiting at the title would truncate the icon away on most real pages.
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

const BASE_TAG_REGEX = /<base\b[^>]*>/i

// Per the HTML spec, only the first <base href> in a document has effect, so this stops at the
// first match rather than scanning further. Extracted from the masked text (the same masking
// that strips <script>/<style>/comments before icon scanning) so a <base> tag written inside a
// script string can't hijack resolution. The href itself may be relative (e.g. "/assets/"), so
// it's resolved against the fetched page URL first; if there's no <base> tag, or its href is
// missing/unparseable, this just falls back to the page URL, matching prior behavior.
function extractBaseUrl(text: string, pageUrl: string): string {
  const match = BASE_TAG_REGEX.exec(maskNonMarkup(text))
  if (!match) return pageUrl
  const attributes = parseAttributes(match[0])
  if (!attributes.href) return pageUrl
  return resolveHttpUrl(attributes.href, pageUrl) ?? pageUrl
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
    // The document's <base href> (if any) governs relative *link* resolution, but never the
    // origin default above: that's always derived from the fetched page URL itself.
    const baseUrl = extractBaseUrl(text, currentUrl)
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

  return EMPTY_METADATA
}

export async function fetchMetadata(url: string): Promise<PageMetadata> {
  try {
    return await fetchMetadataInner(url, AbortSignal.timeout(FETCH_TIMEOUT_MS))
  } catch {
    return EMPTY_METADATA
  }
}
