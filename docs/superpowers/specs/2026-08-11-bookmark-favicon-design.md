# hamster: Bookmark Favicon Retrieval — Design

## Overview

Bookmarks currently render a generic gray link glyph in the list. This spec adds per-site favicons, extending the existing server-side title fetch to also discover the page's icon and storing its URL on the bookmark. The browser loads the image directly; the current glyph remains the fallback whenever an icon is missing or fails to load.

The favicon rides along on the fetch that already happens for the title — one request, one parse, two pieces of data. No new network round-trip is added to the create path.

## Goals

- Each bookmark shows its site's favicon in the list.
- Bookmarks created before this feature get an icon too, with no migration or backfill.
- No new dependencies, no image storage, no third-party icon service.
- A missing, broken, or hostile icon degrades to today's generic glyph rather than breaking the row.

## Non-goals

- **Storing icon bytes.** Only a URL string is persisted. Downloading and hosting the images (as a data URI or in Cloud Storage) was considered and rejected as disproportionate to the benefit.
- **Third-party icon services** (e.g. Google's `s2/favicons`). Rejected because it would disclose every bookmarked host to a third party.
- **Verifying the icon exists server-side.** The `/favicon.ico` fallback is recorded optimistically; a HEAD request per bookmark isn't worth the added latency and failure paths when the frontend already handles a broken image.
- **Backfilling `faviconUrl` onto existing docs.** The frontend derives a default instead.
- **Icon size/quality selection.** No parsing of `sizes` attributes to pick an optimal resolution.

## Storage schema change

`BookmarkDoc` gains an optional `faviconUrl?: string`. Two backward-compatibility rules are load-bearing:

- **Write.** Firestore rejects `undefined` values, so `createBookmark` omits the field entirely when no icon was resolved — it never writes `undefined` or an empty string.
- **Read.** `listBookmarks` currently skips any document failing its type checks. `faviconUrl` must **not** join that validation: every pre-existing document lacks the field, and gating on it would silently drop the entire existing bookmark list. It is read only when it is a string, and left absent otherwise.

The API response shape gains the same optional field. No Firestore index or rules changes are needed.

## Backend metadata extraction

`backend/src/services/titleFetcher.ts` is renamed to `metadataFetcher.ts`, and `fetchTitle(url)` becomes:

```ts
fetchMetadata(url: string): Promise<{ title: string | null; faviconUrl: string | null }>
```

As before, it never throws for expected failure modes; both fields independently degrade to `null`.

### Read-loop correction (required, not incidental)

`readBoundedBytes` currently breaks out of its read loop as soon as `<title>` matches. Because `<link rel="icon">` commonly appears *after* `<title>` within `<head>`, that early exit would truncate the icon declaration away on most real pages — the favicon would silently never be found.

The exit condition changes to the end of the head (`</head>`, or the start of `<body`), still bounded by the existing `MAX_BYTES` cap. The same latin1-decoding rationale documented at the current early-exit site still applies: these are ASCII-range markers that decode identically regardless of the page's real charset, which isn't resolved until the full bounded body is read.

### Icon resolution rules

1. **Candidate scan.** Scan every `<link>` tag in the decoded head and parse its attributes, rather than assuming `rel` precedes `href` — attribute order varies in the wild. Select on a whitespace-separated `rel` token of `icon` (which covers `shortcut icon`), falling back to `apple-touch-icon` when no `icon` link exists. First match wins.
2. **Resolution base.** Resolve a relative `href` against the **final** URL after redirects, so a shortlink yields the destination's icon rather than the shortener's.
3. **Scheme allowlist.** Discard anything that doesn't resolve to `http:` or `https:`, falling through to the origin default. This excludes `javascript:` and unbounded `data:` URIs from both Firestore and the eventual `<img src>`.
4. **Origin default.** When no usable declared icon is found — no `<link>`, a rejected scheme, a non-HTML content type, or an unparseable body — return `origin + "/favicon.ico"` derived from the final URL. The favicon therefore does not depend on the page being parseable HTML, unlike the title.
5. **Hard failures.** If the *bookmarked* URL's host fails the existing `ipGuard` SSRF check, its own scheme isn't http(s), the redirect cap is exceeded, or the fetch throws or times out, `faviconUrl` is `null` — the same conditions that already yield a `null` title. (Distinct from rule 3, which rejects only the declared `href` and still falls through to the origin default.)

### Security note

The stored `faviconUrl` is fetched by the **user's browser**, not by the backend, so `ipGuard` never inspects it. The scheme allowlist in rule 3 is what prevents a hostile page from steering an `<img src>` somewhere dangerous. The DNS-rebinding limitation documented in the auto-title spec is unchanged by this work.

## Route change

`backend/src/routes/bookmarks.ts` collapses to a single call, with the existing `?? url` title fallback and all current validation and status codes unchanged:

```ts
const { title, faviconUrl } = await fetchMetadata(url)
const bookmark = await db.createBookmark(url, title ?? url, faviconUrl)
```

## Frontend rendering

`Bookmark` in `frontend/src/api.ts` gains the same optional `faviconUrl?: string`.

In `BookmarkList`, the existing 7×7 icon container keeps its exact dimensions and remains the layout anchor — only its contents change, so no row reflows between the icon loading, failing, or being absent.

Source resolution:

```ts
const iconSrc = bookmark.faviconUrl ?? originFaviconOf(bookmark.url)
```

`originFaviconOf` mirrors the `try/catch` shape of the existing `hostnameOf`, returning `null` for URLs that `new URL()` rejects. A `null` source renders today's generic glyph. This derivation is what gives pre-existing bookmarks an icon with no migration; a stored `faviconUrl` then only differs from the default when the page declared an explicit icon or redirected to another origin.

Three attributes on the `<img>`:

- `alt=""` and `aria-hidden` — the anchor's existing `aria-labelledby` already supplies its accessible name, and an icon filename leaking into it would be noise.
- `referrerPolicy="no-referrer"` — bookmarking a page shouldn't announce this app's URL to that host.
- `loading="lazy"`.

Load failures are tracked in a `useState<Set<string>>` of bookmark ids; `onError` adds the id, and the render falls back to the `faLink` glyph. Because the `/favicon.ico` default is recorded optimistically, this path handles a routine stream of 404s — it is normal operation, not an edge case.

## Testing

Per this project's TDD workflow, every case below is written as a failing test first.

- **`metadataFetcher.test.ts`** (renamed from `titleFetcher.test.ts`; all 22 existing cases carry over against the new return shape) — an icon declared *after* `</title>` is still found (the regression the read-loop correction fixes); absolute and relative `href` resolution; `rel="shortcut icon"`; `href` appearing before `rel`; `apple-touch-icon` fallback; a redirect chain taking the icon from the final origin; non-HTML content type still yielding the origin default; a non-http(s) `href` rejected in favor of the origin default; a blocked host yielding `null`.
- **`firestore.test.ts`** — `faviconUrl` is persisted when present; the field is omitted entirely (not `undefined`) when null; documents lacking the field are still returned by `listBookmarks`.
- **`bookmarks.test.ts`** — `POST` passes the fetched `faviconUrl` through to `createBookmark`; existing title-fallback cases updated to the new `fetchMetadata` mock shape.
- **`BookmarkList.test.tsx`** — an explicit `faviconUrl` is used as the image source; the origin default is derived when the field is absent; `onError` restores the generic glyph; a malformed URL still doesn't throw (extending the existing guard at the current line 35).

## Sequencing notes

- No new dependencies; native `fetch`, `URL`, and the existing `ipGuard` are sufficient.
- The rename `titleFetcher.ts` → `metadataFetcher.ts` touches the route import and the test file name; no other call sites exist.
