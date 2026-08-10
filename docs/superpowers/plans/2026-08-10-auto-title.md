# Automatic Bookmark Title Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bookmark creation requires only a URL — the backend fetches the target page server-side and extracts its `<title>` automatically, so the frontend's title field is removed entirely.

**Architecture:** A new `backend/src/services/titleFetcher.ts` module fetches the URL server-side with an SSRF guard (backed by a new `backend/src/services/ipGuard.ts` pure IP-range checker), redirect validation, and a bounded HTML read, returning the extracted `<title>` or `null` on any failure. `backend/src/routes/bookmarks.ts` calls it and falls back to the URL itself when it returns `null`. The frontend (`BookmarkForm`, `BookmarksPage`, `api.ts`) drops the title field/parameter throughout.

**Tech Stack:** Node 24 native `fetch` and `node:dns/promises` (both built in — no new dependencies), Express, Vitest + Supertest (backend), React + Vitest + Testing Library (frontend), Playwright (e2e).

## Global Constraints

- No new npm dependencies in `backend/` or `frontend/` — use Node 24's built-in `fetch` and `node:dns/promises` only.
- No Firestore schema, index, or rules changes — `BookmarkDoc` keeps its existing `{ id, url, title, createdAt }` shape.
- Every task follows red/green TDD: write the failing test(s) first, verify the failure, then write the minimal implementation to pass.
- `fetchTitle` never throws for expected failure modes (bad host, timeout, non-HTML, no title, network error) — it always resolves, returning `null` on failure. Callers fall back to the URL itself as the title.
- SSRF guard blocks IPv4 `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.0.0/16`, `0.0.0.0/8`, and IPv6 `::1`, `fc00::/7` (unique local), `fe80::/10` (link-local), plus IPv4-mapped IPv6 equivalents of the above.
- Fetch timeout is 5000ms, redirects are capped at 3 hops (re-validated against the SSRF guard on every hop), and the response body read is capped at 100KB.

---

### Task 1: SSRF IP-range guard

**Files:**
- Create: `backend/src/services/ipGuard.ts`
- Test: `backend/src/services/ipGuard.test.ts`

**Interfaces:**
- Produces: `isDisallowedIp(address: string, family: number): boolean` — pure function, no I/O. `family` is `4` or `6` (matches `dns.lookup`'s return shape).

- [ ] **Step 1: Write the failing tests**

Create `backend/src/services/ipGuard.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { isDisallowedIp } from './ipGuard'

describe('isDisallowedIp', () => {
  it('rejects private, loopback, link-local, and reserved IPv4 ranges', () => {
    expect(isDisallowedIp('10.1.2.3', 4)).toBe(true)
    expect(isDisallowedIp('172.16.0.1', 4)).toBe(true)
    expect(isDisallowedIp('172.31.255.255', 4)).toBe(true)
    expect(isDisallowedIp('192.168.1.1', 4)).toBe(true)
    expect(isDisallowedIp('127.0.0.1', 4)).toBe(true)
    expect(isDisallowedIp('169.254.1.1', 4)).toBe(true)
    expect(isDisallowedIp('0.0.0.5', 4)).toBe(true)
  })

  it('allows public IPv4 addresses, including just outside the 172.16.0.0/12 range', () => {
    expect(isDisallowedIp('93.184.216.34', 4)).toBe(false)
    expect(isDisallowedIp('172.32.0.1', 4)).toBe(false)
    expect(isDisallowedIp('172.15.255.255', 4)).toBe(false)
  })

  it('rejects loopback, unique-local, link-local, and IPv4-mapped private IPv6 addresses', () => {
    expect(isDisallowedIp('::1', 6)).toBe(true)
    expect(isDisallowedIp('fd12:3456:789a::1', 6)).toBe(true)
    expect(isDisallowedIp('fe80::1', 6)).toBe(true)
    expect(isDisallowedIp('::ffff:127.0.0.1', 6)).toBe(true)
  })

  it('allows public IPv6 addresses', () => {
    expect(isDisallowedIp('2606:2800:220:1:248:1893:25c8:1946', 6)).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run src/services/ipGuard.test.ts`
Expected: FAIL — `Cannot find module './ipGuard'` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `backend/src/services/ipGuard.ts`:

```typescript
const IPV4_RANGES: [string, number][] = [
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['0.0.0.0', 8],
]

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0
}

function isDisallowedIpv4(ip: string): boolean {
  const ipInt = ipv4ToInt(ip)
  return IPV4_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
    return (ipInt & mask) === (ipv4ToInt(base) & mask)
  })
}

function isDisallowedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase()
  if (normalized === '::1') return true
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isDisallowedIpv4(mapped[1])
  const firstGroup = parseInt(normalized.split(':')[0] || '0', 16)
  if ((firstGroup & 0xfe00) === 0xfc00) return true // fc00::/7 (unique local)
  if ((firstGroup & 0xffc0) === 0xfe80) return true // fe80::/10 (link-local)
  return false
}

export function isDisallowedIp(address: string, family: number): boolean {
  return family === 4 ? isDisallowedIpv4(address) : isDisallowedIpv6(address)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/services/ipGuard.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/ipGuard.ts backend/src/services/ipGuard.test.ts
git commit -m "feat(backend): add SSRF IP-range guard"
```

---

### Task 2: Title fetcher — happy path and SSRF integration

**Files:**
- Create: `backend/src/services/titleFetcher.ts`
- Test: `backend/src/services/titleFetcher.test.ts`

**Interfaces:**
- Consumes: `isDisallowedIp(address: string, family: number): boolean` from `backend/src/services/ipGuard.ts` (Task 1)
- Produces: `fetchTitle(url: string): Promise<string | null>` — initial version, handles a direct (non-redirect) HTML response only. Extended in Tasks 3 and 4.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/services/titleFetcher.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}))

import { lookup } from 'node:dns/promises'
import { fetchTitle } from './titleFetcher'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function mockResponse(body: string, contentType = 'text/html; charset=utf-8') {
  return {
    status: 200,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null),
    },
    text: async () => body,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(lookup).mockResolvedValue({ address: '93.184.216.34', family: 4 } as never)
})

describe('fetchTitle', () => {
  it('extracts and decodes the page title from a successful HTML response', async () => {
    mockFetch.mockResolvedValue(
      mockResponse('<html><head><title>Tom &amp; Jerry</title></head></html>')
    )
    const result = await fetchTitle('https://example.com')
    expect(result).toBe('Tom & Jerry')
  })

  it('returns null when the response has no title tag', async () => {
    mockFetch.mockResolvedValue(mockResponse('<html><head></head></html>'))
    const result = await fetchTitle('https://example.com')
    expect(result).toBeNull()
  })

  it('returns null when the content type is not HTML', async () => {
    mockFetch.mockResolvedValue(mockResponse('%PDF-1.4', 'application/pdf'))
    const result = await fetchTitle('https://example.com/file.pdf')
    expect(result).toBeNull()
  })

  it('returns null when the resolved host is a private/loopback/link-local address', async () => {
    vi.mocked(lookup).mockResolvedValue({ address: '127.0.0.1', family: 4 } as never)
    const result = await fetchTitle('http://sneaky.example/')
    expect(result).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run src/services/titleFetcher.test.ts`
Expected: FAIL — `Cannot find module './titleFetcher'`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/services/titleFetcher.ts`:

```typescript
import { lookup } from 'node:dns/promises'
import { isDisallowedIp } from './ipGuard'

const HTML_CONTENT_TYPE = /^(text\/html|application\/xhtml\+xml)/i
const TITLE_REGEX = /<title[^>]*>([^<]*)<\/title>/i

async function isDisallowedHost(hostname: string): Promise<boolean> {
  try {
    const { address, family } = await lookup(hostname)
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

export async function fetchTitle(url: string): Promise<string | null> {
  const parsed = new URL(url)
  if (await isDisallowedHost(parsed.hostname)) return null

  const response = await fetch(url, { redirect: 'manual' })

  const contentType = response.headers.get('content-type') ?? ''
  if (!HTML_CONTENT_TYPE.test(contentType)) return null

  const text = await response.text()
  const match = TITLE_REGEX.exec(text)
  if (!match) return null

  const title = decodeEntities(match[1]).replace(/\s+/g, ' ').trim()
  return title || null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/services/titleFetcher.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/titleFetcher.ts backend/src/services/titleFetcher.test.ts
git commit -m "feat(backend): fetch and extract page title (happy path)"
```

---

### Task 3: Title fetcher — bounded read and redirect handling

**Files:**
- Modify: `backend/src/services/titleFetcher.ts`
- Modify: `backend/src/services/titleFetcher.test.ts`

**Interfaces:**
- Consumes/Modifies: `fetchTitle` from Task 2 (same exported signature: `(url: string) => Promise<string | null>`)
- Produces: `fetchTitle` now also follows redirects (capped at 3 hops, re-validated against `isDisallowedHost` each hop) and caps the response body read at 100KB.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `backend/src/services/titleFetcher.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}))

import { lookup } from 'node:dns/promises'
import { fetchTitle } from './titleFetcher'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function mockResponse(
  chunks: string[],
  { contentType = 'text/html; charset=utf-8', status = 200 } = {}
) {
  const encoder = new TextEncoder()
  let index = 0
  return {
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null),
    },
    body: {
      getReader: () => ({
        read: async () => {
          if (index < chunks.length) {
            const value = encoder.encode(chunks[index])
            index += 1
            return { done: false, value }
          }
          return { done: true, value: undefined }
        },
        cancel: async () => {},
      }),
    },
  }
}

function mockRedirect(location: string, status = 302) {
  return {
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'location' ? location : null),
    },
    body: null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(lookup).mockResolvedValue({ address: '93.184.216.34', family: 4 } as never)
})

describe('fetchTitle', () => {
  it('extracts and decodes the page title from a successful HTML response', async () => {
    mockFetch.mockResolvedValue(
      mockResponse(['<html><head><title>Tom &amp; Jerry</title></head></html>'])
    )
    const result = await fetchTitle('https://example.com')
    expect(result).toBe('Tom & Jerry')
  })

  it('returns null when the response has no title tag', async () => {
    mockFetch.mockResolvedValue(mockResponse(['<html><head></head></html>']))
    const result = await fetchTitle('https://example.com')
    expect(result).toBeNull()
  })

  it('returns null when the content type is not HTML', async () => {
    mockFetch.mockResolvedValue(mockResponse(['%PDF-1.4'], { contentType: 'application/pdf' }))
    const result = await fetchTitle('https://example.com/file.pdf')
    expect(result).toBeNull()
  })

  it('returns null when the resolved host is a private/loopback/link-local address', async () => {
    vi.mocked(lookup).mockResolvedValue({ address: '127.0.0.1', family: 4 } as never)
    const result = await fetchTitle('http://sneaky.example/')
    expect(result).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('stops reading once the body exceeds the size cap without finding a title', async () => {
    const padding = 'x'.repeat(100_001)
    mockFetch.mockResolvedValue(mockResponse([padding, '<title>Too Late</title>']))
    const result = await fetchTitle('https://example.com')
    expect(result).toBeNull()
  })

  it('follows a redirect and extracts the title from the final response', async () => {
    mockFetch
      .mockResolvedValueOnce(mockRedirect('https://example.com/final'))
      .mockResolvedValueOnce(mockResponse(['<title>Final Page</title>']))
    const result = await fetchTitle('https://example.com/redirect')
    expect(result).toBe('Final Page')
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockFetch).toHaveBeenNthCalledWith(2, 'https://example.com/final', expect.any(Object))
  })

  it('returns null when the redirect chain exceeds the hop cap', async () => {
    mockFetch
      .mockResolvedValueOnce(mockRedirect('https://example.com/1'))
      .mockResolvedValueOnce(mockRedirect('https://example.com/2'))
      .mockResolvedValueOnce(mockRedirect('https://example.com/3'))
      .mockResolvedValueOnce(mockRedirect('https://example.com/4'))
    const result = await fetchTitle('https://example.com/start')
    expect(result).toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(4)
  })

  it('returns null when a redirect target resolves to a disallowed host', async () => {
    vi.mocked(lookup)
      .mockResolvedValueOnce({ address: '93.184.216.34', family: 4 } as never)
      .mockResolvedValueOnce({ address: '169.254.169.254', family: 4 } as never)
    mockFetch.mockResolvedValueOnce(mockRedirect('http://internal.example/metadata'))
    const result = await fetchTitle('https://example.com/redirect')
    expect(result).toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run tests to verify the new/changed ones fail**

Run: `cd backend && npx vitest run src/services/titleFetcher.test.ts`
Expected: FAIL — the first 4 tests fail because the mock responses no longer have a `.text()` method (implementation still calls `response.text()`); the 4 new tests fail because redirect/cap handling doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Replace the full contents of `backend/src/services/titleFetcher.ts`:

```typescript
import { lookup } from 'node:dns/promises'
import { isDisallowedIp } from './ipGuard'

const HTML_CONTENT_TYPE = /^(text\/html|application\/xhtml\+xml)/i
const TITLE_REGEX = /<title[^>]*>([^<]*)<\/title>/i
const MAX_REDIRECTS = 3
const MAX_BYTES = 100_000

async function isDisallowedHost(hostname: string): Promise<boolean> {
  try {
    const { address, family } = await lookup(hostname)
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

export async function fetchTitle(url: string): Promise<string | null> {
  let currentUrl = url

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = new URL(currentUrl)
    if (await isDisallowedHost(parsed.hostname)) return null

    const response = await fetch(currentUrl, { redirect: 'manual' })

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/services/titleFetcher.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/titleFetcher.ts backend/src/services/titleFetcher.test.ts
git commit -m "feat(backend): bound the title-fetch body read and follow redirects safely"
```

---

### Task 4: Title fetcher — timeout and network-error fallback

**Files:**
- Modify: `backend/src/services/titleFetcher.ts`
- Modify: `backend/src/services/titleFetcher.test.ts`

**Interfaces:**
- Consumes/Modifies: `fetchTitle` from Task 3
- Produces: final `fetchTitle(url: string): Promise<string | null>` — the complete function per spec. Consumed by Task 5.

- [ ] **Step 1: Write the failing tests**

Add these two tests inside the existing `describe('fetchTitle', ...)` block in `backend/src/services/titleFetcher.test.ts` (after the last test, before the closing `})`):

```typescript
  it('returns null when the request times out', async () => {
    mockFetch.mockRejectedValue(new DOMException('The operation was aborted.', 'TimeoutError'))
    const result = await fetchTitle('https://example.com')
    expect(result).toBeNull()
  })

  it('returns null when fetch throws a network error', async () => {
    mockFetch.mockRejectedValue(new TypeError('fetch failed'))
    const result = await fetchTitle('https://example.com')
    expect(result).toBeNull()
  })
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd backend && npx vitest run src/services/titleFetcher.test.ts`
Expected: FAIL — the two new tests fail because `fetch`'s rejection is unhandled and propagates out of `fetchTitle` instead of resolving to `null`.

- [ ] **Step 3: Write the implementation**

In `backend/src/services/titleFetcher.ts`, add the timeout constant near the other constants:

```typescript
const MAX_REDIRECTS = 3
const MAX_BYTES = 100_000
const FETCH_TIMEOUT_MS = 5000
```

Replace the `fetch` call inside the `for` loop in `fetchTitle` — from:

```typescript
    const response = await fetch(currentUrl, { redirect: 'manual' })
```

to:

```typescript
    let response: Response
    try {
      response = await fetch(currentUrl, {
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
    } catch {
      return null
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/services/titleFetcher.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/titleFetcher.ts backend/src/services/titleFetcher.test.ts
git commit -m "feat(backend): time out title fetches and fall back cleanly on network errors"
```

---

### Task 5: Wire the bookmarks route to fetch the title

**Files:**
- Modify: `backend/src/routes/bookmarks.ts`
- Modify: `backend/src/routes/bookmarks.test.ts`

**Interfaces:**
- Consumes: `fetchTitle(url: string): Promise<string | null>` from `backend/src/services/titleFetcher.ts` (Task 4); `createBookmark(url: string, title: string): Promise<BookmarkDoc>` from `backend/src/services/firestore.ts` (unchanged)
- Produces: `POST /api/bookmarks` now accepts `{ url: string }` only; response shape unchanged (`{ id, url, title, createdAt }`).

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `backend/src/routes/bookmarks.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../services/firestore', () => ({
  listBookmarks: vi.fn(),
  createBookmark: vi.fn(),
}))
vi.mock('../services/titleFetcher', () => ({
  fetchTitle: vi.fn(),
}))

import { createBookmarksRouter } from './bookmarks'
import * as db from '../services/firestore'
import { fetchTitle } from '../services/titleFetcher'

const app = express()
app.use(express.json())
app.use('/api/bookmarks', createBookmarksRouter())

describe('GET /api/bookmarks', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the list of bookmarks', async () => {
    vi.mocked(db.listBookmarks).mockResolvedValue([
      {
        id: '1',
        url: 'https://example.com',
        title: 'Example',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ])
    const res = await request(app).get('/api/bookmarks')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].title).toBe('Example')
  })

  it('returns 500 when listBookmarks rejects', async () => {
    vi.mocked(db.listBookmarks).mockRejectedValue(new Error('firestore down'))
    const res = await request(app).get('/api/bookmarks')
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: expect.any(String) })
  })
})

describe('POST /api/bookmarks', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a bookmark using the fetched title', async () => {
    vi.mocked(fetchTitle).mockResolvedValue('Example')
    vi.mocked(db.createBookmark).mockResolvedValue({
      id: '1',
      url: 'https://example.com',
      title: 'Example',
      createdAt: '2024-01-01T00:00:00.000Z',
    })
    const res = await request(app).post('/api/bookmarks').send({ url: 'https://example.com' })
    expect(res.status).toBe(201)
    expect(fetchTitle).toHaveBeenCalledWith('https://example.com')
    expect(db.createBookmark).toHaveBeenCalledWith('https://example.com', 'Example')
    expect(res.body.title).toBe('Example')
  })

  it('falls back to the URL as the title when fetchTitle returns null', async () => {
    vi.mocked(fetchTitle).mockResolvedValue(null)
    vi.mocked(db.createBookmark).mockResolvedValue({
      id: '1',
      url: 'https://example.com',
      title: 'https://example.com',
      createdAt: '2024-01-01T00:00:00.000Z',
    })
    const res = await request(app).post('/api/bookmarks').send({ url: 'https://example.com' })
    expect(res.status).toBe(201)
    expect(db.createBookmark).toHaveBeenCalledWith('https://example.com', 'https://example.com')
  })

  it('returns 400 when the request body is null', async () => {
    const res = await request(app)
      .post('/api/bookmarks')
      .set('Content-Type', 'application/json')
      .send('null')
    expect(res.status).toBe(400)
    expect(db.createBookmark).not.toHaveBeenCalled()
  })

  it('returns 400 when url is missing', async () => {
    const res = await request(app).post('/api/bookmarks').send({})
    expect(res.status).toBe(400)
    expect(db.createBookmark).not.toHaveBeenCalled()
  })

  it('returns 400 when url is not a string', async () => {
    const res = await request(app).post('/api/bookmarks').send({ url: { a: 1 } })
    expect(res.status).toBe(400)
    expect(db.createBookmark).not.toHaveBeenCalled()
  })

  it('returns 400 when url is not an http(s) URL', async () => {
    const res = await request(app).post('/api/bookmarks').send({ url: 'javascript:alert(1)' })
    expect(res.status).toBe(400)
    expect(db.createBookmark).not.toHaveBeenCalled()
  })

  it('returns 500 when createBookmark rejects', async () => {
    vi.mocked(fetchTitle).mockResolvedValue('Example')
    vi.mocked(db.createBookmark).mockRejectedValue(new Error('firestore down'))
    const res = await request(app).post('/api/bookmarks').send({ url: 'https://example.com' })
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: expect.any(String) })
  })
})
```

- [ ] **Step 2: Run tests to verify the changed ones fail**

Run: `cd backend && npx vitest run src/routes/bookmarks.test.ts`
Expected: FAIL — the route implementation still requires `title` in the request body, so the new/changed POST tests (which send `{ url }` only) get 400 responses instead of 201, and `db.createBookmark` is never called with the fetched title.

- [ ] **Step 3: Write the implementation**

Replace the full contents of `backend/src/routes/bookmarks.ts`:

```typescript
import { Router } from 'express'
import type { Request, Response } from 'express'
import * as db from '../services/firestore'
import { fetchTitle } from '../services/titleFetcher'

export function createBookmarksRouter(): Router {
  const router = Router()

  router.get('/', async (_req: Request, res: Response) => {
    try {
      const bookmarks = await db.listBookmarks()
      res.json(bookmarks)
    } catch {
      res.status(500).json({ error: 'Failed to list bookmarks' })
    }
  })

  router.post('/', async (req: Request, res: Response) => {
    const { url } = req.body as { url?: unknown }
    if (typeof url !== 'string' || !url) {
      res.status(400).json({ error: 'url is required' })
      return
    }
    if (!/^https?:\/\//.test(url)) {
      res.status(400).json({ error: 'url must be an http(s) URL' })
      return
    }
    try {
      const title = (await fetchTitle(url)) ?? url
      const bookmark = await db.createBookmark(url, title)
      res.status(201).json(bookmark)
    } catch {
      res.status(500).json({ error: 'Failed to create bookmark' })
    }
  })

  return router
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/routes/bookmarks.test.ts`
Expected: PASS (9 tests)

Then run the full backend suite to confirm no regressions: `cd backend && npm test`

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/bookmarks.ts backend/src/routes/bookmarks.test.ts
git commit -m "feat(backend): derive bookmark titles server-side instead of requiring them from the client"
```

---

### Task 6: Frontend API client — drop title from createBookmark

**Files:**
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/api.test.ts`

**Interfaces:**
- Produces: `api.createBookmark(bookmark: { url: string }): Promise<Bookmark>` — consumed by Task 7.

- [ ] **Step 1: Write the failing test**

In `frontend/src/api.test.ts`, replace the `describe('api.createBookmark', ...)` block with:

```typescript
describe('api.createBookmark', () => {
  it('posts the bookmark and returns the created record', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: '1',
        url: 'https://example.com',
        title: 'Example',
        createdAt: '2024-01-01',
      }),
    })
    const result = await api.createBookmark({ url: 'https://example.com' })
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/bookmarks'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ url: 'https://example.com' }),
      })
    )
    expect(result.title).toBe('Example')
  })
})
```

- [ ] **Step 2: Run the type check to verify it fails**

`createBookmark`'s current signature is `(bookmark: { url: string; title: string }) => ...` — both properties required. The new test's call site `api.createBookmark({ url: 'https://example.com' })` is a direct object literal missing the required `title` property, so this fails type-checking. Note that `vitest run` alone will **not** catch this — Vite/esbuild transpiles without type-checking, so the test executes fine at runtime (the request body was always just whatever object it's given, unchanged). The real RED signal here is the type check, matching how this repo's own CI runs "Test" and "Type check" as separate steps.

Run: `cd frontend && npx tsc --noEmit`
Expected: FAIL — `Property 'title' is missing in type '{ url: string; }' but required in type '{ url: string; title: string; }'.`

- [ ] **Step 3: Write the implementation**

In `frontend/src/api.ts`, change the `createBookmark` signature from:

```typescript
  createBookmark: (bookmark: { url: string; title: string }) =>
```

to:

```typescript
  createBookmark: (bookmark: { url: string }) =>
```

- [ ] **Step 4: Run tests and type-check to verify everything passes**

Run: `cd frontend && npx vitest run src/api.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api.ts frontend/src/api.test.ts
git commit -m "feat(frontend): narrow createBookmark to url-only"
```

---

### Task 7: Remove the title field from the bookmark creation UI

**Files:**
- Modify: `frontend/src/components/BookmarkForm.tsx`
- Modify: `frontend/src/components/BookmarkForm.test.tsx`
- Modify: `frontend/src/pages/BookmarksPage.tsx`
- Modify: `frontend/src/pages/BookmarksPage.test.tsx`

**Interfaces:**
- Consumes: `api.createBookmark(bookmark: { url: string }): Promise<Bookmark>` from Task 6
- Produces: `BookmarkFormProps.onAdd: (bookmark: { url: string }) => void | Promise<void>`; the form renders only a URL input.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `frontend/src/components/BookmarkForm.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import BookmarkForm from './BookmarkForm'

describe('BookmarkForm', () => {
  it('calls onAdd with the trimmed url, then clears the field', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined)
    render(<BookmarkForm onAdd={onAdd} />)

    fireEvent.change(screen.getByLabelText('URL'), {
      target: { value: '  https://example.com  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))

    expect(onAdd).toHaveBeenCalledWith({ url: 'https://example.com' })
    await waitFor(() => {
      expect(screen.getByLabelText('URL')).toHaveValue('')
    })
  })

  it('keeps the entered value when onAdd fails', async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error('failed'))
    render(<BookmarkForm onAdd={onAdd} />)

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))

    await waitFor(() => expect(onAdd).toHaveBeenCalled())
    expect(screen.getByLabelText('URL')).toHaveValue('https://example.com')
  })

  it('does not call onAdd when the URL is empty', () => {
    const onAdd = vi.fn()
    render(<BookmarkForm onAdd={onAdd} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('disables the input while a submit is in flight, preventing edits from being lost', async () => {
    let resolveOnAdd!: () => void
    const onAdd = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveOnAdd = resolve
        })
    )
    render(<BookmarkForm onAdd={onAdd} />)

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))

    expect(screen.getByLabelText('URL')).toBeDisabled()

    resolveOnAdd()
    await waitFor(() => expect(screen.getByLabelText('URL')).not.toBeDisabled())
  })

  it('ignores a second submit while the first is still in flight', async () => {
    let resolveOnAdd!: () => void
    const onAdd = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveOnAdd = resolve
        })
    )
    render(<BookmarkForm onAdd={onAdd} />)

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))

    expect(onAdd).toHaveBeenCalledTimes(1)
    resolveOnAdd()
    await waitFor(() => expect(screen.getByLabelText('URL')).toHaveValue(''))
  })
})
```

Replace the full contents of `frontend/src/pages/BookmarksPage.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../api', () => ({
  api: {
    listBookmarks: vi.fn(),
    createBookmark: vi.fn(),
  },
}))
vi.mock('../firebase', () => ({ auth: {} }))
vi.mock('firebase/auth', () => ({ signOut: vi.fn() }))

import { signOut } from 'firebase/auth'
import { api } from '../api'
import BookmarksPage from './BookmarksPage'

describe('BookmarksPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.listBookmarks).mockResolvedValue([])
  })

  it('loads and shows bookmarks on mount', async () => {
    vi.mocked(api.listBookmarks).mockResolvedValue([
      {
        id: '1',
        url: 'https://example.com',
        title: 'Example Site',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ])
    render(<BookmarksPage />)
    expect(await screen.findByRole('link', { name: 'Example Site' })).toBeInTheDocument()
  })

  it('adds a bookmark and refreshes the list', async () => {
    vi.mocked(api.createBookmark).mockResolvedValue({
      id: '2',
      url: 'https://example.com',
      title: 'New Site',
      createdAt: '2024-01-01T00:00:00.000Z',
    })
    render(<BookmarksPage />)
    await waitFor(() => expect(api.listBookmarks).toHaveBeenCalledTimes(1))

    vi.mocked(api.listBookmarks).mockResolvedValue([
      {
        id: '2',
        url: 'https://example.com',
        title: 'New Site',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ])
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))

    expect(await screen.findByRole('link', { name: 'New Site' })).toBeInTheDocument()
    expect(api.listBookmarks).toHaveBeenCalledTimes(2)
  })

  it('shows an error message when loading bookmarks fails', async () => {
    vi.mocked(api.listBookmarks).mockRejectedValue(new Error('network error'))
    render(<BookmarksPage />)
    expect(await screen.findByText('Failed to load bookmarks.')).toBeInTheDocument()
  })

  it('ignores a stale mount-fetch response that resolves after a newer add', async () => {
    let resolveMountFetch!: (value: Awaited<ReturnType<typeof api.listBookmarks>>) => void
    const mountFetchPromise = new Promise<Awaited<ReturnType<typeof api.listBookmarks>>>(
      (resolve) => {
        resolveMountFetch = resolve
      }
    )
    vi.mocked(api.listBookmarks).mockReturnValueOnce(mountFetchPromise)
    vi.mocked(api.createBookmark).mockResolvedValue({
      id: '2',
      url: 'https://example.com',
      title: 'New Site',
      createdAt: '2024-01-01T00:00:00.000Z',
    })

    render(<BookmarksPage />)
    await waitFor(() => expect(api.listBookmarks).toHaveBeenCalledTimes(1))

    vi.mocked(api.listBookmarks).mockResolvedValueOnce([
      {
        id: '2',
        url: 'https://example.com',
        title: 'New Site',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ])
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))

    expect(await screen.findByRole('link', { name: 'New Site' })).toBeInTheDocument()

    // The stale mount-time fetch finally resolves with the pre-add (empty) list — it must
    // not clobber the newer state that the add-triggered refresh already applied.
    resolveMountFetch([])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.getByRole('link', { name: 'New Site' })).toBeInTheDocument()
  })

  it('keeps the add-failure error visible even if a slower, earlier load succeeds afterward', async () => {
    let resolveMountFetch!: (value: Awaited<ReturnType<typeof api.listBookmarks>>) => void
    const mountFetchPromise = new Promise<Awaited<ReturnType<typeof api.listBookmarks>>>(
      (resolve) => {
        resolveMountFetch = resolve
      }
    )
    vi.mocked(api.listBookmarks).mockReturnValueOnce(mountFetchPromise)
    vi.mocked(api.createBookmark).mockRejectedValue(new Error('network error'))

    render(<BookmarksPage />)
    await waitFor(() => expect(api.listBookmarks).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))

    expect(await screen.findByText('Failed to add bookmark.')).toBeInTheDocument()

    // The slower, earlier mount fetch finally resolves successfully — it must not
    // silently clear the add-failure error the user is currently looking at.
    resolveMountFetch([])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.getByText('Failed to add bookmark.')).toBeInTheDocument()
  })

  it('signs out when the sign out button is clicked', async () => {
    render(<BookmarksPage />)
    await waitFor(() => expect(api.listBookmarks).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(signOut).toHaveBeenCalled()
  })

  it('shows an error message when adding a bookmark fails', async () => {
    vi.mocked(api.createBookmark).mockRejectedValue(new Error('network error'))
    render(<BookmarksPage />)
    await waitFor(() => expect(api.listBookmarks).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))

    expect(await screen.findByText('Failed to add bookmark.')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/BookmarkForm.test.tsx src/pages/BookmarksPage.test.tsx`
Expected: FAIL — `BookmarkForm` still renders a Title input and requires it to be non-empty before calling `onAdd`, so tests that no longer fill it in either get no `onAdd` call (submit guard blocks on empty title) or, for the "does not call onAdd when the URL is empty" case, may pass coincidentally; the majority of tests fail because `onAdd` is never invoked or the resulting list item never appears.

- [ ] **Step 3: Write the implementation**

Replace the full contents of `frontend/src/components/BookmarkForm.tsx`:

```typescript
import { useState } from 'react'
import type { FormEvent } from 'react'

interface BookmarkFormProps {
  onAdd: (bookmark: { url: string }) => void | Promise<void>
}

export default function BookmarkForm({ onAdd }: BookmarkFormProps) {
  const [url, setUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (submitting || !url.trim()) return
    setSubmitting(true)
    try {
      await onAdd({ url: url.trim() })
      setUrl('')
    } catch {
      // onAdd failed; leave the field populated so the user doesn't lose their input
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 p-4">
      <input
        id="bookmark-url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="URL"
        aria-label="URL"
        disabled={submitting}
        className="flex-1 border border-gray-300 rounded px-3 py-2"
      />
      <button
        type="submit"
        disabled={submitting}
        className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        Add bookmark
      </button>
    </form>
  )
}
```

In `frontend/src/pages/BookmarksPage.tsx`, change the `handleAdd` signature from:

```typescript
  async function handleAdd(bookmark: { url: string; title: string }) {
```

to:

```typescript
  async function handleAdd(bookmark: { url: string }) {
```

- [ ] **Step 4: Run tests and type-check to verify everything passes**

Run: `cd frontend && npx vitest run src/components/BookmarkForm.test.tsx src/pages/BookmarksPage.test.tsx && npx tsc --noEmit`
Expected: PASS, no type errors.

Then run the full frontend suite to confirm no regressions: `cd frontend && npm test`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/BookmarkForm.tsx frontend/src/components/BookmarkForm.test.tsx frontend/src/pages/BookmarksPage.tsx frontend/src/pages/BookmarksPage.test.tsx
git commit -m "feat(frontend): remove the title field, url is now the only bookmark input"
```

---

### Task 8: Update the e2e bookmarks test

**Files:**
- Modify: `e2e/tests/bookmarks.spec.ts`

**Interfaces:**
- Consumes: the full running stack from Tasks 1–7 (frontend, backend, Firestore/Auth emulators)

**Note:** These tests fill in `https://example.com` and, once the title field is removed, the backend will make a *real* network fetch to `https://example.com` to derive the title. This is an intentional trade-off: `example.com` is IANA's dedicated stable test domain with an unchanging `<title>Example Domain</title>`, so this is reliable in CI (which has outbound internet access) without needing a mock server — and a local mock server wouldn't work here anyway, since it would resolve to a loopback address that the SSRF guard (Task 1) deliberately blocks.

- [ ] **Step 1: Update the test file**

Replace the full contents of `e2e/tests/bookmarks.spec.ts`:

```typescript
import { test, expect } from '@playwright/test'
import { signIn } from '../fixtures/auth'
import { clearFirestore } from '../fixtures/firestore'

test.describe('bookmarks', () => {
  test.beforeEach(async ({ page }) => {
    await clearFirestore()
    await signIn(page)
  })

  test('adds a bookmark and shows it in the list', async ({ page }) => {
    await page.getByLabel('URL').fill('https://example.com')
    await page.getByRole('button', { name: 'Add bookmark' }).click()

    await expect(page.getByRole('link', { name: 'Example Domain' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Example Domain' })).toHaveAttribute(
      'href',
      'https://example.com'
    )
  })

  test('persists bookmarks across a reload', async ({ page }) => {
    await page.getByLabel('URL').fill('https://example.com')
    await page.getByRole('button', { name: 'Add bookmark' }).click()
    await expect(page.getByRole('link', { name: 'Example Domain' })).toBeVisible()

    await page.reload()
    await expect(page.getByRole('link', { name: 'Example Domain' })).toBeVisible()
  })
})
```

- [ ] **Step 2: Run the e2e suite**

This requires the local dev stack (Firestore/Auth emulators, backend, frontend) running per this project's local-dev setup. Run: `cd e2e && npx playwright test bookmarks.spec.ts`

If the local stack isn't available in your environment, this is verified by the `e2e` job in `ci.yml` when the PR is opened — matching how this repo's `2026-08-09-deploy-ci-design.md` spec already treats e2e verification (manual/CI-gated, not required to run in every local environment).

Expected: PASS (2 tests)

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/bookmarks.spec.ts
git commit -m "test(e2e): update bookmark creation test for url-only input and fetched title"
```
