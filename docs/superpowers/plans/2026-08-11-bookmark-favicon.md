# Bookmark Favicon Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each bookmarked site's favicon in the bookmark list, discovered during the server-side fetch that already retrieves the page title.

**Architecture:** `titleFetcher.ts` is renamed to `metadataFetcher.ts` and returns `{ title, faviconUrl }` from a single fetch and parse. The favicon URL (not the image bytes) is stored on the Firestore document; the browser loads the image. When no icon is stored, the frontend derives `origin + /favicon.ico` from the bookmark's own URL, so bookmarks created before this feature get icons with no migration. Any missing or broken icon falls back to today's generic link glyph.

**Tech Stack:** TypeScript, Node 24 native `fetch`/`URL`, Express, Firebase Admin (Firestore), React 19, Vitest, Testing Library.

## Global Constraints

- No new dependencies. Native `fetch`, `URL`, and the existing `ipGuard` are sufficient; no HTML parser library.
- No image bytes are stored or proxied — only a URL string.
- No third-party favicon service.
- Firestore rejects `undefined`: never write `faviconUrl: undefined`. Omit the key entirely.
- `listBookmarks` must never skip a document for lacking `faviconUrl` — every pre-existing document lacks it.
- Only `http:` and `https:` URLs may ever be stored in `faviconUrl`.
- Run backend tests from `backend/`, frontend tests from `frontend/`, both with `npm test`. The working directory does not carry between separate shell invocations — always `cd` explicitly.
- Baseline before this plan: backend 51 tests passing, frontend 46 tests passing.

---

### Task 1: `fetchMetadata` returning title + origin-default favicon

Renames the module and widens its return type. The declared `<link rel="icon">` is **not** parsed yet — this task establishes the `origin + /favicon.ico` default and the failure semantics.

**Files:**
- Rename: `backend/src/services/titleFetcher.ts` → `backend/src/services/metadataFetcher.ts`
- Rename: `backend/src/services/titleFetcher.test.ts` → `backend/src/services/metadataFetcher.test.ts`
- Modify: `backend/src/routes/bookmarks.ts`
- Modify: `backend/src/routes/bookmarks.test.ts`

**Interfaces:**
- Produces: `export interface PageMetadata { title: string | null; faviconUrl: string | null }` and `export async function fetchMetadata(url: string): Promise<PageMetadata>`. `withSignal` keeps its current exported signature.

- [ ] **Step 1: Rename both files with git so history follows**

```bash
cd /Users/hokita/ghq/github.com/hokita/hamster/.claude/worktrees/bookmark-favicon
git mv backend/src/services/titleFetcher.ts backend/src/services/metadataFetcher.ts
git mv backend/src/services/titleFetcher.test.ts backend/src/services/metadataFetcher.test.ts
```

- [ ] **Step 2: Update the existing 22 tests to the new shape**

In `backend/src/services/metadataFetcher.test.ts`:

Change the import line:

```ts
import { fetchMetadata, withSignal } from './metadataFetcher'
```

Change the outer describe from `describe('fetchTitle', ...)` to `describe('fetchMetadata', ...)`.

Then mechanically update every existing case: each `await fetchTitle(...)` becomes `await fetchMetadata(...)`, each `expect(result).toBe('X')` becomes `expect(result.title).toBe('X')`, and each `expect(result).toBeNull()` becomes `expect(result.title).toBeNull()`. Leave every `expect(mockFetch)` / `expect(lookup)` assertion exactly as-is.

There is one exception — the `withSignal` describe block at the bottom of the file is unrelated to this change and must not be touched.

- [ ] **Step 3: Add the new favicon tests to `metadataFetcher.test.ts`**

Add these inside the `describe('fetchMetadata', ...)` block:

```ts
it('defaults faviconUrl to /favicon.ico on the origin when the page declares no icon', async () => {
  mockFetch.mockResolvedValue(mockResponse(['<html><head><title>T</title></head></html>']))
  const result = await fetchMetadata('https://example.com/some/deep/page?q=1')
  expect(result.faviconUrl).toBe('https://example.com/favicon.ico')
})

it('still returns the origin favicon when the content type is not HTML', async () => {
  mockFetch.mockResolvedValue(mockResponse(['%PDF-1.4'], { contentType: 'application/pdf' }))
  const result = await fetchMetadata('https://example.com/file.pdf')
  expect(result.title).toBeNull()
  expect(result.faviconUrl).toBe('https://example.com/favicon.ico')
})

it('takes the origin favicon from the final URL after a redirect, not the original', async () => {
  mockFetch
    .mockResolvedValueOnce(mockRedirect('https://final.example.org/page'))
    .mockResolvedValueOnce(mockResponse(['<title>Final Page</title>']))
  const result = await fetchMetadata('https://short.example.com/abc')
  expect(result.faviconUrl).toBe('https://final.example.org/favicon.ico')
})

it('returns a null faviconUrl when the host is disallowed', async () => {
  vi.mocked(lookup).mockResolvedValue({ address: '127.0.0.1', family: 4 } as never)
  const result = await fetchMetadata('http://sneaky.example/')
  expect(result).toEqual({ title: null, faviconUrl: null })
})

it('returns a null faviconUrl when the fetch throws', async () => {
  mockFetch.mockRejectedValue(new TypeError('fetch failed'))
  const result = await fetchMetadata('https://example.com')
  expect(result).toEqual({ title: null, faviconUrl: null })
})

it('returns a null faviconUrl when the redirect chain exceeds the hop cap', async () => {
  mockFetch
    .mockResolvedValueOnce(mockRedirect('https://example.com/1'))
    .mockResolvedValueOnce(mockRedirect('https://example.com/2'))
    .mockResolvedValueOnce(mockRedirect('https://example.com/3'))
    .mockResolvedValueOnce(mockRedirect('https://example.com/4'))
  const result = await fetchMetadata('https://example.com/start')
  expect(result).toEqual({ title: null, faviconUrl: null })
})
```

- [ ] **Step 4: Run the tests to verify they fail**

```bash
cd /Users/hokita/ghq/github.com/hokita/hamster/.claude/worktrees/bookmark-favicon/backend && npm test
```

Expected: FAIL — `metadataFetcher.test.ts` cannot resolve the export `fetchMetadata`.

- [ ] **Step 5: Rewrite the bottom of `metadataFetcher.ts`**

Replace `fetchTitleInner` and `fetchTitle` (currently lines 84-125) with:

```ts
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

    return { title: extractTitle(text), faviconUrl: originFavicon }
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
```

- [ ] **Step 6: Update the route to the new call shape**

In `backend/src/routes/bookmarks.ts`, change the import on line 4:

```ts
import { fetchMetadata } from '../services/metadataFetcher'
```

and replace line 29:

```ts
      const { title } = await fetchMetadata(url)
      const bookmark = await db.createBookmark(url, title ?? url)
```

- [ ] **Step 7: Update the route tests' mock**

In `backend/src/routes/bookmarks.test.ts`, replace the `vi.mock` on lines 9-11 and the import on line 15:

```ts
vi.mock('../services/metadataFetcher', () => ({
  fetchMetadata: vi.fn(),
}))
```

```ts
import { fetchMetadata } from '../services/metadataFetcher'
```

Then update the three call sites that stub it. Line 51 becomes:

```ts
    vi.mocked(fetchMetadata).mockResolvedValue({ title: 'Example', faviconUrl: null })
```

Line 60 becomes:

```ts
    expect(fetchMetadata).toHaveBeenCalledWith('https://example.com')
```

Line 66 becomes:

```ts
    vi.mocked(fetchMetadata).mockResolvedValue({ title: null, faviconUrl: null })
```

Line 106 becomes:

```ts
    vi.mocked(fetchMetadata).mockResolvedValue({ title: 'Example', faviconUrl: null })
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
cd /Users/hokita/ghq/github.com/hokita/hamster/.claude/worktrees/bookmark-favicon/backend && npm test && npm run lint
```

Expected: PASS — 57 tests (51 baseline + 6 new), 0 failures. Lint clean.

- [ ] **Step 9: Commit**

```bash
cd /Users/hokita/ghq/github.com/hokita/hamster/.claude/worktrees/bookmark-favicon
git add backend/src
git commit -m "refactor: fetchTitle becomes fetchMetadata with origin favicon default"
```

---

### Task 2: Parse the declared `<link rel="icon">`

**Files:**
- Modify: `backend/src/services/metadataFetcher.ts`
- Test: `backend/src/services/metadataFetcher.test.ts`

**Interfaces:**
- Consumes: `PageMetadata`, `fetchMetadata`, `decodeEntities` from Task 1.
- Produces: no new exports. `fetchMetadata`'s `faviconUrl` now prefers a declared icon over the origin default.

- [ ] **Step 1: Write the failing tests**

Add these inside the `describe('fetchMetadata', ...)` block in `metadataFetcher.test.ts`:

```ts
it('finds an icon link that appears after the title', async () => {
  mockFetch.mockResolvedValue(
    mockResponse([
      '<html><head><title>T</title><link rel="icon" href="/i.png"></head><body></body></html>',
    ])
  )
  const result = await fetchMetadata('https://example.com')
  expect(result.title).toBe('T')
  expect(result.faviconUrl).toBe('https://example.com/i.png')
})

it('finds an icon link split across chunks after the title', async () => {
  mockFetch.mockResolvedValue(
    mockResponse([
      '<html><head><title>T</title>',
      '<link rel="icon" href="/late.png">',
      '</head><body></body></html>',
    ])
  )
  const result = await fetchMetadata('https://example.com')
  expect(result.faviconUrl).toBe('https://example.com/late.png')
})

it('resolves a relative icon href against the page URL', async () => {
  mockFetch.mockResolvedValue(
    mockResponse(['<head><link rel="icon" href="icons/fav.png"></head>'])
  )
  const result = await fetchMetadata('https://example.com/blog/post')
  expect(result.faviconUrl).toBe('https://example.com/blog/icons/fav.png')
})

it('keeps an absolute icon href on another origin', async () => {
  mockFetch.mockResolvedValue(
    mockResponse(['<head><link rel="icon" href="https://cdn.example.net/f.ico"></head>'])
  )
  const result = await fetchMetadata('https://example.com')
  expect(result.faviconUrl).toBe('https://cdn.example.net/f.ico')
})

it('accepts rel="shortcut icon"', async () => {
  mockFetch.mockResolvedValue(
    mockResponse(['<head><link rel="shortcut icon" href="/s.ico"></head>'])
  )
  const result = await fetchMetadata('https://example.com')
  expect(result.faviconUrl).toBe('https://example.com/s.ico')
})

it('accepts a link tag with href before rel', async () => {
  mockFetch.mockResolvedValue(
    mockResponse(["<head><link href='/order.ico' rel='icon'></head>"])
  )
  const result = await fetchMetadata('https://example.com')
  expect(result.faviconUrl).toBe('https://example.com/order.ico')
})

it('falls back to apple-touch-icon when no icon link is declared', async () => {
  mockFetch.mockResolvedValue(
    mockResponse(['<head><link rel="apple-touch-icon" href="/apple.png"></head>'])
  )
  const result = await fetchMetadata('https://example.com')
  expect(result.faviconUrl).toBe('https://example.com/apple.png')
})

it('prefers a plain icon link over an apple-touch-icon declared earlier', async () => {
  mockFetch.mockResolvedValue(
    mockResponse([
      '<head><link rel="apple-touch-icon" href="/apple.png"><link rel="icon" href="/real.ico"></head>',
    ])
  )
  const result = await fetchMetadata('https://example.com')
  expect(result.faviconUrl).toBe('https://example.com/real.ico')
})

it('decodes HTML entities in the icon href', async () => {
  mockFetch.mockResolvedValue(
    mockResponse(['<head><link rel="icon" href="/i.ico?a=1&amp;b=2"></head>'])
  )
  const result = await fetchMetadata('https://example.com')
  expect(result.faviconUrl).toBe('https://example.com/i.ico?a=1&b=2')
})

it('ignores a javascript: icon href and uses the origin default', async () => {
  mockFetch.mockResolvedValue(
    mockResponse(['<head><link rel="icon" href="javascript:alert(1)"></head>'])
  )
  const result = await fetchMetadata('https://example.com')
  expect(result.faviconUrl).toBe('https://example.com/favicon.ico')
})

it('ignores a data: icon href and uses the origin default', async () => {
  mockFetch.mockResolvedValue(
    mockResponse(['<head><link rel="icon" href="data:image/png;base64,AAAA"></head>'])
  )
  const result = await fetchMetadata('https://example.com')
  expect(result.faviconUrl).toBe('https://example.com/favicon.ico')
})

it('ignores a stylesheet link and uses the origin default', async () => {
  mockFetch.mockResolvedValue(
    mockResponse(['<head><link rel="stylesheet" href="/app.css"></head>'])
  )
  const result = await fetchMetadata('https://example.com')
  expect(result.faviconUrl).toBe('https://example.com/favicon.ico')
})

it('uses the declared icon from the final page after a redirect', async () => {
  mockFetch
    .mockResolvedValueOnce(mockRedirect('https://final.example.org/page'))
    .mockResolvedValueOnce(mockResponse(['<head><link rel="icon" href="/f.png"></head>']))
  const result = await fetchMetadata('https://short.example.com/abc')
  expect(result.faviconUrl).toBe('https://final.example.org/f.png')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/hokita/ghq/github.com/hokita/hamster/.claude/worktrees/bookmark-favicon/backend && npm test
```

Expected: FAIL — the declared-icon cases all report the origin default (`https://example.com/favicon.ico`) instead of the declared href. The two "after the title" cases are the read-loop regression.

- [ ] **Step 3: Change the read-loop exit condition**

In `metadataFetcher.ts`, add this constant next to `TITLE_REGEX` near the top:

```ts
const HEAD_END_REGEX = /<\/head\s*>|<body\b/i
```

Then in `readBoundedBytes`, replace the early-exit check (currently line 78, `if (TITLE_REGEX.test(...)) break`) and its comment with:

```ts
    // Stop at the end of <head> rather than at </title>: <link rel="icon"> commonly follows
    // the title, so exiting at the title would truncate the icon away on most real pages.
    // These markers are ASCII-range markup and decode identically under latin1 regardless of
    // the page's real charset, so this is a safe early-exit check without yet knowing — or
    // mis-decoding non-ASCII bytes with the wrong guess for — the actual encoding, which
    // isn't resolved until the whole (bounded) body has been read.
    if (HEAD_END_REGEX.test(Buffer.concat(chunks).toString('latin1'))) break
```

- [ ] **Step 4: Add the icon extraction helpers**

In `metadataFetcher.ts`, add these above `fetchMetadataInner`:

```ts
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
  let appleTouchIcon: string | null = null

  for (const match of text.matchAll(LINK_TAG_REGEX)) {
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
```

- [ ] **Step 5: Use the declared icon in `fetchMetadataInner`**

Replace the final `return` of the loop body:

```ts
    return {
      title: extractTitle(text),
      faviconUrl: extractIconHref(text, currentUrl) ?? originFavicon,
    }
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd /Users/hokita/ghq/github.com/hokita/hamster/.claude/worktrees/bookmark-favicon/backend && npm test && npm run lint
```

Expected: PASS — 70 tests (57 + 13 new), 0 failures. Lint clean.

If the size-cap tests (`stops reading once the size cap is exceeded across chunks` and `truncates a single chunk at the byte cap`) fail, the `MAX_BYTES` guard was disturbed — it must still take priority over the head-end check.

- [ ] **Step 7: Commit**

```bash
cd /Users/hokita/ghq/github.com/hokita/hamster/.claude/worktrees/bookmark-favicon
git add backend/src
git commit -m "feat: extract declared <link rel=icon> as the bookmark favicon"
```

---

### Task 3: Persist `faviconUrl` and wire the route

**Files:**
- Modify: `backend/src/services/firestore.ts`
- Modify: `backend/src/routes/bookmarks.ts`
- Test: `backend/src/services/firestore.test.ts`
- Test: `backend/src/routes/bookmarks.test.ts`

**Interfaces:**
- Consumes: `fetchMetadata` from Task 1.
- Produces: `BookmarkDoc` gains optional `faviconUrl?: string`; `createBookmark(url: string, title: string, faviconUrl?: string | null): Promise<BookmarkDoc>`.

- [ ] **Step 1: Write the failing Firestore tests**

`firestore.test.ts` currently mocks only `collection().orderBy().get()`. Replace the whole mock preamble (lines 1-12) with this — it adds `add` and a real `Timestamp.now`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGet = vi.fn()
const mockAdd = vi.fn()
const mockOrderBy = vi.fn(() => ({ get: mockGet }))
const mockCollection = vi.fn(() => ({ orderBy: mockOrderBy, add: mockAdd }))
const fixedDate = new Date('2024-01-01T00:00:00.000Z')

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ collection: mockCollection }),
  Timestamp: { now: () => ({ toDate: () => fixedDate }) },
}))

import { listBookmarks, createBookmark } from './firestore'

beforeEach(() => {
  vi.clearAllMocks()
  mockAdd.mockResolvedValue({ id: 'new-id' })
})
```

Then append these describes to the end of the file:

```ts
describe('createBookmark', () => {
  it('persists faviconUrl when one was resolved', async () => {
    const result = await createBookmark('https://example.com', 'Example', 'https://example.com/f.ico')

    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({ faviconUrl: 'https://example.com/f.ico' })
    )
    expect(result.faviconUrl).toBe('https://example.com/f.ico')
  })

  it('omits the faviconUrl key entirely when null, since Firestore rejects undefined', async () => {
    const result = await createBookmark('https://example.com', 'Example', null)

    expect(mockAdd).toHaveBeenCalledTimes(1)
    expect(Object.keys(mockAdd.mock.calls[0][0])).not.toContain('faviconUrl')
    expect(result).not.toHaveProperty('faviconUrl')
  })

  it('omits the faviconUrl key when the argument is not supplied at all', async () => {
    await createBookmark('https://example.com', 'Example')

    expect(Object.keys(mockAdd.mock.calls[0][0])).not.toContain('faviconUrl')
  })
})

describe('listBookmarks faviconUrl handling', () => {
  it('returns faviconUrl when the document has one', async () => {
    mockGet.mockResolvedValue({
      docs: [
        {
          id: 'a',
          data: () => ({
            url: 'https://example.com',
            title: 'A',
            faviconUrl: 'https://example.com/f.ico',
            createdAt: { toDate: () => fixedDate },
          }),
        },
      ],
    })

    const result = await listBookmarks()

    expect(result[0].faviconUrl).toBe('https://example.com/f.ico')
  })

  it('still returns documents saved before faviconUrl existed', async () => {
    mockGet.mockResolvedValue({
      docs: [
        {
          id: 'legacy',
          data: () => ({
            url: 'https://example.com',
            title: 'Legacy',
            createdAt: { toDate: () => fixedDate },
          }),
        },
      ],
    })

    const result = await listBookmarks()

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('legacy')
    expect(result[0].faviconUrl).toBeUndefined()
  })

  it('ignores a non-string faviconUrl rather than dropping the document', async () => {
    mockGet.mockResolvedValue({
      docs: [
        {
          id: 'weird',
          data: () => ({
            url: 'https://example.com',
            title: 'Weird',
            faviconUrl: 42,
            createdAt: { toDate: () => fixedDate },
          }),
        },
      ],
    })

    const result = await listBookmarks()

    expect(result).toHaveLength(1)
    expect(result[0].faviconUrl).toBeUndefined()
  })
})
```

- [ ] **Step 2: Write the failing route test**

Append to the `describe('POST /api/bookmarks', ...)` block in `bookmarks.test.ts`:

```ts
  it('passes the fetched faviconUrl through to createBookmark', async () => {
    vi.mocked(fetchMetadata).mockResolvedValue({
      title: 'Example',
      faviconUrl: 'https://example.com/f.ico',
    })
    vi.mocked(db.createBookmark).mockResolvedValue({
      id: '1',
      url: 'https://example.com',
      title: 'Example',
      faviconUrl: 'https://example.com/f.ico',
      createdAt: '2024-01-01T00:00:00.000Z',
    })

    const res = await request(app).post('/api/bookmarks').send({ url: 'https://example.com' })

    expect(res.status).toBe(201)
    expect(db.createBookmark).toHaveBeenCalledWith(
      'https://example.com',
      'Example',
      'https://example.com/f.ico'
    )
    expect(res.body.faviconUrl).toBe('https://example.com/f.ico')
  })
```

Also update the two existing assertions that now receive a third argument. Line 61 becomes:

```ts
    expect(db.createBookmark).toHaveBeenCalledWith('https://example.com', 'Example', null)
```

Line 75 becomes:

```ts
    expect(db.createBookmark).toHaveBeenCalledWith(
      'https://example.com',
      'https://example.com',
      null
    )
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd /Users/hokita/ghq/github.com/hokita/hamster/.claude/worktrees/bookmark-favicon/backend && npm test
```

Expected: FAIL — `createBookmark` ignores its third argument and `mockAdd` is never called with `faviconUrl`.

- [ ] **Step 4: Implement the Firestore changes**

Replace the contents of `backend/src/services/firestore.ts` with:

```ts
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

export interface BookmarkDoc {
  id: string
  url: string
  title: string
  faviconUrl?: string
  createdAt: string
}

export async function createBookmark(
  url: string,
  title: string,
  faviconUrl?: string | null
): Promise<BookmarkDoc> {
  const db = getFirestore()
  const now = Timestamp.now()
  // Firestore rejects undefined values, so the key is omitted rather than written as undefined.
  const favicon = faviconUrl ? { faviconUrl } : {}
  const ref = await db.collection('bookmarks').add({ url, title, ...favicon, createdAt: now })
  return { id: ref.id, url, title, ...favicon, createdAt: now.toDate().toISOString() }
}

export async function listBookmarks(): Promise<BookmarkDoc[]> {
  const db = getFirestore()
  const snap = await db.collection('bookmarks').orderBy('createdAt', 'desc').get()
  const bookmarks: BookmarkDoc[] = []
  for (const doc of snap.docs) {
    const data = doc.data() as {
      url?: unknown
      title?: unknown
      faviconUrl?: unknown
      createdAt?: { toDate?: () => Date }
    }
    if (
      typeof data.url !== 'string' ||
      typeof data.title !== 'string' ||
      typeof data.createdAt?.toDate !== 'function'
    ) {
      continue
    }
    // faviconUrl is deliberately absent from the validation above: every document written
    // before this field existed lacks it, and gating on it would drop the entire back catalogue.
    bookmarks.push({
      id: doc.id,
      url: data.url,
      title: data.title,
      ...(typeof data.faviconUrl === 'string' ? { faviconUrl: data.faviconUrl } : {}),
      createdAt: data.createdAt.toDate().toISOString(),
    })
  }
  return bookmarks
}
```

- [ ] **Step 5: Wire the route**

In `backend/src/routes/bookmarks.ts`, replace the two lines added in Task 1:

```ts
      const { title, faviconUrl } = await fetchMetadata(url)
      const bookmark = await db.createBookmark(url, title ?? url, faviconUrl)
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd /Users/hokita/ghq/github.com/hokita/hamster/.claude/worktrees/bookmark-favicon/backend && npm test && npm run lint && npm run build
```

Expected: PASS — 77 tests (70 + 6 Firestore + 1 route), 0 failures. Lint and `tsc` clean.

- [ ] **Step 7: Commit**

```bash
cd /Users/hokita/ghq/github.com/hokita/hamster/.claude/worktrees/bookmark-favicon
git add backend/src
git commit -m "feat: persist faviconUrl on bookmark documents"
```

---

### Task 4: Render the favicon in the bookmark list

**Files:**
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/components/BookmarkList.tsx`
- Test: `frontend/src/components/BookmarkList.test.tsx`

**Interfaces:**
- Consumes: the API response shape from Task 3 — `faviconUrl` is optional and always `http(s)` when present.
- Produces: no new exports.

**Testing note:** the `<img>` carries `alt=""` and `aria-hidden`, so it is intentionally absent from the accessibility tree. `getByRole('img')` will **not** find it — query with `container.querySelector('img')`.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/components/BookmarkList.test.tsx`, extend the import on line 1:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
```

Then append:

```tsx
describe('BookmarkList favicons', () => {
  it('uses the stored faviconUrl as the icon source', () => {
    const withIcon = [{ ...bookmarks[0], faviconUrl: 'https://cdn.example.net/f.ico' }]
    const { container } = render(<BookmarkList bookmarks={withIcon} />)

    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      'https://cdn.example.net/f.ico'
    )
  })

  it('derives the origin favicon when the bookmark has no stored faviconUrl', () => {
    const legacy = [{ ...bookmarks[0], url: 'https://example.com/deep/page?q=1' }]
    const { container } = render(<BookmarkList bookmarks={legacy} />)

    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      'https://example.com/favicon.ico'
    )
  })

  it('keeps the favicon out of the accessible name and out of the referrer', () => {
    const withIcon = [{ ...bookmarks[0], faviconUrl: 'https://cdn.example.net/logo-name.ico' }]
    const { container } = render(<BookmarkList bookmarks={withIcon} />)
    const img = container.querySelector('img')

    expect(img).toHaveAttribute('alt', '')
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer')
    expect(img).toHaveAttribute('loading', 'lazy')
    expect(screen.getByRole('link', { name: /Example Site/ })).not.toHaveAccessibleName(
      expect.stringContaining('logo-name')
    )
  })

  it('falls back to the generic icon when the favicon fails to load', () => {
    const { container } = render(<BookmarkList bookmarks={bookmarks} />)
    const img = container.querySelector('img')
    expect(img).not.toBeNull()

    fireEvent.error(img!)

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('renders the generic icon without throwing when the URL is unparseable', () => {
    const malformed = [{ ...bookmarks[0], url: 'https://exa mple.com' }]
    const { container } = render(<BookmarkList bookmarks={malformed} />)

    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByRole('link', { name: /Example Site/ })).toBeInTheDocument()
  })
})
```

Do **not** modify the shared `bookmarks` fixture at the top of the file or any existing test — every new case above derives its own local fixture with the spread syntax, exactly as the existing tests do.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/hokita/ghq/github.com/hokita/hamster/.claude/worktrees/bookmark-favicon/frontend && npm test
```

Expected: FAIL — no `<img>` is rendered; `container.querySelector('img')` is `null`.

- [ ] **Step 3: Add the optional field to the API type**

In `frontend/src/api.ts`, add to the `Bookmark` interface (after `title`):

```ts
  faviconUrl?: string
```

- [ ] **Step 4: Implement the rendering**

In `frontend/src/components/BookmarkList.tsx`, add the `useState` import at the top:

```tsx
import { useState } from 'react'
```

Add this helper next to the existing `hostnameOf`:

```tsx
function originFaviconOf(url: string): string | null {
  try {
    return new URL('/favicon.ico', url).toString()
  } catch {
    return null
  }
}
```

Inside the component, above the `if (items.length === 0)` guard, add:

```tsx
  const [failedIcons, setFailedIcons] = useState<ReadonlySet<string>>(new Set())
```

Inside the `items.map` callback, next to the existing `hostname` line, add:

```tsx
        const iconSrc = failedIcons.has(bookmark.id)
          ? null
          : (bookmark.faviconUrl ?? originFaviconOf(bookmark.url))
```

Finally, replace the icon container span (currently lines 43-45) with:

```tsx
              <span className="flex items-center justify-center w-7 h-7 rounded-md bg-gray-100 text-gray-400 flex-shrink-0 overflow-hidden">
                {iconSrc ? (
                  <img
                    src={iconSrc}
                    alt=""
                    aria-hidden="true"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="w-4 h-4 object-contain"
                    onError={() =>
                      setFailedIcons((previous) => new Set(previous).add(bookmark.id))
                    }
                  />
                ) : (
                  <FontAwesomeIcon icon={faLink} size="xs" aria-hidden="true" />
                )}
              </span>
```

The container keeps its `w-7 h-7`, so the row does not reflow between the icon loading, failing, or being absent.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd /Users/hokita/ghq/github.com/hokita/hamster/.claude/worktrees/bookmark-favicon/frontend && npm test && npm run lint && npm run build
```

Expected: PASS — 51 tests (46 baseline + 5 new), 0 failures. Lint and build clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/hokita/ghq/github.com/hokita/hamster/.claude/worktrees/bookmark-favicon
git add frontend/src
git commit -m "feat: show site favicons in the bookmark list"
```

---

### Task 5: Full verification

**Files:** none modified — this task only runs and reports.

- [ ] **Step 1: Run both suites plus lint, build, and format checks**

```bash
cd /Users/hokita/ghq/github.com/hokita/hamster/.claude/worktrees/bookmark-favicon/backend && npm test && npm run lint && npm run build && npm run format:check
```

```bash
cd /Users/hokita/ghq/github.com/hokita/hamster/.claude/worktrees/bookmark-favicon/frontend && npm test && npm run lint && npm run build && npm run format:check
```

Expected: backend 77 passing, frontend 51 passing, everything else clean. If `format:check` fails, run `npm run format` in that package and amend the last commit.

- [ ] **Step 2: Confirm no stale references to the old module name remain**

```bash
cd /Users/hokita/ghq/github.com/hokita/hamster/.claude/worktrees/bookmark-favicon && grep -rn "titleFetcher\|fetchTitle" backend/src frontend/src e2e 2>/dev/null || echo "clean - no stale references"
```

Expected: `clean - no stale references`.

- [ ] **Step 3: Report the actual command output**

State the real pass/fail counts from Step 1. Do not claim success without the output. If anything failed, report it rather than proceeding.
