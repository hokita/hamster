# Richer Bookmark Summaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make bookmark summaries rich enough to replace reading the article: 8–12 substantive bullets, whole-article input, wider time/token budgets.

**Architecture:** Prompt-and-constants change across three existing files — no new modules. Backend: `articleFetcher` caps raised so the model sees whole articles; `summarizer` system instruction reshaped and budgets widened. Frontend: polling window widened to outlive the backend's new worst case.

**Tech Stack:** TypeScript, vitest, `@google/genai` (Gemini `gemini-3.7-flash`, `ThinkingLevel.LOW` — do not change these), React (frontend).

**Spec:** `docs/superpowers/specs/2026-08-15-summary-quality-design.md`

## Global Constraints

- Work on branch `feat/richer-summaries` (already created; spec is committed there).
- Red/green TDD for every change: write the failing test, watch it fail, minimal code, watch it pass.
- Exact new values: `MAX_CHARS = 200_000`, `MAX_BYTES = 1_500_000`, `MAX_OUTPUT_TOKENS = 16384`, `TIMEOUT_MS = 45_000`, `MAX_POLL_ATTEMPTS = 30`.
- Do NOT touch: `labeler.ts`, the model id, the thinking level, language rules, Markdown-subset rules, or the untrusted-content fencing in `summarizer.ts`.
- Backend tests: `cd backend && npx vitest run <file>`. Frontend tests: `cd frontend && npx vitest run <file>`.
- Every commit message ends with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01PVSVKeEuNdQVdqerDAJBZG`

---

### Task 1: Raise articleFetcher input caps

**Files:**
- Modify: `backend/src/services/articleFetcher.ts:12-15` (the `MAX_BYTES` / `MAX_CHARS` constants)
- Test: `backend/src/services/articleFetcher.test.ts:70-74`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `fetchArticleText(url: string): Promise<string | null>` now returns up to 200,000 chars (unchanged signature; Task 2's prompt relies on whole articles arriving).

- [ ] **Step 1: Update the truncation test to the new cap (failing test)**

In `backend/src/services/articleFetcher.test.ts`, replace the existing truncation test:

```typescript
  it('truncates the text to 200000 characters', async () => {
    allow(`<body><p>${'a'.repeat(250_000)}</p></body>`)
    const text = await fetchArticleText('https://example.com')
    expect(text).toHaveLength(200_000)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/services/articleFetcher.test.ts`
Expected: FAIL — received length 20000, expected 200000. (If it fails for any other reason, stop and re-read the test.)

- [ ] **Step 3: Raise the constants**

In `backend/src/services/articleFetcher.ts`, change:

```typescript
const MAX_BYTES = 300_000
```
to
```typescript
// 300KB of fetched HTML (markup overhead, 3-bytes-per-char Japanese) often yields far less text
// than MAX_CHARS below; the byte cap must stay comfortably ahead of it or it silently becomes the
// real limit. Still bounded: this is the network/memory guard, not the text-length guard.
const MAX_BYTES = 1_500_000
```
and
```typescript
const MAX_CHARS = 20_000
```
to
```typescript
// The summary is meant to replace reading the article, so the model has to see the whole thing.
// 200k chars ≈ 50k tokens — well inside gemini-3.7-flash's 1M context; covers all but
// book-length pages.
const MAX_CHARS = 200_000
```

Keep any existing comments on those constants that still apply; the byte cap's streaming logic (`while (bytesRead < MAX_BYTES)`) is untouched.

- [ ] **Step 4: Run the full articleFetcher suite**

Run: `cd backend && npx vitest run src/services/articleFetcher.test.ts`
Expected: all tests PASS (the mid-tag-truncation tests at lines ~158-171 use small inputs and are unaffected).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/articleFetcher.ts backend/src/services/articleFetcher.test.ts
git commit -m "feat: raise article input caps so the model sees whole articles"
```

---

### Task 2: Reshape the summarizer prompt and widen its budgets

**Files:**
- Modify: `backend/src/services/summarizer.ts` (constants `MAX_OUTPUT_TOKENS`, `TIMEOUT_MS`; the `SYSTEM_INSTRUCTION` array)
- Test: `backend/src/services/summarizer.test.ts`

**Interfaces:**
- Consumes: whole-article text from Task 1 (no signature change).
- Produces: `summarize(title: string, text: string): Promise<string>` (unchanged signature); the summary Markdown keeps the same construct subset, so the frontend renderer needs no change.

- [ ] **Step 1: Update prompt-shape and budget tests (failing tests)**

In `backend/src/services/summarizer.test.ts`:

(a) In the test `'calls the latest Flash model, with a bounded output budget'`, change the config assertion to:

```typescript
        config: expect.objectContaining({ maxOutputTokens: 16384 }),
```

(b) In the test `'asks for a summary long enough to be worth reading'`, replace the body with:

```typescript
    // The summary must be readable INSTEAD of the article, not as a teaser for it. Eight to twelve
    // substantive bullets carrying the article's actual content is the shape; the old four-to-six
    // digest is the thing the user rejected as "too short and less information".
    mockGenerateContent.mockResolvedValue({ text: 'ok' })
    await summarize('My Title', 'The article body text')
    const systemInstruction = mockGenerateContent.mock.calls[0][0].config
      .systemInstruction as string
    expect(systemInstruction).toContain('three to five sentences')
    expect(systemInstruction).toContain('eight to twelve bullet points')
    expect(systemInstruction).toContain('two to four complete sentences')
    expect(systemInstruction).toContain('two or three sentences')
    expect(systemInstruction).not.toContain('four to six bullet points')
```

(c) Add a new test directly after it:

```typescript
  it('states the replace-reading goal and demands full coverage of the article', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'ok' })
    await summarize('My Title', 'The article body text')
    const systemInstruction = mockGenerateContent.mock.calls[0][0].config
      .systemInstruction as string
    expect(systemInstruction).toContain('full substance without opening it')
    expect(systemInstruction).toContain('every major claim')
    // The old goal framed the summary as a read-it-or-not teaser.
    expect(systemInstruction).not.toContain('deciding whether to read it')
  })
```

- [ ] **Step 2: Run tests to verify the three fail**

Run: `cd backend && npx vitest run src/services/summarizer.test.ts`
Expected: FAIL on exactly the budget assertion (8192 ≠ 16384), the reshaped length test, and the new goal test. All other tests still PASS.

- [ ] **Step 3: Minimal implementation**

In `backend/src/services/summarizer.ts`:

(a) Constants:

```typescript
const TIMEOUT_MS = 45_000
```
(replace `20_000`; extend the comment: a ~2k-token summary of a ~50k-token input fits well inside 45s at Flash speeds, but not always inside the old 20s.)

```typescript
const MAX_OUTPUT_TOKENS = 16384
```
(replace `8192`; update the sizing comment: the prompt now asks for eight to twelve bullets of two to four sentences — roughly 1.5–2.5k tokens in Japanese — plus LOW-thinking overhead drawn from the same pool.)

(b) In `SYSTEM_INSTRUCTION`, replace the first line:

```typescript
  'Summarize the following web page for someone deciding whether to read it.',
```
with
```typescript
  'Summarize the following web page so the reader gets the article\'s full substance without',
  'opening it.',
```

(c) Replace the Key-points rule:

```typescript
  '- Then a "## " heading meaning "Key points", followed by four to six bullet points, each on its',
  '  own line starting with "- ". Open each bullet with a two-to-four word summary of the point in',
  '  bold, then " — ", then one or two complete sentences carrying a concrete detail — a fact, a',
  '  figure, a step, an argument — rather than a bare topic label.',
```
with
```typescript
  '- Then a "## " heading meaning "Key points", followed by eight to twelve bullet points, each on',
  '  its own line starting with "- ". Open each bullet with a two-to-four word summary of the point',
  '  in bold, then " — ", then two to four complete sentences carrying the article\'s concrete',
  '  substance — facts, figures, names, steps, arguments — rather than a bare topic label.',
  '- Between them, the bullets must cover every major claim, result, or step in the article; a',
  '  reader of the summary alone should not miss anything important.',
```

(Note the escaped `\'` inside single-quoted strings — match the file's existing quoting style.)

Leave untouched: overview rule (three to five sentences), Takeaway rule (two or three sentences), language rules, Markdown-subset rules, fencing rules, `buildContents`, error guards.

- [ ] **Step 4: Run the summarizer suite, then the whole backend**

Run: `cd backend && npx vitest run src/services/summarizer.test.ts`
Expected: all PASS.
Run: `cd backend && npx vitest run && npx tsc --noEmit`
Expected: all PASS, typecheck clean (watch the `\'` escapes).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/summarizer.ts backend/src/services/summarizer.test.ts
git commit -m "feat: reshape summaries to replace reading the article"
```

---

### Task 3: Widen the frontend polling window

**Files:**
- Modify: `frontend/src/pages/BookmarkPage.tsx:22-27` (`MAX_POLL_ATTEMPTS` and the comment above it)
- Test: `frontend/src/pages/BookmarkPage.test.tsx` (the two poll-budget assertions, lines ~525-528 and ~551-565)

**Interfaces:**
- Consumes: nothing new — the backend's 45s worst case (Task 2) is why the window widens.
- Produces: nothing other tasks use.

- [ ] **Step 1: Update the poll-budget tests (failing tests)**

In `frontend/src/pages/BookmarkPage.test.tsx`:

(a) In the test asserting `countAfterFailure + 15` (line ~528): the surrounding test already advances timers by 60000ms; change the assertion to:

```typescript
    expect(vi.mocked(api.getBookmark).mock.calls.length).toBe(countAfterFailure + 30) // poll budget
```

(b) In the test `'stops polling once the budget is exhausted'` (line ~551): change the first advance from `30000` to `60000`, and the assertion to:

```typescript
    expect(countAtBudget).toBe(31) // 1 initial load + 30 polls
```

Keep the follow-up advance + no-further-calls assertion as is — that is the "stops at the budget" half of the test.

- [ ] **Step 2: Run tests to verify the two fail**

Run: `cd frontend && npx vitest run src/pages/BookmarkPage.test.tsx`
Expected: FAIL on exactly those two assertions (15/16 observed where 30/31 expected). Others PASS.

- [ ] **Step 3: Minimal implementation**

In `frontend/src/pages/BookmarkPage.tsx`, change:

```typescript
const MAX_POLL_ATTEMPTS = 15
```
to
```typescript
const MAX_POLL_ATTEMPTS = 30
```

and update the comment above (lines ~21-25): generation of the new whole-article summaries can take up to the backend's 45s timeout, so the window is 2s × 30 = 60 seconds — polling must outlive the backend's worst case or the page shows the "not ready" fallback mid-generation.

- [ ] **Step 4: Run the full frontend suite**

Run: `cd frontend && npx vitest run && npx tsc --noEmit`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/BookmarkPage.tsx frontend/src/pages/BookmarkPage.test.tsx
git commit -m "feat: widen summary poll window to outlive the 45s backend budget"
```

---

### Task 4: Live smoke test and PR

**Files:**
- No source changes. Verification + PR only.

**Interfaces:**
- Consumes: everything above, merged on `feat/richer-summaries`.
- Produces: an open PR; production rollout follows the repo's Codex-review flow.

- [ ] **Step 1: Run both full suites once more from a clean state**

Run: `cd backend && npx vitest run && cd ../frontend && npx vitest run`
Expected: all PASS.

- [ ] **Step 2: Live smoke test against a real long article**

Unit tests mock the SDK, so nothing in CI exercises the real model with the new prompt/budgets. Pick a real article whose text exceeds the OLD 20k-char cap. Run a one-off script with the key from Secret Manager (never print the key):

```bash
cd backend && GEMINI_API_KEY=$(gcloud secrets versions access latest --secret=GEMINI_API_KEY --project hamster-52b093) npx tsx -e "
import { fetchArticleText } from './src/services/articleFetcher'
import { summarize } from './src/services/summarizer'
const url = process.argv[1] ?? 'https://en.wikipedia.org/wiki/Transformer_(deep_learning)'
const text = await fetchArticleText(url)
console.log('article chars:', text?.length)
const summary = await summarize('smoke test', text!)
console.log('bullet count:', (summary.match(/^- /gm) ?? []).length)
console.log(summary)
" "https://en.wikipedia.org/wiki/Transformer_(deep_learning)"
```

Verify: `article chars` is well above 20000; 8–12 bullets; the summary includes content from late in the article (spot-check against the page); no truncation error. If the model overshoots bullets or hits MAX_TOKENS, stop and report — do not tune constants ad hoc.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/richer-summaries
gh pr create --title "Richer summaries: replace reading the article" --body "$(cat <<'EOF'
## Summary
- Summaries now aim to replace reading the article: 8-12 substantive bullets (2-4 sentences each), full-coverage rule, replace-reading goal statement.
- Input caps raised so the model sees whole articles: MAX_CHARS 20k -> 200k, MAX_BYTES 300KB -> 1.5MB.
- Budgets widened: MAX_OUTPUT_TOKENS 8192 -> 16384, TIMEOUT_MS 20s -> 45s, frontend poll window 30s -> 60s.

Spec: docs/superpowers/specs/2026-08-15-summary-quality-design.md

## Validation
- TDD throughout; full backend + frontend suites green; tsc clean.
- Live smoke test: whole >20k-char article summarized with 8-12 bullets covering late-article content.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01PVSVKeEuNdQVdqerDAJBZG
EOF
)"
```

- [ ] **Step 4: Watch the PR per the repo's flow**

Codex auto-reviews every push. Use the watching-github-pr-activity skill; standing authorization applies — squash-merge when Codex's fresh 👍 postdates the last push with no newer comments and CI is green.
