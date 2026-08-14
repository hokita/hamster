# Richer Bookmark Summaries — Design

**Date:** 2026-08-15
**Status:** Approved (approach A of three considered)

## Goal

Bookmark summaries should carry enough of the article's substance that the reader
usually does not need to open the original. Today's summary is a ~600-token
"should I read this?" digest; the user finds it too short and too thin.

The output keeps a fixed, predictable template (not per-article structure, not
model-chosen structure — both were considered and rejected).

## Changes

### 1. Prompt — `backend/src/services/summarizer.ts` `SYSTEM_INSTRUCTION`

- Goal statement: "Summarize the following web page **so the reader gets the
  article's full substance without opening it**" (replaces "for someone deciding
  whether to read it").
- Overview paragraph: 3–5 sentences (unchanged).
- "Key points" section: **8–12 bullets, each 2–4 sentences**, opening with a
  bold 2–4 word lead-in then " — " (lead-in style unchanged). New rules:
  - Each bullet must carry concrete substance from the article — figures, names,
    steps, arguments — not topic labels.
  - Every major claim or result in the article must appear in some bullet.
- "Takeaway" section: 2–3 sentences (unchanged).
- Unchanged: language rules (article language if English/Japanese, else
  English), Markdown-subset restrictions, untrusted-content fencing of title and
  body.

### 2. Budgets — `backend/src/services/summarizer.ts` constants

- `MAX_OUTPUT_TOKENS`: 8192 → **16384**. A 12-bullet Japanese summary of a long
  article plus LOW thinking needs the headroom. The `MAX_TOKENS` finish-reason
  guard stays as the off-script tripwire.
- `TIMEOUT_MS`: 20_000 → **45_000**. ~2k output tokens at Flash speeds plus a
  ~50k-token input fits comfortably; the old 20s would not always.

### 3. Input caps — `backend/src/services/articleFetcher.ts`

- `MAX_CHARS`: 20_000 → **200_000**. The model must see the whole article for
  the summary to replace it. Gemini 3.7 Flash's 1M-token context makes this
  safe.
- `MAX_BYTES`: 300_000 → **1_500_000**. 300KB of fetched HTML (markup overhead,
  3-bytes-per-char Japanese) often yields far less than 200k chars of text;
  without this the char cap is rarely reachable.

### 4. Timing ripple — `frontend/src/pages/BookmarkPage.tsx`

- `MAX_POLL_ATTEMPTS`: 15 → **30** (2s interval → 60s window), so polling
  outlives the backend's new 45s worst case instead of showing the "not ready"
  fallback mid-generation.

## Not Changing

- Error handling: existing guards (empty summary, MAX_TOKENS, timeout abort)
  cover the new shape.
- Labeler: `gemini-3.5-flash-lite` setup untouched.
- Stored summaries: no migration; the Regenerate button (PR #15) re-generates on
  demand.
- Model: `gemini-3.7-flash` + `ThinkingLevel.LOW` as shipped in PR #20.

## Testing

Red/green TDD throughout:

- Prompt-shape assertions on `SYSTEM_INSTRUCTION` (goal statement, 8–12 bullets,
  substance rules, unchanged sections).
- Budget constants: `maxOutputTokens: 16384` asserted on the generateContent
  call. `TIMEOUT_MS` feeds `AbortSignal.timeout()` and has no existing unit
  assertion; it is covered by code review, not a new test.
- Input caps: articleFetcher truncation tests at the new bounds.
- Poll window: frontend constant/behavior test for 30 attempts.
- Before the PR: one live smoke test summarizing a real long article (>20k
  chars) and confirming the summary reflects content past the old cap.

## Rejected Alternatives

- **B — adaptive bullet count** (up to 16 for very long articles): less
  predictable output shape, contradicts the fixed-template choice; revisit as a
  one-line prompt tweak if 8–12 proves thin for monster articles.
- **C — two-pass map-reduce chunking**: doubles latency and failure modes to
  solve an input-size problem the 1M-token context window already solves.
