# Muse connection (MCP server) — design

Date: 2026-11-21 · Status: design approved by the owner on 2026-11-21. Details marked **my call** were
settled while writing this doc and can be overruled when the plan is reviewed.

## Why

The owner talks to their agent Muse and wants Muse to work with their hamster bookmarks: find them,
read them, save links, mark them read and ask for a summary. Muse does its own thinking (chat,
translation), so hamster only reads and saves, and Gemini is never paid twice for the same answer.

## Goals

- An MCP server at `/mcp` in the existing `hamster-backend` that Muse adds as a custom connector:
  URL `<backend>/mcp`, header `Authorization: Bearer <token>`.
- Exactly five tools: find bookmarks, open a bookmark, save a link, mark read/unread, summarize.
- Saving and summarizing through Muse behave the way they do in the app.

## Non-goals

- No chat, translate or delete tools.
- No change to the app's sign-in, REST API or UI. The REST API keeps accepting only the signed-in app.
- No OAuth. A connector that can't send a custom `Authorization` header can't connect.
- No change to owlet (only its pattern is copied).

## Anti-goals (a failure even if it works)

- The token in the repo, in logs or in a command's output.
- Muse being able to run up the Gemini bill: summaries through Muse are capped.
- A Muse summary and an app summary for the same bookmark running at once and paying twice.

## Approaches

1. **`/mcp` inside the existing backend (chosen),** the same way owlet does it. It reuses the
   Firestore access, the summary code and its de-duplication, and the deploy. The only new
   infrastructure is one secret.
2. **A separate MCP service (rejected).** It would need a second Cloud Run deploy, its own auth setup
   and either a copy of the summary code or calls into the backend over HTTP, which loses the
   in-process de-duplication. That is more to run and gives nothing in return.

## How it works

**Auth and limits.** These are copied from owlet. `apiTokenMatcher` compares sha256 digests of both
sides with `timingSafeEqual`, needs at least 43 characters, and turns `/mcp` off when the variable is
unset. `apiTokenAuth` answers 401 `{"error":"Invalid token"}` to anything other than the token. The
token is `HAMSTER_MCP_TOKEN`, read from Secret Manager secret `hamster-mcp-token`. The deploy adds
it only when the repo variable `HAMSTER_MCP_TOKEN_SECRET` is set, so deploys keep working before the
secret exists. Mounted as `app.all('/mcp', apiTokenAuth, handler)`, the SDK runs stateless (a fresh
server per request) on `@modelcontextprotocol/server` 2.4.0 with `@modelcontextprotocol/node` 2.1.2
and `zod` 4.6.7, the same versions as owlet and the latest at the time of writing.

- Every tool call takes from an in-memory limiter of **60 calls an hour** (**my call**: owlet uses
  30, but one find plus a few opens is a normal turn here). Protocol requests aren't counted.
- Summaries started through Muse are limited to **10 an hour** (the owner's call). **My call:** this
  count is kept in Firestore, not in memory, so it really is 10 across both Cloud Run instances.
  Only a call that *starts* a run uses up a slot. Joining a run already in progress, a refusal and a
  rate-limit rejection don't.

**Shared summary code.** **My call:** the generation logic (`generateSummary`, the video branch, the
`inFlight` map, the error classes and the mapping from error to status) moves out of
`routes/bookmarks.ts` into `services/summaryGeneration.ts`. That file gets one generator that
`createApp` builds once and passes to both the router and the MCP server. A Generate in the app and
a summarize from Muse for the same bookmark then join one run. The router keeps its exact behavior,
and its existing tests are the proof.

**Tools** (names are **my call**; the plan has the full schemas and the descriptions Muse sees):

| Tool | Does |
|---|---|
| `find_bookmarks` | Optional `query` (every word must appear in the title, URL, labels or summaries; case-insensitive, NFKC-normalized so full-width and half-width forms match, Japanese matched as a substring), `label` (exact, case-insensitive), `unread` (true: unread only, false: read only). Newest first, `limit` 1–50 (default 20) and `offset`, returning `total` and `nextOffset`. Each item has its id, title, URL, labels, `shortSummary`, `isRead`, `hasSummary` and `createdAt`; the full summary is left out. |
| `open_bookmark` | Everything about one bookmark: full summary, short summary, labels, read state, `videoSummaryState`, and the stored video transcript if there is one (**my call:** cut at 100,000 characters, with `transcriptTruncated: true`). |
| `save_link` | Saves a link the way the app does (title from oEmbed or metadata, favicon), then summarizes it the way the app does (see below). A link that's already saved isn't added again: the existing bookmark comes back with `created: false` and no new summary. |
| `set_read` | `{id, isRead}`, idempotent like `PUT /:id/read`. |
| `summarize_bookmark` | The same path as Generate: always a fresh summary, the 60-minute video limit, and a refusal while a video is already running on another instance. It waits up to **45 s** (the owner's call). If the run isn't finished by then, it answers "Still summarizing…" and the run carries on, with its state already stored as `videoSummaryState`. |

**What saving does in the app today (checked).** `POST /api/bookmarks` only saves. The frontend
(`BookmarksPage.handleAdd`) then calls `POST /:id/summary` in the background, without awaiting it,
and that summary also generates the labels. The app does **not** check for duplicates. So
`save_link` = save, then the same summary run that `summarize_bookmark` starts, which uses up one of
the 10 hourly slots. It waits up to the same 45 s, because Cloud Run only reliably runs code while a
request is open. When the budget is used up, the link is still saved and the reply says the summary
wasn't started. Duplicate check (**my call**): the trimmed URL must match exactly, and YouTube links
match by video id, so `youtu.be/X` and `watch?v=X` are the same video. Two saves of the same link at
the same moment on one instance share one save. Across instances, a duplicate can still slip through,
the same gap the `inFlight` comment already accepts. The app's own save is unchanged.

**Errors.** A failure comes back as an MCP tool error (`isError: true`) with a plain message, for
example "No bookmark with id …", "This video is longer than 60 minutes, so it can't be summarized",
"Rate limit reached: try again in N seconds" or "Summary limit reached (10 an hour): try again in N
minutes". Internal details go only to the logs, as the REST routes already do. Ids are checked
against a strict pattern before they reach Firestore, because `doc('a/b')` throws.

## Constraints and risks

- **Cloud Run CPU (owner decision needed).** The service runs with request-based billing, the default
  setting where CPU is only allocated while a request is open. I checked it with a read-only
  `gcloud run services describe`. A video run that outlives the 45 s wait has no open request
  holding it up: its CPU is throttled to almost nothing and the instance may be stopped. The stored
  `running` state then goes stale after 11 minutes, and the next summarize starts the video again,
  paid. The app has the same gap today only if the tab is closed mid-run. Fix options: turn off CPU
  throttling with `--no-cpu-throttling` (instance-based billing, a small cost while an instance is
  warm), or accept the gap. The plan includes the change as an optional task until the owner decides.
- The Muse connector's own request timeout isn't known. It's assumed to be above 45 s, and the e2e
  test and the Muse check after deploy confirm it.
- Merging to main deploys to production. No PR is opened until the plan is approved.

## Left to the builder

The exact wording of the internal log lines, the file split inside `src/mcp/`, and the test fixture
data.
