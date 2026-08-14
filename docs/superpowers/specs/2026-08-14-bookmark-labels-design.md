# Bookmark labels — design

**Date:** 2026-08-14
**Status:** Approved

## Goal

Each bookmark gets a small set of topic labels, generated automatically by
Gemini when the bookmark's summary is generated. Labels help scanning the list
("what is this about?") without opening the page. They are informational only —
filtering by label is a possible later feature, not part of this one.

## Decisions

| Question | Decision |
|---|---|
| What model | `gemini-3.5-flash-lite` — labelling is a cheaper task than summarizing, so it gets the lighter tier (originally specified as `gemini-3.6-flash-lite`, which does not exist — see Amendments) |
| When generated | Inside the existing `POST /api/bookmarks/:id/summary` flow, from the same fetched article text |
| Vocabulary | Prefer reusing labels already present on other bookmarks; invent a new label only when nothing fits |
| Label language | English, regardless of the article's language — same rule as summaries |
| How many | 1–5 per bookmark |
| Shape | Short lowercase strings, e.g. `typescript`, `web performance` |
| Where shown | Chips on each row of the bookmark list and on the bookmark's detail page |
| On failure | Silent — a labels failure never fails the summary request; the bookmark just has no labels until the next regeneration |
| Old bookmarks | The existing **Generate summary** button regenerates both, so it doubles as the labels backfill path |

## Data model

The Firestore bookmark document gains one optional field:

```ts
interface BookmarkDoc {
  id: string
  url: string
  title: string
  faviconUrl?: string
  summary?: string
  labels?: string[] // new
  createdAt: string
}
```

No status field, mirroring `summary`. `toBookmark` passes `labels` through the
same way it handles `faviconUrl` and `summary`: read defensively (must be an
array of strings), never part of the document validation, so documents written
before this field existed are not dropped.

## Backend

### `services/labeler.ts` (new)

Sibling of `summarizer.ts`, same structure:

- API key from `process.env.GEMINI_API_KEY`; throws
  `SummarizerUnavailableError`-style when missing (in practice the route only
  reaches the labeler when the summarizer is configured, since both use the
  same key)
- Model `gemini-3.6-flash-lite`
- 20 second timeout via `withSignal` + `abortSignal`, same as the summarizer
- `thinkingLevel: MINIMAL` and a generous `maxOutputTokens` (labels cost tens
  of tokens; the budget exists so thinking tokens can never starve the output,
  the failure mode PR #13 fixed for summaries)
- JSON output: `responseMimeType: 'application/json'` with a `responseSchema`
  of an array of strings, so parsing is `JSON.parse` + validation, not regex

```ts
generateLabels(title: string, text: string, existingLabels: string[]): Promise<string[]>
```

The system instruction (trusted channel, same injection-hardening pattern as
the summarizer) asks for 1–5 short lowercase English topic labels for the page,
tells the model to prefer labels from the supplied existing list and only
invent a new one when none fits, and to treat everything in the user turn as
content, never instructions. The user turn contains the fenced untrusted title
and body — identical fencing to `buildContents` in the summarizer — plus the
existing-labels list, which is app data, not page content, but rides in the
user turn since it is just context.

The result is normalized before returning: lowercase, trimmed, empties and
non-strings dropped, deduplicated, anything longer than 40 characters dropped,
capped at 5. An empty array after normalization is an error (retryable via the
existing button), not a stored value.

### `services/firestore.ts`

Two additions:

```ts
updateLabels(id: string, labels: string[]): Promise<void>
listAllLabels(): Promise<string[]>
```

`listAllLabels` reads the bookmarks collection selecting only the `labels`
field and returns the sorted, deduplicated union. A dedicated labels collection
would avoid the scan, but at single-user scale (hundreds of bookmarks) the
scan is one cheap query and there is no second source of truth to keep
consistent.

### `routes/bookmarks.ts`

Inside the existing `generateSummary` flow, after the summary is stored:

```ts
try {
  const existing = await db.listAllLabels()
  const labels = await generateLabels(bookmark.title, text, existing)
  await db.updateLabels(bookmark.id, labels)
} catch (error) {
  console.error(`label generation failed for bookmark ${bookmark.id}:`, error)
}
```

Everything about the endpoint's contract is unchanged: same status codes, same
`{ summary }` response body, same in-flight dedup map. Labels reuse the article
text already fetched for the summary — no second fetch. Because the endpoint
always regenerates, labels are re-derived on every retry, which is both the
failure-recovery path and the backfill path for old bookmarks.

Ordering note: labels run after the summary is stored, so a labels failure can
never cost the already-paid summary, and a summary failure skips the labels
call entirely (no article text worth labelling a page we could not summarize).

## Frontend

`Bookmark` in `api.ts` gains `labels?: string[]`. No new API calls — labels
arrive on the existing bookmark responses, appearing in the list after the
next refetch, exactly as summaries do today.

### `BookmarkList`

Each row with labels renders them as a row of small chips (rounded, muted
background, small text — consistent with the existing Tailwind styling) under
the title. Rows without labels render exactly as today.

### `BookmarkPage`

The detail page shows the same chips near the title/hostname block. No new
states: labels are either present or absent, and the existing
generate/retry button already covers regeneration.

## Testing

Red/green TDD throughout — failing test first, then the minimal code to pass.

**Backend (vitest)**

- `labeler` — `@google/genai` mocked: happy path returns normalized labels;
  prompt includes the existing labels; JSON parsing of the response;
  normalization (lowercasing, dedup, cap at 5, long/empty entries dropped);
  empty result throws; missing API key throws; non-JSON response throws
- `firestore` — `updateLabels` writes the array; `listAllLabels` returns the
  deduplicated union and tolerates documents without the field; `toBookmark`
  passes `labels` through and drops non-string-array values
- `routes/bookmarks` — labels stored after a successful summary; a labels
  failure still returns 200 with the summary; a summary failure never calls
  the labeler; existing suite stays green

**Frontend (vitest + Testing Library)**

- `BookmarkList` — chips render for a bookmark with labels; no chip container
  for a bookmark without
- `BookmarkPage` — chips render on the detail page when present

**e2e (Playwright)**

- No new e2e: the e2e environment has no `GEMINI_API_KEY`, so labels never
  generate there; the existing flows must simply stay green.

## Out of scope

- Filtering or searching by label
- Manually adding, editing, or deleting labels
- A separate labels endpoint or per-label retry UI
- Bulk backfill of all existing bookmarks in one action
- Migrating or renaming labels across bookmarks

## Amendments (2026-08-14, post adversarial review)

- `POST /api/bookmarks/:id/summary` now returns `{ summary, labels }` when labels were
  generated (labels key omitted on a labels failure) — the response already waited for the
  labels write, so returning them lets the detail page render chips without a refetch.
- The labeler timeout is 10s (was 20s) to bound what a hung labels call can add to a
  summary request.
- The existing-labels list is fenced in the prompt like the page content, and labels
  containing a quote or newline are dropped before prompting (fence-escape guard).
- `listAllLabels` caps the vocabulary at the 100 most frequent labels.
- The detail page polls until labels arrive (bounded budget) and merges labels from the
  generate response.

## Amendment (2026-08-15, production incident)

- The model is `gemini-3.5-flash-lite`, not `gemini-3.6-flash-lite` as originally
  specified. The 3.6 family has no flash-lite variant: the original id 404'd on every
  production call, and because label failures are swallowed by design, the feature
  silently produced no labels at all until Cloud Run logs surfaced the error. The
  corrected id was validated against the live `ListModels` endpoint and with a real
  `generateContent` call using the labeler's exact config before shipping. Lesson
  recorded: a model id that only ever runs against a mocked SDK and a key-less e2e
  environment is unvalidated until it hits the real API.
