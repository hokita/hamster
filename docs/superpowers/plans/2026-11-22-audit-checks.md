# hamster audit checks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** hamster cannot ship a known high/critical vulnerability, and anything that turns vulnerable after shipping turns the nightly red within a day.

**Architecture:** Fix today's prod and dev high+ first (two PRs), then one gates PR: new jobs in `ci.yml`, a new `audit-nightly.yml`, `dependabot.yml`, SHA-pinned Actions and a digest-pinned base image. Two small Node scripts (Actions pin check, deployed-Node check) are built with `node --test`, no new dependencies.

**Tech Stack:** npm audit, Trivy `aquasec/trivy:0.76.2` image by digest, GitHub Actions, Dependabot, gcloud (WIF, existing secrets).

**Spec:** `/Users/hokita/ghq/github.com/hokita/orch/docs/superpowers/specs/2026-11-22-audit-checks-design.md` (hamster rows of §5, §6, §7, §8, §9)

## Global Constraints

- Gate threshold: high+ only. Prod: `npm audit --omit=dev --audit-level=high` in `backend` and `frontend`. Dev (nightly): `npm audit --audit-level=high` in `backend`, `frontend`, `e2e`, root.
- Image scan: `trivy image --scanners vuln --severity HIGH,CRITICAL --exit-code 1 <image>`. No `--ignore-unfixed`, no `|| true`, no `continue-on-error`, no dropped directories.
- Trivy runs from `aquasec/trivy:0.76.2@sha256:8f6bb947dbc528902e11f2f5be52f7b519f6a39d5d148f41166f2040499768fb` (released 2026-11-05, after GHSA-69fq-xp46-6x23; only 0.69.4 was malicious). Never `aquasecurity/trivy-action` or `setup-trivy`. Re-read the digest from Docker Hub at implementation time and stop if it differs.
- Every `uses:` pinned to a 40-char SHA with no trailing `# vX` comment. `google-github-actions/auth` unified on v3.
- No new secrets or keys. The nightly authenticates with `WIF_PROVIDER` / `WIF_SERVICE_ACCOUNT`, `permissions: contents: read, id-token: write`. No new identifiers: service `hamster-backend` and region `asia-northeast1` already appear in `backend.yml`; the image comes from `gcloud run services describe` at run time.
- No code comments, no lint/type ignores, no audit exceptions. `.github/audit-exceptions.yml` is not created (no entry approved).
- Merging to main deploys. `backend.yml`, `frontend.yml` and `firestore-rules.yml` fire on their path filters when the gates PR edits them. The orchestrator watches those deploys.

## Findings (2026-11-22, `npm audit --package-lock-only` on origin/main 374a1af, simulated on lockfile copies)

| dir | today all (C/H) | today prod (C/H) | after PR 1 + PR 2 (simulated) |
|---|---|---|---|
| backend | 2/3 | 0/0 | 0/0 (7 moderate: uuid via firebase-admin 12, excluded) |
| frontend | 2/9 | 0/5 | 0/0, 0 moderate |
| e2e | 1/14 | 0/0 | 0/0 |
| root | 1/14 | 0/0 | 0/0 |

- Every high+ has a fix. **No exception needs the user.**
- The spec's "vitest ≥3.2.6" is out of date: the advisory range is now `vitest ≤4.1.10` (and `@vitest/mocker ≤4.1.11`). The target is vitest 4.1.12.
- Still unknown until the draft gates PR runs: Trivy findings in `node:24.22.3-alpine` (Alpine packages, npm bundled in the image) and in the backend image's `node_modules`.
- `frontend` imports only `firebase/app` and `firebase/auth`. Nothing in the app or tests loads Firestore, so no test exercises grpc-js. PR 1 says so plainly.

## Review Focus

1. A gate job that shows green because its step never ran (wrong `working-directory`, missing lockfile): each audit step must fail when the dir has no lockfile. `npm audit` already exits non-zero there; the red demo in Task 6 proves the prod jobs actually read the lockfile.
2. The nightly image job scanning `:latest` instead of the serving revision: Task 5 reads `status.latestReadyRevisionName` → `status.imageDigest` and scans `<image>@<digest>`.
3. `check-node-runtime.mjs` given `v24.22.3` while index.json lists `v25.x` or `v26.x` security releases: only the same major counts (test in Task 4).
4. `check-action-pins.mjs` on `uses: ./local-action` or `docker://image@sha256:…`: local paths pass, `docker://` must carry a digest (tests in Task 4).
5. A Dependabot docker PR bumping `FROM node:…` while Volta and `setup-node` stay on 24.22.3: out of scope to automate; the worker aligns the pins in that PR (spec §7).

---

## Order of work (spec §9)

| Step | Who | What |
|---|---|---|
| 0 | orchestrator | `gh api -X PUT repos/hokita/hamster/vulnerability-alerts` (today 404 = off). Expect 204. Dependency graph is on by default for public repos. Security updates stay off |
| 1 | worker | Task 1: draft gates PR, record Trivy findings here |
| 2 | worker | PR 1 (Tasks 2): prod fix, plus image fix if Task 1 found image highs |
| 2b | worker | PR 2 (Task 3): dev fix |
| 3 | worker | PR 3 (Tasks 4–6): finish the gates PR, red demo, then ready for review |
| 4 | orchestrator | after PR 3 merges and the first dispatched nightly is green: settings below |

## GitHub settings (orchestrator, `gh api`)

- **Step 0:** `gh api -X PUT repos/hokita/hamster/vulnerability-alerts` → 204.
- **Step 4, after PR 3 merged and nightly green:**
  - `gh api -X PUT repos/hokita/hamster/automated-security-fixes` → 204; read back with `gh api repos/hokita/hamster --jq .security_and_analysis.dependabot_security_updates.status` = `enabled`.
  - `gh api -X POST repos/hokita/hamster/rulesets` creating **"Protect main"**, copied from corgi's: target branch, `~DEFAULT_BRANCH`, enforcement active, no bypass actors, rules `deletion`, `non_fast_forward`, `pull_request` (0 approvals, merge methods merge/squash/rebase), plus `required_status_checks` with `strict_required_status_checks_policy: false` and contexts (integration_id 15368): `Frontend`, `Backend`, `E2E`, `Audit prod (backend)`, `Audit prod (frontend)`, `Image scan (backend)`, `Actions pinned`.
  - Prove it: the next PR shows those seven as "Required".
- Secret scanning and push protection are already on. No change.

---

## Task 1: Draft gates PR (scanner discovery)

**Files:** Modify `.github/workflows/ci.yml`.

- [ ] On this branch, add only `Audit prod (backend)`, `Audit prod (frontend)` and `Image scan (backend)`, exactly as Task 5 specifies them (`Actions pinned` comes with Task 4).
- [ ] Push, open as **draft** PR. Expected: `Audit prod (frontend)` red (grpc-js, undici, firebase); `Audit prod (backend)` green; `Image scan (backend)` result unknown.
- [ ] Record the Trivy table (package, installed, fixed, target layer) under **Findings** above, commit `docs: record trivy findings`, push.
- [ ] If the image scan is red, Task 2 gets Step "image fix". If any finding has no fixed version and can't be removed by changing the image, stop and report it to the orchestrator for the user.

## Task 2 (PR 1, `fix/prod-audit`): firebase 12 and grpc-js override

**Files:** Modify `frontend/package.json`, `frontend/package-lock.json`; if Task 1 found image highs, `backend/Dockerfile`.

- [ ] From origin/main: `cd frontend && npm install firebase@^12.19.0`, add `"overrides": { "@grpc/grpc-js": "1.14.7" }`, `npm install`.
- [ ] Verify (all must pass, paste output in the PR):
  - `npm audit --omit=dev --audit-level=high` in `frontend` → exit 0, `found 0 vulnerabilities` at high.
  - `npm ls @grpc/grpc-js` → only `1.14.7` (overridden).
  - `grep -rl grpc frontend/dist` after build → expect nothing; report what it finds.
  - `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build` in `frontend`.
  - e2e: `cd e2e && npm ci && npx playwright install chromium && npm test` (auth emulator sign-in covers the firebase/auth upgrade). Ports 8081, 8090, 5174, 9099: if in use, report the clash, don't kill.
- [ ] If firebase 12 breaks something the TypeScript errors or tests show: fix it with a failing test first (red), then the code (green). If it breaks beyond the auth surface, stop and report instead of widening the PR (spec §9 risk).
- [ ] Image fix (only if Task 1 was red): change `backend/Dockerfile` so the runtime stage no longer carries the finding (e.g. build `node_modules` with `npm ci --omit=dev` in the builder stage, copy it, and remove `/usr/local/lib/node_modules/npm`, `/usr/local/bin/npm`, `/usr/local/bin/npx` from the runtime stage). Red/green: the draft PR's `Image scan (backend)` red → green after rebase. Smoke: in CI the image job also runs the container with `PORT=8080` and `curl -f localhost:8080/health` (Task 5 adds that step).
- [ ] PR body: what the override changes, the `npm ls` output, the grep result, and "no unit or e2e test loads Firestore's Node entry, so the suites don't prove the grpc-js override at runtime; the browser bundle contains no grpc-js".
- [ ] Commit, push, PR (normal flow). After merge: frontend deploy (and backend deploy if Dockerfile changed) watched; rebase the draft gates PR; `Audit prod (frontend)` and `Image scan (backend)` green.

## Task 3 (PR 2, `fix/dev-audit`): vitest 4, vite 6, firebase-tools

**Files:** Modify `backend/package.json`+lock, `frontend/package.json`+lock, `frontend/vite.config.ts`, `e2e/package.json`+lock, `package.json`+lock.

- [ ] `backend`: `npm install -D vitest@^4.1.12`. `frontend`: `npm install -D vitest@^4.1.12 vite@^6.4.6`. `e2e` and root: `npm install -D firebase-tools@^15.37.0`. Then `npm audit fix` (no `--force`) in all four.
- [ ] `frontend/vite.config.ts`: import `defineConfig` from `vitest/config` so the `test` key typechecks under vitest 4 (no triple-slash, no ignores).
- [ ] Fix what vitest 1→4 breaks (likely: `vi.mock` hoisting/factory typing, `vi.fn` generic signature, jsdom environment options). Each breakage: the existing test is the red; change the test or code minimally to green. Don't change behaviour under test.
- [ ] Verify:
  - `npm audit --audit-level=high` in `backend`, `frontend`, `e2e`, root → exit 0 (simulation: 0 high, 0 critical in all four).
  - `npm run lint`, `npx tsc --noEmit`, `npm test` in `backend` and `frontend`; `npm run build` in both.
  - e2e full suite (emulators come from the bumped firebase-tools).
- [ ] Commit, push, PR. After merge: backend + frontend deploys watched (lockfile changes trigger both).

## Task 4 (PR 3): pin-check and runtime-check scripts

**Files:** Create `.github/scripts/check-action-pins.mjs`, `.github/scripts/check-action-pins.test.mjs`, `.github/scripts/check-node-runtime.mjs`, `.github/scripts/check-node-runtime.test.mjs`.

**Interfaces (Produces):**
- `findUnpinned(workflowText: string): string[]` — returns each `uses:` value that is not `owner/repo[/path]@<40 hex>`, `./local`, or `docker://…@sha256:<64 hex>`. CLI: `node check-action-pins.mjs <files…>` prints offenders, exit 1 if any.
- `newerSecurityRelease(deployed: string, index: {version: string, security: boolean}[]): string | null` — newest version in the same major as `deployed`, greater than it, with `security: true`. CLI: `node check-node-runtime.mjs <deployed> <index.json>` exit 1 with `Production runs <deployed>; Node <x> is a security release. Redeploy hamster-backend.`

- [ ] Write tests (`node:test` + `node:assert/strict`):
  - `findUnpinned('uses: actions/checkout@v4')` → `['actions/checkout@v4']`
  - 40-hex SHA → `[]`; 39-hex → offender; `uses: ./x` → `[]`; `docker://alpine:3` → offender; `docker://alpine@sha256:<64 hex>` → `[]`; quoted value and `- uses:` list form both parsed.
  - `newerSecurityRelease('v24.22.3', [{version:'v24.22.3',security:true}])` → `null`
  - `('v24.22.1', [{v24.22.3,true},{v24.22.2,false}])` → `'v24.22.3'`
  - `('v24.22.2', [{v24.22.3,false}])` → `null`; `('v24.22.3', [{v26.1.0,true}])` → `null`; version compare is numeric (`v24.9.0` < `v24.10.0`).
- [ ] `node --test .github/scripts/` → FAIL (modules missing).
- [ ] Implement both; `node --test .github/scripts/` → PASS.
- [ ] Commit `feat: add action pin and node runtime checks`.

## Task 5 (PR 3): workflows, pins, dependabot

**Files:** Modify `.github/workflows/ci.yml`, `backend.yml`, `frontend.yml`, `firestore-rules.yml`, `backend/Dockerfile`. Create `.github/workflows/audit-nightly.yml`, `.github/dependabot.yml`.

- [ ] `ci.yml` new jobs (no path filters):
  - `Audit prod (backend)` / `Audit prod (frontend)`: checkout, setup-node `24.22.3`, `npm audit --omit=dev --audit-level=high` in the dir (no install needed).
  - `Image scan (backend)`: `docker build -t hamster-backend:ci backend`; smoke `docker run -d -p 8080:8080 hamster-backend:ci` then `curl -fsS --retry 10 --retry-connrefused localhost:8080/health`; then `docker run --rm -v /var/run/docker.sock:/var/run/docker.sock <trivy pin> image --scanners vuln --severity HIGH,CRITICAL --exit-code 1 hamster-backend:ci`.
  - `Actions pinned`: `node .github/scripts/check-action-pins.mjs .github/workflows/*.yml` and `node --test .github/scripts/`.
- [ ] `audit-nightly.yml`: `on: schedule: cron '0 18 * * *'` + `workflow_dispatch`; `permissions: contents: read, id-token: write`. Jobs: the two prod audits; `Audit dev (<dir>)` ×4 (`npm audit --audit-level=high`); `Actions pinned`; `Deployed image (backend)`: auth v3 with the two secrets, `gcloud auth configure-docker asia-northeast1-docker.pkg.dev --quiet`, `gcloud run services describe hamster-backend --region asia-northeast1 --format 'value(status.latestReadyRevisionName)'` → `gcloud run revisions describe <rev> --region asia-northeast1 --format 'value(status.imageDigest)'` (a full `repo@sha256:` reference), `docker pull` it, Trivy as above, then `curl -fsSo index.json https://nodejs.org/dist/index.json` and `node .github/scripts/check-node-runtime.mjs "$(docker run --rm --entrypoint node <image> --version)" index.json`.
- [ ] Pin every `uses:` in all five workflows to a SHA (`gh api repos/<o>/<r>/commits/<tag> --jq .sha` for the current latest tag of each major); `backend.yml` auth v2 → v3 with `create_credentials_file`/`export_environment_variables` as in `frontend.yml`. `backend/Dockerfile`: both `FROM node:24.22.3-alpine@sha256:<digest>` (digest read from Docker Hub at implementation time).
- [ ] `dependabot.yml` (version 2): `npm` with `directories: ["/backend", "/frontend", "/e2e", "/"]`, weekly, `open-pull-requests-limit: 0`; `docker` `directories: ["/backend"]`, weekly, one group `docker` pattern `*`; `github-actions` `directories: ["/"]`, weekly, one group `actions` pattern `*`.
- [ ] Verify locally: `node .github/scripts/check-action-pins.mjs .github/workflows/*.yml` exit 0. Push; every CI job green (`Frontend`, `Backend`, `E2E` and the four new ones).
- [ ] Commit `ci: add audit gates and nightly`.

## Task 6 (PR 3): red once, green, nightly proof

- [ ] Throwaway branch `chore/audit-red-demo` off PR 3: `cd backend && npm install lodash@4.17.20` (GHSA-35jh-r3h4-6jhm, high). Open as draft PR. Expected: `Audit prod (backend)` red with the lodash advisory, and `Image scan (backend)` red. Record both run URLs.
- [ ] Close that PR without merging, `git push origin --delete chore/audit-red-demo`, delete the local branch.
- [ ] Before merge, the nightly can't be dispatched (`workflow_dispatch` needs the file on main). Its commands are proven beforehand: dev audits by Task 3's identical local runs, pins and scripts by the PR's `Actions pinned` job, Trivy by `Image scan (backend)`. Only the gcloud digest lookup is new at merge.
- [ ] PR 3 body: red-demo run URLs, the green run URL, and the deploy workflows it touches. Mark ready for review. Normal flow (Codex, orchestrator merges, deploys watched).
- [ ] After merge: the orchestrator runs `gh workflow run audit-nightly.yml --ref main` and waits for all jobs green (spec §9 step 3 "done"). Red → the worker fixes it in a follow-up PR before step 4.
