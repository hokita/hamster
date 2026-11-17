# YouTube Video Summaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A saved public YouTube video gets the same full summary, short summary, labels and chat as an
article. Gemini watches the video once, and the stored transcript serves everything afterwards.

**Architecture:**
- New backend modules:
  - `youtube.ts`: URL parsing and duration parsing.
  - `youtubeOembed.ts`: the title at save time.
  - `youtubeDataApi.ts`: the free length and availability check.
  - `videoSummarizer.ts`: one streamed Gemini call that returns `{status, transcript, summary}`.
- `generateSummary` in `routes/bookmarks.ts` gains a video branch behind the `YOUTUBE_SUMMARIES=on`
  switch. The article path is unchanged.
- Transcripts live in a `transcripts/{bookmarkId}` collection. A `videoSummaryState` field on the
  bookmark drives honest "running" and "failed" UI.

**Tech Stack:** Express + TypeScript (commonjs, ES2020), vitest + supertest, `@google/genai ^2.16.0`,
Firestore Admin SDK, React + vitest/RTL, Playwright e2e against the Firestore emulator, Cloud Run via
GitHub Actions, gcloud.

**Spec:** `docs/superpowers/specs/2026-11-17-youtube-summaries-design.md`. Read §5–§13 and §15 before
starting any task. Section numbers below refer to it.

## Global Constraints

- Red/green TDD in every task: a failing test first, then the minimal code, then green. Gemini, oEmbed,
  the Data API, Firestore and `fetch` are always mocked. No test makes a network call.
- Never print, log or commit a secret (`GEMINI_API_KEY`, `YOUTUBE_API_KEY`). No `set -x`, no
  `echo $KEY`. Logs carry only the bookmark id, video id, error class or status, and token counts. Never
  log transcript or summary text.
- Model `gemini-3.8-flash`, `ThinkingLevel.LOW`. Video call: `maxOutputTokens 49_152`, timeout
  `480_000` ms, low media resolution, `videoMetadata.endOffset '3600s'`.
- Length limit `3600` s inclusive: 3600 is allowed, 3601 is refused.
- Canonical URL `https://www.youtube.com/watch?v=<id>`. The id matches `^[A-Za-z0-9_-]{11}$`. Only the
  canonical URL, built from the validated id, is sent to Gemini, oEmbed or the Data API.
- The stored bookmark `url` is never changed.
- Kill switch: the video path runs only when `process.env.YOUTUBE_SUMMARIES === 'on'`. When it is off,
  YouTube links take today's article path for summary and chat. The oEmbed title at save time is
  always on.
- Error codes, exactly: `video_too_long`, `video_unavailable`, `video_live`, `video_no_content`,
  `video_length_unknown`, `video_summary_running`, plus `generic`, which is used only in the stored
  state.
- `videoSummaryState`: `{ status: 'running' | 'failed', code?: <code>, updatedAt }`. A `running` state
  is stale after `660_000` ms (11 min).
- UI copy, exactly:
  - `video_too_long`: "This video is longer than 60 minutes, so it wasn't summarized."
  - `video_unavailable`: "Couldn't watch this video. Only public YouTube videos can be summarized — it
    may be private, unlisted, members-only, age-restricted or removed."
  - `video_live`: "This is a live or upcoming stream. Try again after it has ended."
  - `video_no_content`: "This video has no speech or on-screen text to summarize."
  - `video_length_unknown`: "Couldn't check this video's length. Try again later."
  - Running: "Summarizing the video — this can take a few minutes."
  - `generic` / stale: today's "Couldn't generate a summary."
- Article behaviour must not change. Every existing test must stay green and unmodified, except where a
  task explicitly changes a signature with a default.
- Match the surrounding code style: comments explain *why*, as densely as the neighbouring code does.
- GCP project `hamster-52b093`, region `asia-northeast1`, service `hamster-backend` (from
  `.github/workflows/backend.yml`).
- Commit after each task on `feat/youtube-summaries`. Never push to `main`. Never merge. Merging to
  `main` deploys to production.

## Review Focus

1. **Opening a video bookmark right after saving it:** the page may load before the server writes
   `running`. It must switch from the 90 s article poll to the 10-minute video poll once it sees
   `running`, rather than give up after 90 s. Test: Task 10, "adopts a running state that appears
   mid-poll and keeps polling past 90 s".
2. **Bookmark deleted while its video is being watched:** the batch write must fail without leaving an
   orphan transcript or recreating the bookmark. The failed-state write must not throw past the route.
   Tests: Task 6, "saveVideoSummary fails as a whole on a deleted bookmark"; Task 8, "deleted mid-watch
   answers 500 and does not throw from the state write".
3. **Regenerate on a video that has since gone private:** a stored transcript means no Data API check
   and no video call, so Regenerate still works. Test: Task 8, "regenerate from a stored transcript
   skips the Data API and never watches".
4. **Real-world share links:** the id must be found in links like `youtu.be/<id>?si=…&t=42`,
   `m.youtube.com/watch?feature=share&v=<id>` (`v` not the first parameter) and `/shorts/<id>?feature=share`.
   Test: Task 1 table.
5. **Gemini wraps its JSON in a ```json fence or adds prose:** the result must fail as `generic`, with
   nothing stored, unless it's a single fence around valid JSON, which is unwrapped. Test: Task 5,
   "unwraps a single json fence; rejects prose around JSON".

---

### Task 0: One-time GCP setup (worker runs gcloud; no repo changes)

Runs on the user's already-authenticated `gcloud`, which the user authorised for GCP setup. It changes
nothing on the Mac besides gcloud's own state. **Never print the key string.** Every command that could
output it uses `--format=none` or pipes straight into Secret Manager.

**Expected web-console steps: none.** Fallback only if a gcloud step fails with a permission or
org-policy error: report the error to the user, along with the URL for that step:

- APIs: `https://console.cloud.google.com/apis/library/youtube.googleapis.com?project=hamster-52b093`
- Keys: `https://console.cloud.google.com/apis/credentials?project=hamster-52b093`
- Secrets: `https://console.cloud.google.com/security/secret-manager?project=hamster-52b093`

- [ ] **Step 1: Confirm the account and project (read-only)**

Run: `gcloud config get-value account && gcloud projects describe hamster-52b093 --format='value(projectNumber)'`
Expected: an account email and a project number. If auth fails, stop and ask the user to run
`! gcloud auth login`.

- [ ] **Step 2: Enable the APIs**

Run: `gcloud services enable youtube.googleapis.com apikeys.googleapis.com --project=hamster-52b093`
Expected: the command finishes. Check with
`gcloud services list --enabled --project=hamster-52b093 --filter='config.name:(youtube.googleapis.com apikeys.googleapis.com)' --format='value(config.name)'`,
which prints both names.

- [ ] **Step 3: Create a key restricted to YouTube Data API v3, printing nothing**

```bash
gcloud services api-keys create --project=hamster-52b093 \
  --key-id=hamster-youtube-data --display-name="hamster YouTube Data API" \
  --api-target=service=youtube.googleapis.com --format=none
```

Check: `gcloud services api-keys describe hamster-youtube-data --project=hamster-52b093 --format='value(restrictions.apiTargets[0].service)'`
prints `youtube.googleapis.com`. There's no IP restriction, because Cloud Run egress IPs aren't fixed.

- [ ] **Step 4: Store it in Secret Manager straight from the pipe**

```bash
gcloud services api-keys get-key-string hamster-youtube-data --project=hamster-52b093 \
  --format='value(keyString)' \
| gcloud secrets create YOUTUBE_API_KEY --project=hamster-52b093 \
  --replication-policy=automatic --data-file=- --format=none
```

Check: `gcloud secrets versions list YOUTUBE_API_KEY --project=hamster-52b093 --format='value(name,state)'`
prints `1 ENABLED`. Never run `versions access` to look at the value.

- [ ] **Step 5: Grant the Cloud Run runtime service account access**

Find the account with
`gcloud run services describe hamster-backend --region asia-northeast1 --project=hamster-52b093 --format='value(spec.template.spec.serviceAccountName)'`.
If that prints nothing, the runtime account is `<projectNumber>-compute@developer.gserviceaccount.com`.
Cross-check: `gcloud secrets get-iam-policy GEMINI_API_KEY --project=hamster-52b093` should already
list the same member. Then grant it access:

```bash
gcloud secrets add-iam-policy-binding YOUTUBE_API_KEY --project=hamster-52b093 \
  --member="serviceAccount:<runtime SA>" --role=roles/secretmanager.secretAccessor --format=none
```

Check: `gcloud secrets get-iam-policy YOUTUBE_API_KEY --project=hamster-52b093 --format='value(bindings.members)'`
lists the runtime SA.

- [ ] **Step 6: Report**

Record which steps ran and which SA was granted, with no key material, for the PR description. The
deploy config is wired in Task 11.

---

### Task 1: YouTube URL and duration parsing

**Files:**
- Create: `backend/src/services/youtube.ts`
- Test: `backend/src/services/youtube.test.ts`

**Interfaces:**
- Produces:
  - `parseYouTubeVideoId(url: string): string | null`
  - `canonicalVideoUrl(videoId: string): string`
  - `parseIsoDuration(value: string): number | null` (seconds; `null` if malformed)
  - `isYouTubeSummariesEnabled(): boolean` (`process.env.YOUTUBE_SUMMARIES === 'on'`)
  - `export const MAX_VIDEO_SECONDS = 3600`

- [ ] **Step 1: Write the failing tests**

Use `it.each` tables with id `dQw4w9WgXcQ` (and `O_zcc6Xl12g`).

- **Accepted:**
  - `https://www.youtube.com/watch?v=ID`
  - `http://youtube.com/watch?v=ID&t=42s`
  - `https://m.youtube.com/watch?feature=share&v=ID`
  - `https://music.youtube.com/watch?v=ID&list=RDxyz`
  - `https://www.youtube.com/watch?v=ID&list=PL1&index=3&si=abc&pp=x`
  - `https://youtu.be/ID`
  - `https://youtu.be/ID?si=abc&t=42`
  - `https://www.youtube.com/shorts/ID?feature=share`
  - `https://www.youtube.com/live/ID`
  - `https://www.youtube.com/embed/ID`
  - `https://www.youtube-nocookie.com/embed/ID`
  - `https://www.youtube.com/v/ID`
  - `https://WWW.YOUTUBE.COM/watch?v=ID`
  - `https://youtu.be/ID/`
- **Rejected (null):**
  - `https://www.youtube.com/`
  - `https://www.youtube.com/@aiDotEngineer`
  - `https://www.youtube.com/channel/UCx`
  - `https://www.youtube.com/c/name`
  - `https://www.youtube.com/user/name`
  - `https://www.youtube.com/playlist?list=PL1`
  - `https://www.youtube.com/results?search_query=x`
  - `https://www.youtube.com/feed/subscriptions`
  - `https://www.youtube.com/watch?v=short`
  - `https://www.youtube.com/watch?v=ID%22x`
  - `https://youtube.com.evil.test/watch?v=ID`
  - `https://notyoutube.com/watch?v=ID`
  - `https://user@www.youtube.com/watch?v=ID`
  - `https://www.youtube.com:8443/watch?v=ID`
  - `ftp://www.youtube.com/watch?v=ID`
  - `not a url`
- `canonicalVideoUrl('O_zcc6Xl12g')` → `'https://www.youtube.com/watch?v=O_zcc6Xl12g'`
- `parseIsoDuration`:
  - `PT17M30S` → 1050
  - `PT1H` → 3600
  - `PT1H0M1S` → 3601
  - `P1DT2H` → 93600
  - `PT45S` → 45
  - `P0D` → 0
  - `''`, `'17:30'`, `'PT'` → null
- `isYouTubeSummariesEnabled()`: true only for the exact string `'on'`. False when unset, `'true'` or
  `'ON'`. Restore the env after each test.

- [ ] **Step 2: Run, expect FAIL** — `cd backend && npx vitest run src/services/youtube.test.ts` → module not found.

- [ ] **Step 3: Implement** with `new URL()`. Return null on any throw. Allowed hosts are exact matches
  after lowercasing: `youtube.com`, `www.youtube.com`, `m.youtube.com`, `music.youtube.com`, `youtu.be`,
  `www.youtube-nocookie.com`. Reject when `username`, `password` or `port` is set.

- [ ] **Step 4: Run, expect PASS**; then `npm run lint`.

- [ ] **Step 5: Commit** — `git commit -m "Recognise YouTube video links and parse ISO-8601 durations"`

---

### Task 2: Title and favicon at save time (oEmbed)

**Files:**
- Create: `backend/src/services/youtubeOembed.ts`, `backend/src/services/youtubeOembed.test.ts`
- Modify: `backend/src/routes/bookmarks.ts` (`POST /`, ~line 137), `backend/src/routes/bookmarks.test.ts`

**Interfaces:**
- Consumes: `parseYouTubeVideoId`, `canonicalVideoUrl` (Task 1); `fetchAllowedUrl` (`safeFetch.ts`)
- Produces:
  - `fetchYouTubeTitle(videoId: string): Promise<string | null>`
  - `export const YOUTUBE_FAVICON_URL = 'https://www.youtube.com/favicon.ico'`

- [ ] **Step 1: Failing service tests** (mock `./safeFetch`'s `fetchAllowedUrl`):
  - It requests exactly `https://www.youtube.com/oembed?url=` + `encodeURIComponent(canonical)` + `&format=json`.
  - A 200 JSON response with `title: '  All Code Is\nSlop  '` → `'All Code Is Slop'`.
  - A title longer than 300 chars → cut to 300.
  - Null result for each of these: 401, 404, `fetchAllowedUrl` → null, a thrown error (timeout), a
    `content-type: text/html` response, invalid JSON, a missing or empty `title`, and a body over 64 KB.
  - The timeout signal comes from `AbortSignal.timeout(5000)`. Spy on it.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement.** Read the body with a 64 KB bounded reader (`articleFetcher`'s
  `readBoundedBytes` pattern), then `JSON.parse` it. Any failure returns null.

- [ ] **Step 4: Failing route tests** in `bookmarks.test.ts` (`vi.mock('../services/youtubeOembed')`):
  - POST `{url:'https://youtu.be/O_zcc6Xl12g?si=x'}` with an oEmbed title → `createBookmark` is called
    with `(url as given, 'All Code Is Slop…', YOUTUBE_FAVICON_URL)` and `fetchMetadata` is not called.
  - oEmbed null → falls back to `fetchMetadata`. If that has no title either, the title is the URL.
  - A non-video YouTube URL (channel) → only `fetchMetadata`.
  - This doesn't depend on `YOUTUBE_SUMMARIES`.

- [ ] **Step 5: Implement in `POST /`; run all backend tests; expect PASS; lint.**

- [ ] **Step 6: Commit** — `git commit -m "Title YouTube bookmarks from oEmbed when saving"`

---

### Task 3: Data API length and availability check

**Files:**
- Modify: `backend/src/services/safeFetch.ts`, `backend/src/services/safeFetch.test.ts`
- Create: `backend/src/services/youtubeDataApi.ts`, `backend/src/services/youtubeDataApi.test.ts`

**Interfaces:**
- Consumes: `parseIsoDuration`, `MAX_VIDEO_SECONDS` (Task 1)
- Produces:
  - `fetchAllowedUrl(url, signal, headers?: Record<string, string>)`. Headers are sent only while the
    hop's origin equals the original URL's origin. Existing callers are unchanged.
  - `type VideoCheck = { kind: 'ok'; durationSeconds: number; title: string | null } | { kind: 'too_long'; durationSeconds: number } | { kind: 'unavailable' } | { kind: 'live' } | { kind: 'unknown' }`
  - `checkVideo(videoId: string): Promise<VideoCheck>`

- [ ] **Step 1: Failing safeFetch tests:**
  - The headers are passed to `fetch` on the first hop.
  - After a 302 to another origin, the next `fetch` call has no headers.
  - Without headers the behaviour is unchanged. The existing tests stay unmodified.

- [ ] **Step 2: FAIL → implement → PASS.**

- [ ] **Step 3: Failing `checkVideo` tests** (mock `./safeFetch`). Request shape:
  - URL `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,status,snippet&id=<id>`.
  - Header `{ 'X-Goog-Api-Key': process.env.YOUTUBE_API_KEY }`.
  - The key string appears nowhere in the URL.

  Mapping:

  | Input | Result |
  |---|---|
  | `YOUTUBE_API_KEY` unset | `unknown`, no fetch |
  | non-200 (403 quota) / null / throw / bad JSON | `unknown` |
  | `items: []` | `unavailable` |
  | `privacyStatus: 'private'` or `'unlisted'` | `unavailable` |
  | `liveBroadcastContent: 'live'` or `'upcoming'` | `live` |
  | `PT1H` | `ok`, 3600 seconds, `title` from `snippet.title` |
  | `PT1H0M1S` | `too_long`, 3601 |
  | `P0D` or a missing duration (not live) | `unknown` |

  Also: when `fetchAllowedUrl` throws an error whose message contains the key, `console.error` is never
  called with the key. Spy on it, and assert on every argument's `String()`.

- [ ] **Step 4: FAIL → implement → PASS → lint.** Timeout `AbortSignal.timeout(5000)`, 256 KB bounded read.

- [ ] **Step 5: Commit** — `git commit -m "Check YouTube video length and availability with the Data API"`

---

### Task 4: Summarizer and prompts take a source kind

**Files:**
- Modify: `backend/src/services/summarizer.ts`, `labeler.ts`, `articleChat.ts` and their tests

**Interfaces:**
- Produces:
  - `type ContentSource = 'page' | 'video'`, exported from `summarizer.ts`.
  - `summarize(title, text, source: ContentSource = 'page')`.
  - `generateLabels(title, text, existingLabels, source: ContentSource = 'page')`.
  - `answerQuestion(title, text, messages, source: ContentSource = 'page')`.
  - `export const SUMMARY_FORMAT_RULES: string`: the shared Markdown and structure lines that Task 5
    reuses.

- [ ] **Step 1: Failing tests.**
  - For each of the three functions, with `'video'`:
    - The system instruction mentions a video, not a web page.
    - The user turn's fences read `Untrusted video title` and `Untrusted video transcript`, with "not
      instructions".
  - With no 4th argument, the request is identical to today's. Snapshot the existing
    `systemInstruction` and `contents` strings for `'page'` in a new test, taken *before* editing.
  - The video summarize prompt still carries the English/Japanese language rule, judged from the
    "spoken language".

- [ ] **Step 2: FAIL → implement** by splitting the prompt into source-dependent framing plus the
  shared `SUMMARY_FORMAT_RULES`. The page wording must stay byte-identical. **→ PASS** (all existing
  tests unchanged) **→ lint.**

- [ ] **Step 3: Commit** — `git commit -m "Let the summarizer, labeler and chat prompts describe a video transcript"`

---

### Task 5: The video summarizer (first watch)

**Files:**
- Create: `backend/src/services/videoSummarizer.ts`, `backend/src/services/videoSummarizer.test.ts`

**Interfaces:**
- Consumes: `canonicalVideoUrl`, `MAX_VIDEO_SECONDS` (Task 1); `SUMMARY_FORMAT_RULES` (Task 4);
  `withSignal`; `SummarizerUnavailableError`
- Produces:
  - `watchVideo(videoId: string, title: string, durationSeconds: number): Promise<VideoWatchResult>`
  - `interface VideoWatchResult { transcript: string; summary: string; usage: { promptTokens?: number; videoTokens?: number; audioTokens?: number; outputTokens?: number; thoughtsTokens?: number }; finishReason?: string; latencyMs: number }`
  - `class VideoUnwatchableError extends Error`, `class VideoNoContentError extends Error`
  - Exported constants: `VIDEO_MODEL = 'gemini-3.8-flash'`, `VIDEO_TIMEOUT_MS = 480_000`,
    `VIDEO_MAX_OUTPUT_TOKENS = 49_152`, `MAX_TRANSCRIPT_CHARS = 300_000`

- [ ] **Step 1: Failing tests**, mocking `GoogleGenAI.models.generateContentStream` as an async
  generator of chunks. The last chunk carries `usageMetadata` and `candidates[0].finishReason`.

  Request shape:
  - `model: 'gemini-3.8-flash'`.
  - Contents: one user turn whose first part is
    `{ fileData: { fileUri: 'https://www.youtube.com/watch?v=O_zcc6Xl12g' }, videoMetadata: { endOffset: '3600s' } }`,
    followed by a text part containing the fenced title (`Untrusted video title`).
  - Config:
    - `mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW`
    - `maxOutputTokens: 49152`
    - `thinkingConfig: { thinkingLevel: 'LOW' }`
    - `responseMimeType: 'application/json'`
    - a `responseSchema` with `status` enum `['ok','no_content','unwatchable']`, `transcript` and
      `summary`, all required, `propertyOrdering: ['status','transcript','summary']`
    - `abortSignal` present.

  Results:
  - JSON split across several chunks is joined, parsed and returned trimmed.
  - `usage.videoTokens` comes from `promptTokensDetails` modality `VIDEO`, and `audioTokens` from
    `AUDIO`.
  - The transcript is truncated to 300,000 chars.
  - **Throws:**
    - `MAX_TOKENS` → generic Error.
    - Invalid JSON, or a missing or empty field → generic Error.
    - `status: 'unwatchable'` → `VideoUnwatchableError`.
    - `status: 'no_content'` → `VideoNoContentError`.
    - The video guard: for `durationSeconds = 1050`, a VIDEO count of 34_000 throws
      `VideoUnwatchableError` and 35_000 passes. The threshold is `0.5 × min(d, 3600) × 66 = 34_650`.
    - A missing `promptTokensDetails` → `VideoUnwatchableError`.
    - A transcript under 200 chars with `status: 'ok'` and `durationSeconds > 120` → `VideoNoContentError`.
    - No key → `SummarizerUnavailableError`.
    - An abort when the signal fires.
  - "Unwraps a single json fence; rejects prose around JSON": a reply of ```` ```json\n{…}\n``` ````
    parses. `Here you go: {…}` throws a generic Error.

- [ ] **Step 2: FAIL → implement.** The system instruction is video framing, plus `SUMMARY_FORMAT_RULES`,
  plus the transcript rules from spec §8 (spoken language, `[MM:SS]` paragraphs, `[Slide: …]`, untrusted
  content). **→ PASS → lint.**

- [ ] **Step 3: Commit** — `git commit -m "Watch a YouTube video once with Gemini and return transcript and summary"`

---

### Task 6: Firestore — transcripts and video summary state

**Files:**
- Modify: `backend/src/services/firestore.ts`, `backend/src/services/firestore.test.ts` (add `batch` and
  `transcripts` to the mocks)

**Interfaces:**
- Produces:
  - `type VideoSummaryCode = 'video_too_long' | 'video_unavailable' | 'video_live' | 'video_no_content' | 'video_length_unknown' | 'generic'`
  - `BookmarkDoc.videoSummaryState?: { status: 'running' | 'failed'; code?: VideoSummaryCode; updatedAt: string }`
  - `getTranscript(bookmarkId: string): Promise<string | null>`
  - `saveVideoSummary(id: string, data: { videoId: string; transcript: string; summary: string; shortSummary?: string; title?: string }): Promise<void>`
  - `setVideoSummaryState(id: string, state: { status: 'running' } | { status: 'failed'; code: VideoSummaryCode }): Promise<void>`
  - `deleteBookmark` also deletes `transcripts/{id}`.

- [ ] **Step 1: Failing tests:**
  - `saveVideoSummary` uses one `batch()`:
    - `set` on `transcripts/{id}` with `{ videoId, transcript, model: 'gemini-3.8-flash', createdAt }`.
    - `update` on `bookmarks/{id}` with `summary`, `shortSummary` (or `FieldValue.delete()`),
      `labels: delete`, `videoSummaryState: delete`, and `title` only when it is given.
    - One `commit`.
  - "saveVideoSummary fails as a whole on a deleted bookmark": `commit` rejects with code 5, and the
    rejection propagates.
  - `setVideoSummaryState` calls `update` with `updatedAt: Timestamp.now()`. Code 5 resolves without
    throwing. Other errors reject.
  - `getTranscript`: missing doc → null; non-string → null.
  - `deleteBookmark` batch-deletes both docs.
  - `toBookmark` returns `videoSummaryState` only when its shape is valid (ISO `updatedAt`). A
    malformed state is dropped, and the bookmark is still returned.
  - `listBookmarks` never reads `transcripts`.

- [ ] **Step 2: FAIL → implement → PASS → lint.**

- [ ] **Step 3: Commit** — `git commit -m "Store video transcripts separately and track video summary state"`

---

### Task 7: API errors carry a code (backend response shape)

**Files:**
- Modify: `backend/src/routes/bookmarks.ts`, `backend/src/routes/bookmarks.test.ts`

**Interfaces:**
- Produces:
  - `class VideoSummaryError extends Error { constructor(readonly code: Exclude<VideoSummaryCode,'generic'> | 'video_summary_running', readonly httpStatus: 409 | 422 | 502) }`
  - JSON responses for bookmarks (`GET /`, `GET /:id`, `POST /`) include the computed
    `videoId?: string` when `parseYouTubeVideoId(url)` matches.

- [ ] **Step 1: Failing tests:**
  - `GET /` and `GET /:id` include `videoId` for a `youtu.be` bookmark and omit it for an article.
  - The value isn't written to Firestore: `createBookmark` is called with the same args as in Task 2.

- [ ] **Step 2: FAIL → implement (a small `withVideoId(bookmark)` mapper) → PASS → lint.**

- [ ] **Step 3: Commit** — `git commit -m "Expose a computed videoId on YouTube bookmarks"`

---

### Task 8: The video branch of summary generation

**Files:**
- Modify: `backend/src/routes/bookmarks.ts` (`generateSummary`, `POST /:id/summary`), `bookmarks.test.ts`
  (mock `youtubeDataApi`, `videoSummarizer` and the new `firestore` functions)

**Interfaces:**
- Consumes: Tasks 1, 3, 4, 5, 6, 7.

Order for a bookmark with `videoId`, when `isYouTubeSummariesEnabled()`:

1. Configured check (503 as today).
2. `getTranscript(id)`. If a transcript exists: `summarize(title, transcript, 'video')`, then
   `summarizeShort`, then `updateSummary`, then labels. No Data API call, no watch.
3. Otherwise `checkVideo`:
   - `too_long` → 422 `video_too_long`
   - `unavailable` → 422 `video_unavailable`
   - `live` → 422 `video_live`
   - `unknown` → 502 `video_length_unknown`

   Each refusal writes state `failed` + code, and makes no Gemini call.
4. `setVideoSummaryState(running)`.
5. `watchVideo(videoId, check.title ?? bookmark.title, durationSeconds)`. Errors map as follows, each
   writing `failed` + code:
   - `VideoUnwatchableError` → 502 `video_unavailable`
   - `VideoNoContentError` → 422 `video_no_content`
   - anything else → 502 with no code (`generic` in the stored state)
6. `summarizeShort` (best-effort).
7. `saveVideoSummary`, with `title: check.title` only when `bookmark.title === bookmark.url` and
   `check.title` is set. A failure here → `SummaryStorageError` (500) plus state `failed`/`generic`.
8. Labels from `summary + '\n\n' + transcript`, with `'video'`.

`POST /:id/summary`: if there's no local in-flight promise, and the bookmark is a video with a
`running` state younger than 660_000 ms → 409 `{ error, code: 'video_summary_running' }`, and nothing
is started. Error bodies for `VideoSummaryError` are `{ error: <vague text>, code }`. A failed state
write is logged and swallowed.

- [ ] **Step 1: Failing tests:**
  - **Refusals:** one per row of the step 3 and step 5 mappings, asserting status, `code`, the stored
    state, and `watchVideo` not called for the step 3 cases.
  - **First watch:**
    - Success stores the result via `saveVideoSummary` with the right args.
    - Labels get `'video'` and the transcript.
    - The response is shaped as today.
    - `running` is written before `watchVideo` is called (check the call order).
  - **Regenerate:** "regenerate from a stored transcript skips the Data API and never watches".
  - **Title repair:** the title is passed only when `title === url`.
  - **Running state:**
    - Fresh `running` + no local in-flight → 409, and no `checkVideo`/`watchVideo`.
    - Stale `running` (updatedAt 11 min + 1 s ago) → generates.
    - Two concurrent requests on one router → one `watchVideo`.
  - **Failure paths:**
    - "deleted mid-watch answers 500 and does not throw from the state write": `saveVideoSummary`
      rejects with code 5, and `setVideoSummaryState` resolves (Task 6 swallows code 5).
    - `console.error` never receives transcript text: assert that no argument contains a unique
      transcript marker string.
  - **Kill switch off:** a YouTube bookmark goes through `fetchArticleText` and `summarize(title, text)`
    exactly as today.
  - **Articles:** every existing test is unmodified and green.

- [ ] **Step 2: FAIL → implement → PASS → lint.** Keep the article path's code untouched: branch at the
  top of `generateSummary` into a separate `generateVideoSummary(bookmark, videoId)` function.

- [ ] **Step 3: Commit** — `git commit -m "Summarize YouTube videos by watching them once with Gemini"`

---

### Task 9: Chat from the stored transcript

**Files:**
- Modify: `backend/src/routes/bookmarks.ts` (`POST /:id/chat`), `bookmarks.test.ts`

- [ ] **Step 1: Failing tests:**
  - Video bookmark + switch on + transcript stored → `answerQuestion(title, transcript, messages, 'video')`,
    and `fetchArticleText` is not called.
  - No transcript → `answerQuestion(title, null, messages, 'video')`.
  - Switch off → today's path.
  - The video is never sent: the `videoSummarizer` mock is never called.

- [ ] **Step 2: FAIL → implement → PASS → lint.** Update the route comment about refetching per question.

- [ ] **Step 3: Commit** — `git commit -m "Answer chat about YouTube videos from the stored transcript"`

---

### Task 10: Frontend — error codes, running and failed states

**Files:**
- Modify: `frontend/src/api.ts`, `frontend/src/api.test.ts`, `frontend/src/pages/BookmarkPage.tsx`,
  `frontend/src/pages/BookmarkPage.test.tsx`
- Create: `frontend/src/videoSummaryMessages.ts` (code → copy map, exact strings from Global Constraints)

**Interfaces:**
- Produces:
  - `class ApiError extends Error { status: number; code?: string }`, thrown by `request()`. The
    message stays `API error: <status>`, so existing assertions still hold.
  - `Bookmark.videoId?: string`
  - `Bookmark.videoSummaryState?: { status: 'running' | 'failed'; code?: string; updatedAt: string }`
  - `videoSummaryMessage(code: string | undefined): string`
  - `const VIDEO_RUNNING_STALE_MS = 660_000`
  - `const MAX_VIDEO_POLL_ATTEMPTS = 300` (2 s × 300 = 10 min)

- [ ] **Step 1: Failing `api.test.ts` tests:**
  - A 422 with body `{error, code:'video_too_long'}` → `ApiError` with `status 422` and that code.
  - A non-JSON error body → `ApiError` with no code.

- [ ] **Step 2: FAIL → implement → PASS.**

- [ ] **Step 3: Failing `BookmarkPage.test.tsx` tests** (fake timers, as the existing poll tests do).
  For a video bookmark with no summary:
  - **`failed` states:** a stored `failed`/`video_too_long` shows the exact copy, with no "Try again"
    button and no polling. `failed`/`video_unavailable` shows its copy with "Try again".
  - **`running` states:**
    - A fresh `running` shows "Summarizing the video — this can take a few minutes.", Generate is
      disabled, and it is still polling at attempt 100.
    - A stale `running` shows "Couldn't generate a summary." with "Try again".
    - "Adopts a running state that appears mid-poll and keeps polling past 90 s": the first load has no
      state, poll #3 returns `running`, and polls continue after attempt 45.
  - **Clicks:** Generate rejecting with an `ApiError` code shows that code's copy. A 409
    `video_summary_running` shows the running copy and resumes polling.
  - **Unchanged:** an article bookmark behaves as today. The existing tests are unmodified.

- [ ] **Step 4: FAIL → implement in the empty-state block (`BookmarkPage.tsx` ~line 712) and the poll
  effect (~line 306) → PASS → `npm run lint` in `frontend`.**

- [ ] **Step 5: Commit** — `git commit -m "Show video summary progress and failures on the bookmark page"`

---

### Task 11: Deploy config, env docs, e2e

**Files:**
- Modify:
  - `.github/workflows/backend.yml`
  - `backend/.env.example`
  - `e2e/fixtures/firestore.ts`
- Create: `e2e/tests/youtube.spec.ts`

- [ ] **Step 1: Failing e2e test** in `e2e/tests/youtube.spec.ts`. Extend `seedBookmark` with an
  optional `summary` and a `videoSummaryState` map (Firestore REST `mapValue`).
  - Seed `{url:'https://youtu.be/O_zcc6Xl12g', title:'All Code Is Slop', videoSummaryState:{status:'failed', code:'video_too_long', updatedAt:now}}`,
    open it, and expect the too-long copy with no "Try again".
  - Seed `running` with `updatedAt: now` → expect the running copy and Generate disabled.
  - No network to YouTube. The e2e backend has no `YOUTUBE_SUMMARIES` and no keys, which is fine
    because these tests only read seeded state.

  Run: `cd e2e && npx playwright test tests/youtube.spec.ts` → FAIL before Task 10 is wired. (If Task 10
  already landed, the test passes on first run; record that instead.)

- [ ] **Step 2: Make it pass** (seed helper only).

- [ ] **Step 3: Deploy config.** In the `gcloud run deploy` step:
  - add `--timeout 600`
  - append `,YOUTUBE_SUMMARIES=on` to `--set-env-vars`
  - append `,YOUTUBE_API_KEY=YOUTUBE_API_KEY:latest` to `--set-secrets`

  Task 0 must be done first, or the deploy after merge fails. Check:
  `grep -n "timeout 600\|YOUTUBE_SUMMARIES=on\|YOUTUBE_API_KEY=YOUTUBE_API_KEY:latest" .github/workflows/backend.yml`
  shows 3 lines.

- [ ] **Step 4: `backend/.env.example`:** add a commented-out `# YOUTUBE_API_KEY=` and
  `# YOUTUBE_SUMMARIES=on`, with a why-comment in the existing style. No values.

- [ ] **Step 5: Full verification:**
  - `cd backend && npm run lint && npm test && npm run build`
  - `cd frontend && npm run lint && npm test && npm run build`
  - `cd e2e && npx playwright test`

  All green.

- [ ] **Step 6: Commit** — `git commit -m "Deploy YouTube summaries with the Data API key and a longer request timeout"`

---

### Task 12: Live check script (2a) — written now, run once before merge

**Files:**
- Create: `backend/scripts/youtube-live-check.ts`. It's outside `src`, so `tsc` and vitest never touch
  it, and CI never runs it.

**Interfaces:**
- Consumes: `checkVideo` (Task 3), `watchVideo`, `VIDEO_*` constants (Task 5), `summarizeShort`.

- [ ] **Step 1: Write the script.** It hard-codes video id `O_zcc6Xl12g` and refuses any argument.

  Steps:
  1. `checkVideo`, then print its `kind`, `durationSeconds` and title.
  2. Exactly **one** `watchVideo`.
  3. `summarizeShort` on the summary. This is a flash-lite text call and doesn't count toward the 2
     video calls.

  It prints:
  - **Request shape:** model, `mediaResolution`, `endOffset`, `maxOutputTokens`, timeout.
  - **Result:** `latencyMs`, `finishReason`, every `usage` count, the transcript length in chars, the
    **first 300 chars** of the transcript, the full summary and the short summary.
  - **On failure:** the error class and message (`VideoUnwatchableError`, the guard numbers, etc.).

  It never prints `process.env`. It exits non-zero on failure.

- [ ] **Step 2: Type-check without running:** `cd backend && npx tsc --noEmit --rootDir . scripts/youtube-live-check.ts --esModuleInterop --skipLibCheck --module commonjs --target ES2020`
  succeeds.

- [ ] **Step 3: Commit** — `git commit -m "Add a one-off live check script for the YouTube video summarizer"`

- [ ] **Step 4 (only when the orchestrator says so, after the plan is approved and Tasks 0–11 are done; before merge): run it once**

  ```bash
  cd backend && \
  GEMINI_API_KEY="$(gcloud secrets versions access latest --secret=GEMINI_API_KEY --project=hamster-52b093)" \
  YOUTUBE_API_KEY="$(gcloud secrets versions access latest --secret=YOUTUBE_API_KEY --project=hamster-52b093)" \
  npx tsx scripts/youtube-live-check.ts > <session scratchpad dir>/youtube-live-check.txt 2>&1
  ```

  The keys only exist in that one process's environment. They are never echoed or written to a file.
  At most **2 runs in total**, and the second only after a code fix for a failure the first run
  exposed (e.g. a wrong request shape or guard threshold). That fix goes through TDD and gets its own
  commit.

  The live check passes when all of these hold:
  - `kind: ok` with ~1050 s.
  - No error.
  - `videoTokens` ≥ 34,650.
  - `finishReason: STOP`.
  - The summary is in English with 8–12 bullets.
  - The transcript contains `[Slide:`.

- [ ] **Step 5: PR description.** When the PR is opened (a separate instruction), it records:
  - the request shape
  - the Data API result
  - latency
  - the token counts
  - `finishReason`
  - a ≤300-char transcript excerpt
  - the summary
  - which Task 0 steps ran

  No secrets, no full transcript.

---

## Self-review notes

- **Spec coverage:**

  | Spec section | Task |
  |---|---|
  | §5 | 1 |
  | §6 | 2 |
  | §7 | 3 |
  | §8 | 5 |
  | §9 | 7, 8, 10 |
  | §10 | 6, 8, 10 |
  | §11 | 6 |
  | §12 | 4, 8, 9 |
  | §13 cost, security and existing bookmarks | 8 (title repair, no auto backfill), 3 and 8 (logging) |
  | §13 kill switch and deploy | 1, 11, 0 |
  | §15 | 3, 12, 1 and 8, 10 (no re-watch / no transcript UI: nothing built) |
  | §16 | each task |

- **Deviation from spec §12 order, recorded on purpose:** with a stored transcript, the free checks
  are skipped. They only guard a video call, and skipping them keeps Regenerate working after a video
  goes private.
- **Shipping:** `YOUTUBE_SUMMARIES=on` in the workflow. The PR is merged only after Task 12 Step 4
  passes. Emergency off is
  `gcloud run services update hamster-backend --region asia-northeast1 --update-env-vars YOUTUBE_SUMMARIES=off`,
  which lasts until the next deploy. A lasting off is a one-line workflow PR.
