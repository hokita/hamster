# Remove Narration Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete every code comment in hamster (except build-required directives) and every lint/type ignore, fixing the code underneath instead.

**Architecture:** Two fix commits come first. They replace the 6 `catch` blocks that hold only a comment (which is what keeps them clear of `no-empty`), so lint still passes once the comments go. Then six comments-only commits follow, one per area. Each is made by a script, and its diff is proved to be comments-only by comparing token streams and build output.

**Tech Stack:** TypeScript 5 (backend: Express + tsc, frontend: React + Vite + Tailwind 4), Vitest, ESLint 10 + typescript-eslint, Playwright 1.62 + Firebase emulators.

**Spec:** the user's approved request of 2026-11-21 (strictest version). It is quoted in the PR body, and the rules are copied into Global Constraints below.

## Global Constraints

- Delete every comment: warnings, JSDoc, commented-out code, test comments, and comments in YAML, Dockerfiles and config files.
- Keep only directives a build needs: `/// <reference`, shebangs and license headers.
- Remove every lint/type ignore, and fix the code in separate commits. Write a failing test first wherever behaviour is involved.
- Do not touch generated or vendored files, or docs: `README.md`, `docs/**`, every `package-lock.json`, `frontend/public/**`.
- Do not add code to replace a deleted warning. List it in the PR body under "Traps that lost their comment" (file + one line).
- Comment-removal commits are comments-only (plus whitespace on the lines they touch). Fix commits pass the full tests.
- Node comes from Volta: `node -v` must print `v24.22.3` inside `backend/`, `frontend/` and `e2e/`.
- No installs outside this worktree. If e2e needs a browser, use `PLAYWRIGHT_BROWSERS_PATH=$PWD/.superpowers/sdd/ms-playwright`, which is gitignored. (`.superpowers/ms-playwright` is **not** gitignored.)
- Never merge, never post GitHub comments, never kill processes you did not start (report their pids), and report port clashes. e2e uses ports 8081, 9099, 8090 and 5174, with `reuseExistingServer` on locally.

## Inventory (base `7f3df5f`)

Found with the TypeScript parser (`.superpowers/sdd/tools/scan.cjs`). Regex literals, strings, template literals and JSX text are not counted.

| Area (task) | Files | Comments | Comment lines |
|---|---|---|---|
| Config/CI: `.github/workflows/frontend.yml`, `backend/.env.example`, `firestore.rules` (T3) | 3 | 25 | 25 |
| backend src + `scripts/` (T4) | 19 | 561 | 561 |
| backend tests (T5) | 10 | 193 | 193 |
| frontend src (T6) | 11 | 553 | 566 |
| frontend tests (T7) | 6 | 239 | 239 |
| e2e (T8) | 9 | 59 | 59 |
| **Total removed** | **58** | **1630** | **1643** |

The 1643 comment lines break down as 1533 lines deleted outright and 110 code lines that only lose a trailing comment (dry run: `58 files changed, 110 insertions(+), 1643 deletions(-)`).

These files have no comments: Dockerfile, `.dockerignore`, `.gitignore`, `.prettierignore`, the other workflows, eslint/vite/vitest configs, tsconfigs, `index.html`, `index.css`, `.env.e2e` and `frontend/.env.example`.

**Excluded as generated/vendored/docs:** the 4 `package-lock.json` files, `frontend/public/*` (favicon set and webmanifest), `README.md`, `docs/**`.

### Keep-list (the only comment that stays)

| File:line | Text | Reason |
|---|---|---|
| `frontend/src/vite-env.d.ts:1` | `/// <reference types="vite/client" />` | Tool directive: it types `import.meta.env` for tsc. |

There are no shebangs, license headers or other directives in the repo.

### Lint/type ignores

- Inline ignores (`eslint-disable*`, `biome-ignore`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `nolint`, `prettier-ignore`): **none**.
- Comments kept only to satisfy `no-empty`: **6 catch blocks**, all fixed in T1/T2.
- Rules switched off in lint config: none. `react-refresh/only-export-components` is set to `warn` with `allowConstantExport`, which is the Vite template setting and not an off-switch.
- **Typecheck exclusion, out of scope and needs the user's decision:** both tsconfigs exclude `**/*.test.ts(x)`. Typechecking the tests shows **58 backend + 48 frontend type errors** (mostly TS2345/TS2741 in mock fixtures), and CI's `tsc --noEmit` never sees them. That is too large to fix here, so it is reported instead.

## Verification

Run this after every task (it is the "full check"):

```bash
(cd backend  && npm run lint && npx tsc --noEmit && npm test && npm run build)
(cd frontend && npm run lint && npx tsc --noEmit && npm test && npm run build)
```

Expected: lint shows 0 problems, tsc 0 errors, backend `617 passed`, frontend `265 passed` (more if T1/T2 add tests), and both builds succeed.

Additionally, for each comments-only task (T3–T8), with `B` = the commit before the task:

```bash
node .superpowers/sdd/tools/codecmp.cjs . $B HEAD      # expect: OK <n> file(s) comments-only
bash .superpowers/sdd/tools/buildcmp.sh $B HEAD        # expect: backend tsc --removeComments output byte-identical,
                                                       #         frontend JS bundle byte-identical,
                                                       #         CSS: only removals, from {collapse invisible hidden inline shrink outline}
node .superpowers/sdd/tools/scan.cjs . /tmp/x.json | grep <area paths>   # expect: no lines for the area's files
```

- `codecmp.cjs` compares parser leaf-token streams before and after, ignoring trailing commas. For YAML, rules and env files it compares the text with comments stripped and whitespace collapsed.
- The CSS can shrink because Tailwind scans source text, so words in comments ("hidden", "inline", …) generated those 6 utility classes. The dry run showed no other CSS change. Any class *added*, or any other class removed, means stop.
- Prettier: do not grow the set of files that fail `prettier --check`. At base, 5 files already fail: `frontend/src/api.test.ts`, `frontend/src/components/ArticleChat.test.tsx`, `frontend/src/components/ArticleChat.tsx`, `frontend/src/pages/BookmarksPage.test.tsx`, `e2e/tests/bookmarks.spec.ts`. Run `prettier --write` only on touched files that were clean at base. In the 5 dirty files, remove the stray blank lines left by the strip by hand.

## Review Focus

1. A `//` inside a string, regex or URL that a regex-based strip would treat as a comment (for example `bookmarks.ts:50`, `mediumRss.ts:22`, `youtube.test.ts`). The parser-based tools must leave it alone, and `codecmp` must catch it if not.
2. JSX `{/* … */}` children. Removing the whole expression must not join JSX text and change rendered whitespace. Covered by `codecmp` (JSX text normalised) and the byte-identical JS bundle.
3. The `.env.example`, YAML and `firestore.rules` comments are not covered by any test. Hand-check those diffs.
4. A strip that leaves a `catch {}`/`{}` that lint rejects. This should be impossible after T1/T2, and the T4/T6 lint run proves it.
5. Tailwind CSS changes beyond the 6 known classes.

---

### Task 1: Backend `catch` blocks that hold only a comment

**Files:** Modify `backend/src/services/metadataFetcher.ts:525-535` and `backend/src/services/videoSummarizer.ts:162-176`. Tests: `metadataFetcher.test.ts`, `videoSummarizer.test.ts`.

- [ ] **Step 1: Pin the behaviour.** Confirm tests already exist for: `fetchMetadata` where the inner fetch rejects and the code falls back to the Medium RSS title, and `parseReply` where invalid JSON raises `'gemini video response was not valid JSON'` and the message does not contain the raw text. Add any that are missing (`it('falls back to Medium RSS when the page fetch throws')`, `it('rejects unparseable JSON without echoing the reply')`), run them, and expect PASS on the current code.
- [ ] **Step 2: Refactor.** In `fetchMetadata`, use `const metadata = await fetchMetadataInner(url, AbortSignal.timeout(FETCH_TIMEOUT_MS)).catch(() => EMPTY_METADATA)`. In `videoSummarizer.ts`, add `function parseJsonOrNull(text: string): unknown` (`try { return JSON.parse(text) } catch { return null }`) and have `parseReply` use it. Leave the comments that are not in these blocks for T4.
- [ ] **Step 3: Run the full check.** All green.
- [ ] **Step 4: Commit** `refactor(backend): replace comment-only catch blocks`.

### Task 2: Frontend `catch` blocks that hold only a comment

**Files:** Modify `frontend/src/api.ts:61-71`, `frontend/src/components/BookmarkForm.tsx:14-26`, `frontend/src/pages/BookmarkPage.tsx:495-516`, `frontend/src/pages/BookmarksPage.tsx:283-296`. Tests sit next to each file.

- [ ] **Step 1: Pin the behaviour.** Confirm tests exist, or add them and expect PASS on the current code, for each of these:
  - (a) A non-OK response with an HTML/empty body throws `ApiError(status, undefined)`.
  - (b) A rejected `onAdd` keeps the URL in the field and re-enables the button.
  - (c) A failed generate followed by a failed re-read shows the failure state.
  - (d) A rejected `generateSummary` on the list page clears that row's summarizing state and shows no error.
- [ ] **Step 2: Refactor.**
  - (a) `const body = await res.json().catch(() => null)`.
  - (b) `const added = await onAdd({ url: url.trim() }).then(() => true, () => false)`, then `if (added) setUrl('')`, then `setSubmitting(false)`.
  - (c) `const refreshed = await api.getBookmark(requestedId).catch(() => null)`. Keep `fid` incremented before the call, and wrap the existing success-path checks in `if (refreshed)`.
  - (d) `await api.generateSummary(id).then(() => refresh({ background: true })).catch(() => undefined)`, then clear `summarizingIds`. Drop the `try`/`finally`.
- [ ] **Step 3: Run the full check.** All green.
- [ ] **Step 4: Commit** `refactor(frontend): replace comment-only catch blocks`.

### Tasks 3–8: Comments-only removal, one commit per area

Each task follows the same steps. Only the file list and the commit message change.

| Task | File list (`scan.cjs` output, filtered) | Commit message |
|---|---|---|
| 3 | `.github/workflows/frontend.yml`, `backend/.env.example`, `firestore.rules` | `chore: remove comments from CI and config files` |
| 4 | `backend/src/**/*.ts` except `*.test.ts`, plus `backend/scripts/*.ts` | `chore(backend): remove comments from source` |
| 5 | `backend/src/**/*.test.ts` | `chore(backend): remove comments from tests` |
| 6 | `frontend/src/**/*.ts(x)` except `*.test.*` (the strip keeps `vite-env.d.ts:1`) | `chore(frontend): remove comments from source` |
| 7 | `frontend/src/**/*.test.ts(x)` | `chore(frontend): remove comments from tests` |
| 8 | `e2e/**/*.ts` | `chore(e2e): remove comments` |

- [ ] **Step 1: Strip.** `B=$(git rev-parse HEAD)`, write the task's files to `list.txt`, then run `node .superpowers/sdd/tools/strip.cjs . --list list.txt`.
- [ ] **Step 2: Tidy.** Run `prettier --write` on touched files that were prettier-clean at base. Fix stray blank lines in the 5 dirty files by hand. No other edits.
- [ ] **Step 3: Check the area is clean.** `scan.cjs` reports no comments for the area (T6 keeps only `vite-env.d.ts:1`). `git grep -nE 'eslint-disable|@ts-(ignore|expect-error|nocheck)'` prints nothing.
- [ ] **Step 4: Commit** with the message from the table.
- [ ] **Step 5: Verify.** Run the full check, plus `codecmp.cjs . $B HEAD` and `buildcmp.sh $B HEAD`. All expectations under Verification must hold. If anything fails, fix it and `git commit --amend`, then verify again.
- [ ] **Step 6: Collect traps.** For every deleted comment that warned about a real trap, add one line to `.superpowers/sdd/traps.md` (file + one line). Candidates are listed below. Do not add code.

### Task 9: Final verification and PR

- [ ] **Step 1:** Run `scan.cjs` over the whole repo. Expected: exactly 1 comment (`frontend/src/vite-env.d.ts:1`). Run `codecmp.cjs . <T2 commit> HEAD` and `buildcmp.sh <T2 commit> HEAD` across T3–T8 combined. Run the full check.
- [ ] **Step 2: e2e, once.** First check that ports 8081, 9099, 8090 and 5174 are free (`lsof -iTCP:<p> -sTCP:LISTEN`). If any is taken, report it and stop. Then run `cd e2e && npm test`. If the browser is missing, install it with `PLAYWRIGHT_BROWSERS_PATH=$PWD/../.superpowers/sdd/ms-playwright npx playwright install chromium` and rerun with that env set. Afterwards, confirm no emulator (java) or dev server started by this run is still listening.
- [ ] **Step 3: Push the branch and open the PR** titled `Remove narration comments`. The body has: counts (the table above), verification (commands and results), `Lint ignores removed` (the 6 catch blocks), `Traps that lost their comment` (from `traps.md`), and the excluded-but-reported tsconfig test exclusion. It ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Do not merge.

### Trap candidates (seed for the PR list; executors confirm and extend)

- `.github/workflows/frontend.yml:51`: the Firebase web API key in the workflow is public by design and is not a leaked secret.
- `backend/.env.example:8-20`: `GEMINI_API_KEY` must stay unset rather than hold a placeholder (a placeholder makes every save fail against Gemini). `YOUTUBE_API_KEY` and `YOUTUBE_SUMMARIES=on` are documented nowhere else (README never mentions them).
- `firestore.rules:3`: the app only reaches Firestore through the Admin SDK, which bypasses the rules, so deny-all is intended.
- `e2e/playwright.config.ts:21`: `gracefulShutdown: SIGTERM` exists because a force-kill orphans the Java emulators.
- `frontend/src/components/BookmarkList.tsx:34`: the IP ranges mirror `backend/src/services/ipGuard.ts` and must stay in sync.
- `frontend/src/components/ArticleChat.tsx:14`: the chat bounds mirror the backend's `parseChatMessages`.
- `backend/src/services/safeFetch.ts:37`: manual redirects exist so every hop passes the SSRF guard. `redirect: 'follow'` would bypass it.
- `backend/src/services/metadataFetcher.ts:420`: favicons are limited to http(s) because the browser loads them and ipGuard never sees them.
- `backend/src/services/youtube.ts:6`: exact host match. A suffix check would accept `youtube.com.evil.test`.
- `backend/src/services/mediumRss.ts:12`: never derive a feed URL from a non-Medium URL.
- `backend/src/services/{summarizer,translator,videoSummarizer}.ts`: never extrapolate Gemini model ids, and `MINIMAL` thinking returns 400 on gemini-3.8-flash.
- `backend/src/services/labeler.ts:15`: thinking tokens come out of `maxOutputTokens`.
- `backend/src/services/youtubeDataApi.ts:64`: the API key goes in a header, never in the URL (URLs end up in logs).
- `backend/src/services/videoSummarizer.ts:173`: raw model text (transcript) must never go into error messages.
- `frontend/src/pages/BookmarkPage.tsx:255`: React Router reuses the component across `/bookmarks/:id`, so state must be reset when the id changes.
- `frontend/src/api.ts:73`: DELETE returns 204 with no body, and `res.json()` would throw.
