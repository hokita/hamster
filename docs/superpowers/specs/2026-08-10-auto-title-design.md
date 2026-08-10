# hamster: Automatic Bookmark Title Retrieval — Design

## Overview

Currently, adding a bookmark requires the user to manually type both a URL and a title. This spec changes bookmark creation to require only a URL — the backend fetches the target page server-side and extracts its `<title>` automatically, removing the title field from the form entirely.

## Goals

- Bookmark creation requires only a URL; title is derived automatically.
- No Firestore schema change — `BookmarkDoc` keeps its existing `{ id, url, title, createdAt }` shape.
- Guard the new server-side fetch against SSRF, since the backend (Cloud Run) will now fetch arbitrary user-submitted URLs and could otherwise be tricked into reaching internal/cloud-metadata addresses (e.g. `169.254.169.254`).
- If a title can't be determined for any reason, fall back to using the URL itself as the title rather than failing bookmark creation.

## Non-goals

- Manual title override / editing — the title field is removed from the form entirely, not made optional. Editing bookmarks after creation is out of scope (matches current app, which has no edit flow at all).
- Asynchronous/background title backfill — creation is synchronous; the request waits for the fetch (bounded by a timeout) before responding.
- Full HTML parsing (no `cheerio`/`jsdom` dependency) — a bounded regex extraction of `<title>` is sufficient for this use case.
- A future LLM-generated page summary feature was mentioned as a later addition. This spec doesn't build toward it, but note that a `summary` field would be a purely additive schema change, independent of this design.

## API contract change

`POST /api/bookmarks` request body changes from `{ url, title }` (both required) to `{ url }` only. Any `title` field sent by a client is ignored. Response shape is unchanged: `{ id, url, title, createdAt }`.

## Backend title-fetch flow

New module `backend/src/services/titleFetcher.ts` exporting `fetchTitle(url: string): Promise<string | null>`. Returns `null` on any failure path below — it never throws for expected failure modes; the caller falls back to using the URL as the title.

1. **SSRF guard.** Resolve the URL's hostname via `dns.lookup`. Reject (return `null`) if the resolved address falls in a private/loopback/link-local/reserved range: IPv4 `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.0.0/16`, `0.0.0.0/8`; IPv6 `::1`, `fc00::/7`, `fe80::/10`, and IPv4-mapped IPv6 equivalents of the above. Only `http`/`https` schemes proceed (already enforced in the route handler; re-checked here as defense in depth).
2. **Fetch.** `fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000) })`.
3. **Redirect handling.** On a 3xx response, re-resolve and re-run the SSRF guard against the `Location` target before following it manually. Cap at 3 redirect hops total; exceeding the cap or hitting a disallowed IP at any hop aborts and returns `null`.
4. **Content-Type check.** If the final response's `Content-Type` isn't HTML-like (`text/html`, `application/xhtml+xml`), return `null` without reading the body.
5. **Bounded read.** Stream the response body, stopping once `</title>` is found or a 100KB cap is reached, whichever comes first — avoids pulling large pages fully into memory.
6. **Extraction.** Match `<title[^>]*>([^<]*)<\/title>` (case-insensitive) against the accumulated text. Decode the common HTML entities (`&amp; &lt; &gt; &quot; &#39;`), collapse internal whitespace, and trim. An empty result after trimming, or no match at all, returns `null`.

The route handler (or `createBookmark`) calls `fetchTitle(url)`; a `null` result falls back to the URL string itself as the title.

### Residual risk: DNS rebinding

The guard resolves the hostname once (step 1) and `fetch()` resolves it again independently when connecting — a small window exists where an attacker controlling their own DNS with a very low TTL could return a public IP to the guard and a private/internal IP to the actual connection. Closing this fully would require pinning the validated IP (e.g. a custom fetch dispatcher or connecting directly to the resolved IP with an explicit `Host` header), which is a larger change than this feature warrants. Accepted as a known limitation given `POST /api/bookmarks` is already behind `authMiddleware`'s verified-email allowlist — only the app's own authenticated owner can reach this endpoint, not the general internet.

## Route & frontend changes

- **`backend/src/routes/bookmarks.ts`** — `POST /` validates only `{ url: string }` (existing http/https regex check unchanged). Calls `fetchTitle(url)`, falls back to `url` on `null`, then calls `db.createBookmark(url, title)` as before. The existing 400 responses for missing/non-string `title` are removed, since title is no longer client-supplied.
- **`frontend/src/components/BookmarkForm.tsx`** — remove the title `<input>` and its `useState`; form becomes URL-only; calls `onAdd({ url })`. The existing `submitting` state (which already disables the form during the request) covers the added latency from server-side fetching — no new loading UI needed.
- **`frontend/src/api.ts`** — `createBookmark` signature becomes `(bookmark: { url: string }) => Promise<Bookmark>`.
- **`BookmarkList`** — unchanged; still renders `title` from the returned object.

## Testing

Per this project's TDD workflow, each case below is written as a failing test first:

- **`titleFetcher.test.ts` (new)** — extracts title from a plain HTML fixture; decodes entities; returns `null` for: no `<title>` tag, non-HTML content-type, DNS resolving to a private/loopback/link-local IP, redirect chain exceeding the hop cap or targeting a disallowed IP, timeout, and generic network error.
- **`bookmarks.test.ts`** — update existing `POST /api/bookmarks` tests to drop `title` from request bodies; remove the now-obsolete "title missing/not a string" 400 cases; add a case asserting `db.createBookmark` is called with the fetched title, and a case where `fetchTitle` resolves `null` and the URL is used as the fallback title. Mock `../services/titleFetcher`.
- **`BookmarkForm.test.tsx`** — remove title-input assertions; update the submit test to assert `onAdd` is called with `{ url }` only.
- **`api.test.ts`** — update `createBookmark` call-shape assertions to the new single-field body.

## Open items / sequencing notes

- No Firestore index or rules changes are needed — this is purely an application-layer change.
- No new dependencies — Node 24's native `fetch` and `dns.lookup` are sufficient; no HTML parser library is added.
