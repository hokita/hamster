# Bookmark summary page — design

**Date:** 2026-08-11
**Status:** Approved

## Goal

Each bookmark gets its own page showing an AI-generated summary of the linked
article. The summary is produced by the Gemini API and is generated
automatically when a bookmark is saved, with a manual fallback for failures and
for the bookmarks that already exist.

The Gemini setup mirrors the sibling `eagle` repository: `GEMINI_API_KEY` held in
Secret Manager and injected into Cloud Run, model `gemini-3.1-flash-lite`, a 20s
timeout, and a bounded output-token budget.

## Decisions

| Question | Decision |
|---|---|
| What is summarized | The content of the page a single bookmark points at |
| When | Automatically right after the bookmark is saved |
| Where shown | A dedicated page at `/bookmarks/:id` |
| On failure | The bookmark still saves; the page offers a **Generate summary** button |
| Old bookmarks | Same button — it is the backfill path |
| Summary language | English, regardless of the source article's language |
| Summary shape | One short paragraph followed by three bullet points |
| UI copy | English throughout |

## Architecture

`POST /api/bookmarks` stays fast and unchanged — it fetches title and favicon
only. As soon as it returns, the frontend fires
`POST /api/bookmarks/:id/summary`, which fetches the article text and calls
Gemini. Every Gemini call therefore happens inside a real HTTP request.

This matters because the backend runs on Cloud Run with default CPU throttling
and `--min-instances 0`: work kicked off after a response has been sent is not
guaranteed CPU time. A server-side background job would need
`--no-cpu-throttling` (paying for idle CPU) or Cloud Tasks with a queue and
service-to-service auth — too much infrastructure for this app. Doing the
generation inline in the `POST` was the other option, but it would leave the
save button spinning for 10–25s on every bookmark, and a separate endpoint would
still be needed for the retry/backfill button.

One endpoint therefore serves three triggers: auto-after-save, retry after a
failure, and backfilling bookmarks saved before this feature existed.

## Data model

The Firestore bookmark document gains one optional field:

```ts
interface BookmarkDoc {
  id: string
  url: string
  title: string
  faviconUrl?: string
  summary?: string // new
  createdAt: string
}
```

There is no status field. A bookmark either has a summary or it does not; the
frontend already knows which generations it has in flight. `listBookmarks`
passes `summary` through exactly the way `faviconUrl` is handled — read
defensively, never part of the document validation, so documents written before
this field existed are not dropped.

## Backend

### API

| Endpoint | Behavior |
|---|---|
| `GET /api/bookmarks` | Unchanged, now includes `summary` when present |
| `POST /api/bookmarks` | Unchanged — metadata only, no Gemini call |
| `GET /api/bookmarks/:id` | New. Returns one bookmark, or 404 if unknown |
| `POST /api/bookmarks/:id/summary` | New. Fetches the article, calls Gemini, writes `summary`, returns `{ summary }` |

`POST /api/bookmarks/:id/summary` status codes:

- `200` — summary generated and stored
- `404` — no bookmark with that id
- `502` — the article could not be fetched, or Gemini returned an error
- `503` — `GEMINI_API_KEY` is not configured

The endpoint always regenerates. It does not short-circuit when a summary
already exists, which makes it double as "redo this summary".

### `services/safeFetch.ts` (extracted)

`metadataFetcher.ts` already owns the SSRF-safe fetch: DNS resolution, the
`ipGuard` private/loopback/link-local check, and a manual redirect loop bounded
at 3 hops. The article fetcher needs the same protection, and a second copy of a
security check is how the two copies drift apart.

`withSignal`, `isDisallowedHost`, and the redirect loop move into
`services/safeFetch.ts`, which exposes:

```ts
fetchAllowedUrl(url: string, signal: AbortSignal):
  Promise<{ response: Response; finalUrl: string } | null>
```

Returns `null` when the host is disallowed, the protocol is not http(s), the
redirect budget is exhausted, or a redirect has no `Location`.

`metadataFetcher.ts` keeps its head-end scanner, its 100,000-byte bound, its
charset resolution, and its icon extraction untouched — only the fetch preamble
moves. Its existing test suite is the safety net for the move; no behavior
change is intended.

### `services/articleFetcher.ts` (new)

```ts
fetchArticleText(url: string): Promise<string | null>
```

Uses `fetchAllowedUrl`. Requires an HTML content-type (the same
`text/html | application/xhtml+xml` check `metadataFetcher` uses). Reads at most
300,000 bytes, resolves the charset the same way `metadataFetcher` does, strips
`<script>`/`<style>` blocks and HTML comments, strips remaining tags, decodes
entities with the existing decoder, collapses whitespace, and truncates to
20,000 characters — the same `maxPromptChars` bound `eagle` uses. Returns `null`
when the fetch fails, the content-type is not HTML, or the extracted text is
empty.

It is deliberately not a readability engine. Leftover navigation and footer text
costs a few tokens and the model ignores it; a real content-extraction library
is not worth the dependency here.

The entity decoder and the charset resolver currently live as private functions
inside `metadataFetcher.ts`. They are exported from there for `articleFetcher`
to reuse rather than being duplicated or moved.

### `services/summarizer.ts` (new)

Thin wrapper over the `@google/genai` npm package, configured to match `eagle`:

- API key from `process.env.GEMINI_API_KEY`
- Model `gemini-3.1-flash-lite`
- 20 second timeout
- `maxOutputTokens: 1024`

```ts
summarize(title: string, text: string): Promise<string>
```

The prompt asks for a summary of the supplied article in **English regardless of
the language the article is written in**: one short paragraph, then exactly
three bullet points beginning with `- `. The article text is passed as content
to summarize, not as instructions.

Throws when the key is missing (route maps to 503) and when the API call fails
or returns empty text (route maps to 502).

### Configuration

`GEMINI_API_KEY` is added to:

- `backend/.env.example`
- the backend environment-variable table in `README.md`
- the Cloud Run deploy step in `.github/workflows/backend.yml`, as
  `--set-secrets "ALLOWED_EMAILS=ALLOWED_EMAILS:latest,GEMINI_API_KEY=GEMINI_API_KEY:latest"`

This requires a `GEMINI_API_KEY` secret to exist in Secret Manager in the
`hamster-52b093` project, with the Cloud Run service account granted
`roles/secretmanager.secretAccessor` on it — the same arrangement `eagle` uses.

It is deliberately **not** set in `backend/.env.e2e`, so end-to-end tests never
make a real Gemini call.

## Frontend

### Routing

Add `react-router-dom`. `App.tsx` keeps its auth gate unchanged; when a user is
signed in it renders a `BrowserRouter`:

- `/` → `BookmarksPage`
- `/bookmarks/:id` → `BookmarkPage`
- `*` → redirect to `/`

`firebase.json` already rewrites `**` to `/index.html`, so deep links and page
reloads work in production with no hosting change.

### `api.ts`

```ts
getBookmark: (id: string) => request<Bookmark>(`/api/bookmarks/${id}`)
generateSummary: (id: string) =>
  request<{ summary: string }>(`/api/bookmarks/${id}/summary`, { method: 'POST' })
```

`Bookmark` gains `summary?: string`.

### `BookmarkList`

The whole row is currently a single `<a href={url} target="_blank">`. That
anchor becomes a `<Link to={/bookmarks/${id}}>`, and the existing
`faArrowUpRightFromSquare` icon becomes a real sibling `<a>` pointing at the
original site — a sibling rather than a child, because nested anchors are
invalid HTML.

So: **clicking the title opens the summary page; clicking the icon opens the
site.** The icon's hover-only styling changes to always-visible, since it is now
the only way to reach the original page.

Rows whose id is in the new `summarizingIds` prop show `Summarizing…` in place
of the relative timestamp.

### `BookmarkPage`

Fetches `GET /api/bookmarks/:id` on mount. Renders the favicon, the title, the
hostname as an external link, and the relative saved-at time, followed by one of
four states:

- **loading** — the spinner pattern already used by `BookmarksPage`
- **summary present** — the paragraph and bullets
- **no summary** — "No summary yet." and a **Generate summary** button
- **generation failed** — "Couldn't generate a summary." and a **Try again**
  button

While a generation is in flight the button is disabled and shows a spinner.
Load failures (including 404) use the existing red banner pattern, with a link
back to the list.

Summary rendering needs no markdown dependency: split the text on newlines,
gather consecutive lines beginning with `-` or `・` into a `<ul>`, and render
everything else as `<p>`. That is exactly the shape the prompt requests, and the
fallback for unexpected output is simply more paragraphs.

### Auto-generation on save

`BookmarksPage.handleAdd` currently discards the bookmark that `createBookmark`
returns. It will keep the returned `id`, add it to `summarizingIds`, call
`api.generateSummary(id)` without awaiting it, and refresh the list once it
settles — removing the id from `summarizingIds` either way. A failed generation
is silent on the list page; the bookmark's own page is where the retry lives.

**Known race:** opening a bookmark while its summary is still generating shows
"No summary yet" with a Generate button, and pressing it starts a second
generation. Last write wins and the two generations produce equivalent output,
so it self-corrects. Building status plumbing to close a race this narrow is not
worth the complexity.

## Testing

Red/green TDD throughout — failing test first, then the minimal code to pass.

**Backend (vitest)**

- `safeFetch` — host allowed/disallowed, redirect following, redirect budget
  exhausted, missing `Location`, non-http(s) protocol
- `metadataFetcher` — existing suite must stay green across the extraction
- `articleFetcher` — script/style/comment stripping, tag stripping, entity
  decoding, whitespace collapsing, byte bound, character truncation, non-HTML
  content-type rejected, empty result → `null`
- `summarizer` — `@google/genai` mocked: success, API error, empty response,
  missing API key
- `routes/bookmarks` — `GET /:id` 200 and 404; `POST /:id/summary` 200, 404,
  502 (fetch failure and Gemini failure), 503 (no key), and that it persists

**Frontend (vitest + Testing Library)**

- `BookmarkPage` — loading, summary with bullets rendered as a list, empty state
  with Generate, failure state with Try again, 404 handling
- `BookmarkList` — title links to `/bookmarks/:id`, icon links to the site,
  `Summarizing…` indicator
- `BookmarksPage` — auto-triggers generation with the id returned by
  `createBookmark`, and still refreshes when generation fails
- `App` — routes resolve for signed-in users; signed-out users still see
  `LoginPage`

**e2e (Playwright)**

- Add a bookmark, click its title, land on `/bookmarks/:id`, see the bookmark's
  title and the "No summary yet" state (no `GEMINI_API_KEY` in the e2e
  environment, so no real Gemini call and no network flakiness)

## Out of scope

- Summarizing PDFs, videos, or anything that is not an HTML page
- Re-summarizing on a schedule or when a page's content changes
- Bulk backfill of all existing bookmarks in one action
- Storing the fetched article text
- Editing a summary by hand
