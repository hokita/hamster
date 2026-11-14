# Backend Dependency + Node.js Runtime Security Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two things in one PR, then redeploy the backend and prove that production runs Node 24.22.3 with the patched libraries:
1. Move the Node.js runtime to **24.22.3** (November 2026 Node.js security release, published 2026-11-11) in production (Cloud Run), CI and the local Volta pins.
2. Clear the patch/minor-fixable production npm vulnerabilities in `backend/` (Cloud Run).

**Architecture:** There are no application source changes.
- **Node:** pin `backend/Dockerfile` (both stages) to `node:24.22.3-alpine`. Today it uses the floating `node:24-alpine`, and production was last built on 24.21.0. Pin every `actions/setup-node` `node-version` and every Volta pin to `24.22.3`.
- **Libraries:** one `npm update` in `backend/` refreshes the lockfile within the existing ranges. express 4.22.3 (still `^4.18.0`) widens its `qs` range to `~6.16.0`, which is the only "parent bump" needed. No `overrides`.
- **Deploy:** merging to main triggers `Deploy Backend` (Cloud Run) and also `Deploy Frontend`, because `frontend/**` and `frontend.yml` change.

**Tech Stack:** npm 11, Node 24 → 24.22.3, Volta, GitHub Actions `actions/setup-node@v4`, Express 4, firebase-admin 12, Vitest, ESLint, tsc, Docker → Artifact Registry → Cloud Run (`hamster-backend`, `asia-northeast1`, project `hamster-52b093`).

**Spec:** the audit reports, hamster sections:
- `/private/tmp/claude-501/-Users-hokita-ghq-github-com-hokita-orch/f7be1767-ea7c-4ee6-b96d-13a1a4575d88/scratchpad/node-audit.md` (findings 1–6, fast-xml-parser, uuid) and `.../node-audit-libs.md` (`## hamster/backend`, `## hamster/frontend`).
- `/private/tmp/claude-501/-Users-hokita-ghq-github-com-hokita-orch/f7be1767-ea7c-4ee6-b96d-13a1a4575d88/scratchpad/node-runtime.md` (Node November 2026 security release; hamster prod/CI/local versions).

## Global Constraints

- **Node target `24.22.3`** exactly (fixed line for 24.x; advisory at nodejs.org/en/blog/vulnerability/november-2026-security-releases). The Docker Hub tag `node:24.22.3-alpine` exists (checked 2026-11-14).
- Production npm deps only. Dev tooling (vitest/vite/esbuild/tinypool, typescript-eslint/minimatch, firebase-tools in root and `e2e/`) is out of scope for the library part.
- No major library upgrades. Lockfile refresh within existing ranges is preferred. The only allowed npm-related `package.json` change is the floor bump that `npm update` writes for the direct deps `express` (`^4.22.3`) and `fast-xml-parser` (`^5.12.x`).
- No `overrides` block. Don't change `@types/node` (`^24.0.0` is fine).
- Work in `/Users/hokita/.herdr/worktrees/hamster/fix-dependency-security` on branch `fix/dependency-security`. Use a feature branch and PR; never push to main directly.
- Codex auto-reviews every push. Merge follows the usual Codex 👍 rule.

## Re-verified current state (origin/main `ff30f4d`, re-fetched 2026-11-14)

### Node runtime

| Where | Now | Target | Change |
|---|---|---|---|
| **Prod: Cloud Run `hamster-backend`** | **24.21.0** (revision `hamster-backend-00023-glm`, 2026-10-13, image config `NODE_VERSION=24.21.0`) | 24.22.3 | Redeploy with the pinned image (Task 4) |
| `backend/Dockerfile:1` builder | `FROM node:24-alpine AS builder` | `FROM node:24.22.3-alpine AS builder` | pin |
| `backend/Dockerfile:9` runtime | `FROM node:24-alpine` | `FROM node:24.22.3-alpine` | pin |
| `.github/workflows/backend.yml:29` (deploy) | `node-version: '24'` (floating) | `'24.22.3'` | pin |
| `.github/workflows/ci.yml:16,45,79` (frontend, backend, e2e jobs) | `'24.18.0'` | `'24.22.3'` | bump |
| `.github/workflows/frontend.yml:32` (deploy) | `'24.18.0'` | `'24.22.3'` | bump |
| `backend/package.json` `volta.node` | `24.17.0` | `24.22.3` | bump |
| `frontend/package.json` `volta.node` | `24.17.0` | `24.22.3` | bump |
| `e2e/package.json` `volta.node` | `24.17.0` | `24.22.3` | bump |
| root `package.json` (firebase-tools only) | no volta pin, so it uses the Volta default (local Mac 24.16.0) | none | **Not changed** (not in the requested scope). See "Local machine" below |
| `.nvmrc` / `.node-version` / `.tool-versions` / `engines` | none exist | none | none |
| Frontend production | Firebase Hosting static. No Node at runtime | n/a | Node is only used for the build (covered by `frontend.yml`) |

Exposure as deployed (from node-runtime.md): the app listens with plain `node:http` behind Google Front End (`http1` port; TLS/H2 terminated by Google), and there are no hits for https/http2/tls/flushHeaders/SNICallback/`https.Agent`/proxy env. So the named High server-side CVEs aren't reachable. Client-side fixes and the llhttp/undici fixes (no CVE ID) still apply, and that's why we redeploy.

### Libraries (`backend/package-lock.json`)

The lockfile matches the audit except for **fast-xml-parser**. PR #35 (Medium RSS) made it a **direct** dependency (`^5.11.2`, used by `backend/src/services/mediumRss.ts`). It's now a single hoisted 5.11.2, not 5.10.1. It's still vulnerable (≤5.11.2), and now it parses fetched Medium RSS.

| library | installed (lockfile now) | target | how | parent range |
|---|---|---|---|---|
| proxy-addr (critical) | 2.0.7 | 2.0.8 | `npm update` (lockfile only) | express `~2.0.7` |
| body-parser (high) | 1.20.6 | 1.20.9 | `npm update` (lockfile only) | express `~1.20.5` |
| qs (moderate) | 6.15.3 | 6.16.2 (≥6.16.1) | **parent bump**: express 4.22.2 → 4.22.3 (`qs ~6.16.0`). body-parser 1.20.9 also takes `qs ~6.16.0` | express 4.22.2 pins `~6.15.1`, so it can't be fixed without the bump |
| node-forge (high) | 1.4.0 | 1.4.3 | `npm update` (lockfile only) | firebase-admin `^1.3.1` |
| @fastify/busboy (high) | 3.2.0 | 3.2.5 (≥3.2.2) | `npm update` (lockfile only) | firebase-admin `^3.0.0` |
| @grpc/grpc-js (high) | 1.14.4 | 1.14.7 (≥1.14.5) | `npm update` (lockfile only) | google-gax `^1.10.9` |
| fast-xml-parser (low) | 5.11.2 | 5.12.1 (≥5.12.0) | `npm update` (direct dep, minor, range floor bump) | own `^5.11.2`; @google-cloud/storage `^5.3.4` |
| express (carrier) | 4.22.2 | 4.22.3 | `npm update` (direct dep, patch) | own `^4.18.0` |

## Review Focus

1. **A missed Node pin:** any `node-version`, `FROM node:` or `volta` entry left behind lets CI or prod drift. Covered by the repo-wide grep in Task 1 Step 3.
2. **Prod still on old Node after merge:** the deploy can succeed while the revision doesn't change, or the image is cached. Covered by Task 4 Step 3 (new revision digest + `NODE_VERSION=24.22.3`).
3. **Express request parsing after the qs/body-parser bump:** JSON bodies on `/api/bookmarks` and query strings must parse the same. Covered by the existing supertest route tests (Task 2 Step 3).
4. **Medium RSS parsing on fast-xml-parser 5.12:** the minor bump could change output shape. Covered by the existing `mediumRss` tests. If none assert on parsed fields, say so in the PR.
5. **Docker `npm ci --omit=dev` on the new base image:** the lockfile must stay in sync and install on Node 24.22.3 alpine. Covered by Task 3 (local image build + version check) and the CI deploy job.

---

### Task 1: Node runtime pins

**Files:**
- Modify: `backend/Dockerfile:1,9`
- Modify: `.github/workflows/backend.yml:29`, `.github/workflows/ci.yml:16,45,79`, `.github/workflows/frontend.yml:32`
- Modify: `backend/package.json`, `frontend/package.json`, `e2e/package.json` (`volta.node`)

- [ ] **Step 1: Confirm the branch is current and record the baseline**

```bash
git fetch origin && git status -sb && git log -1 --oneline origin/main
grep -rnE "FROM node:|node-version:|\"node\": \"24" backend/Dockerfile .github/workflows */package.json package.json
gcloud run services describe hamster-backend --region asia-northeast1 --project hamster-52b093 \
  --format='value(status.latestReadyRevisionName)'
```
Expected:
- `fix/dependency-security` with no ahead/behind count, at `ff30f4d` (if origin/main moved, re-check both "current state" tables).
- The grep shows exactly the "Now" column above.
- The current revision is `hamster-backend-00023-glm`. Write it down for Task 4.

- [ ] **Step 2: Apply the pins.** Make every change in the Node table: both `FROM` lines → `node:24.22.3-alpine`, the five `node-version` values → `'24.22.3'` (keep them quoted strings), and the three `volta.node` → `"24.22.3"`.

- [ ] **Step 3: Verify that nothing was missed**

```bash
grep -rnE "FROM node:|node-version:|\"node\": \"" backend/Dockerfile .github/workflows */package.json package.json
grep -rnE "24\.1[0-9]\.|24\.2[01]\.|node:24-alpine|node-version: '24'$" backend/Dockerfile .github/workflows */package.json
```
Expected: the first grep shows only `24.22.3` (2 FROM, 5 node-version, 3 volta). The second has no output.

- [ ] **Step 4: Local toolchain picks up the pin**

Run: `(cd backend && node -v) && (cd frontend && node -v) && (cd e2e && node -v)`
Expected: `v24.22.3` three times. Volta fetches it automatically. If Volta didn't fetch it, run `volta fetch node@24.22.3`.

- [ ] **Step 5: Commit**

```bash
git add backend/Dockerfile .github/workflows/backend.yml .github/workflows/ci.yml .github/workflows/frontend.yml backend/package.json frontend/package.json e2e/package.json
git commit -m "fix: pin Node.js to 24.22.3 (Nov 2026 security release) in Docker, CI and Volta"
```

### Task 2: Library lockfile refresh + full verification (run under Node 24.22.3)

**Files:**
- Modify: `backend/package-lock.json`
- Modify: `backend/package.json` (only the `express` / `fast-xml-parser` floors that `npm update` writes)

- [ ] **Step 1: Record installed versions and the prod audit (red)**

```bash
cd backend
npm ls express body-parser proxy-addr qs node-forge @fastify/busboy @grpc/grpc-js fast-xml-parser --all
npm audit --omit=dev --package-lock-only
```
Expected:
- Versions match the "installed" column.
- The audit lists proxy-addr, body-parser, node-forge, @fastify/busboy, @grpc/grpc-js, qs, fast-xml-parser and the uuid chain.

Save the output to the scratchpad for the PR. Also run `npm ci && npm test` once to record the baseline test count.

- [ ] **Step 2: Update within ranges**

```bash
npm update express body-parser proxy-addr qs node-forge @fastify/busboy @grpc/grpc-js fast-xml-parser
git diff package.json
```
Expected: besides Task 1's volta change, only `express` → `^4.22.3` and `fast-xml-parser` → `^5.12.1`. If anything else moved, revert it and rerun with only the names that are needed.

- [ ] **Step 3: Verify resolved versions and the prod audit (green)**

```bash
npm ls express body-parser proxy-addr qs node-forge @fastify/busboy @grpc/grpc-js fast-xml-parser --all
npm audit --omit=dev
```
Expected versions:
- express 4.22.3, body-parser 1.20.9, proxy-addr 2.0.8
- a single qs 6.16.x (≥6.16.1, no 6.15.x anywhere)
- node-forge 1.4.3, @fastify/busboy ≥3.2.2, @grpc/grpc-js ≥1.14.5, fast-xml-parser ≥5.12.0

The audit should show **only** the uuid chain, all moderate, with fix = firebase-admin 14: uuid, gaxios, google-gax, teeny-request, retry-request, @google-cloud/firestore, @google-cloud/storage, firebase-admin. No critical or high findings.

- [ ] **Step 4: Repo checks**

```bash
node -v           # v24.22.3
npm ci            # lockfile/package.json in sync
npm run lint
npx tsc --noEmit
npm test
npm run build
npm run format:check
```
Expected: all exit 0. The test count equals the baseline, and the `mediumRss` and bookmark route (supertest) tests ran and passed.

Then run the same checks in `frontend/` (`npm ci && npm run lint && npx tsc --noEmit && npm test && npm run build`) and in `e2e/` (`npm ci && npm test`, as in `ci.yml`), because their Node version changed.

- [ ] **Step 5: Commit**

```bash
git add backend/package.json backend/package-lock.json
git commit -m "fix(backend): update vulnerable production dependencies within semver ranges"
```
(Do **not** commit this plan file.)

### Task 3: Production image check (local)

**Files:** none

- [ ] **Step 1: Build the image**

Run: `docker build -t hamster-backend-audit backend`
Expected: success on `node:24.22.3-alpine`. The runtime-stage `npm ci --omit=dev` passes.

- [ ] **Step 2: Check the runtime and libraries inside it**

```bash
docker run --rm hamster-backend-audit node -v                                   # v24.22.3
docker image inspect hamster-backend-audit --format '{{range .Config.Env}}{{println .}}{{end}}' | grep NODE_VERSION   # NODE_VERSION=24.22.3
docker run --rm hamster-backend-audit npm ls qs node-forge proxy-addr body-parser --omit=dev
```
Expected: target versions. If Docker isn't available locally, note it in the PR and rely on the CI deploy job plus the Task 4 checks.

### Task 4: PR, deploy, confirm

- [ ] **Step 1: Push and open the PR** against `main`. Use this summary:
  - **Node.js runtime → 24.22.3** (November 2026 security release, 2026-11-11):
    - Prod Cloud Run was running 24.21.0 via floating `node:24-alpine`. Now `backend/Dockerfile` pins both stages to `node:24.22.3-alpine`.
    - CI: `ci.yml`/`frontend.yml` `24.18.0` → `24.22.3`, and `backend.yml` `'24'` → `24.22.3`.
    - Volta pins in backend/frontend/e2e: `24.17.0` → `24.22.3`.
    - Exposure note: plain `node:http` behind GFE, so the named TLS/HTTP2/HTTPS server CVEs aren't reachable. Redeploying picks up the client-side and llhttp/undici fixes.
  - **Libraries:** the installed → target table, and the before/after `npm audit --omit=dev` summary.
  - **Deploys triggered:** backend (Cloud Run) and frontend (Hosting; only the build Node changed).
  - The "Later" list below.

- [ ] **Step 2: CI.** `ci.yml` (frontend, backend and e2e jobs, now on 24.22.3) is green. In a job log, the "Setup Node" step shows `24.22.3`. Codex has reviewed.

- [ ] **Step 3: Merge, then confirm the backend deploy runs Node 24.22.3**

```bash
gh run list --workflow=backend.yml --limit 1     # completed / success, for the merge commit
REV=$(gcloud run services describe hamster-backend --region asia-northeast1 --project hamster-52b093 \
  --format='value(status.latestReadyRevisionName)')
echo $REV                                         # not hamster-backend-00023-glm; created after the merge
IMG=$(gcloud run revisions describe $REV --region asia-northeast1 --project hamster-52b093 \
  --format='value(spec.containers[0].image)')     # resolved digest
gcloud artifacts docker images describe "$IMG" --show-provenance --format=json | grep -i node_version   # or:
docker pull "$IMG" && docker image inspect "$IMG" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep NODE_VERSION
```
Expected: a new revision whose image digest differs from `sha256:6c75fcbc…`, and an image config with **`NODE_VERSION=24.22.3`**. Then:
- `curl -fsS <service-url>/health` → `{"ok":true}`
- Smoke test the live app (https://hamster-52b093.web.app): sign in and load the bookmark list (Firestore/grpc-js, Express JSON/qs). Add a Medium URL so the RSS runs through fast-xml-parser.
- `gcloud run services logs read hamster-backend --region asia-northeast1 --project hamster-52b093 --limit 50`: no errors.

- [ ] **Step 4: Confirm the frontend deploy.** `gh run list --workflow=frontend.yml --limit 1` → success. "Setup Node" shows 24.22.3. The site loads.

---

## Local machine (note, outside the repo diff)

The Volta default on this Mac is 24.16.0 (unfixed). The repo root (firebase-tools/emulators) has no volta pin, so it uses it. The new pins cover backend/frontend/e2e. To fix the default too: `volta install node@24.22.3`. Optionally remove the unused unfixed images (20.20.2, 22.23.0, 24.16.0, 24.17.0). Not part of this PR.

## Frontend libraries (note only, no action)

`frontend/` is flagged for `firebase` 10.14.1 → `@grpc/grpc-js` 1.9.16 and `undici` 6.19.7 (plus the @firebase/auth|functions|storage moderates). These are in the firebase SDK's **Node** build only and don't ship in the Vite browser bundle served by Firebase Hosting. npm's suggested `firebase@9.14.0` is a downgrade. Even the latest firebase pins `@grpc/grpc-js ~1.9.0`.

## Later (out of scope: major upgrades)

- **uuid 9.0.1 / 10.0.0 → 11.1.1** (moderate, GHSA-w5hq-g745-h8pq, via firebase-admin 12 → google-gax/gaxios/teeny-request): the only clean fix is **firebase-admin 12 → 14 (major, two majors)**, and the vulnerable `buf` argument isn't used. Plan a dedicated upgrade.
- **firebase (frontend) 10 → 12/13** (major): clears the @firebase/* undici moderates only. Optional, since nothing reaches the browser bundle.
- **vitest 1 → 3+/vite 5 → 6+, minimatch 11** (major, dev-only): tooling, out of scope. Listed so it isn't forgotten.
- **Pin the Docker base by digest** (`node:24.22.3-alpine@sha256:…`) and add Renovate/Dependabot for Node and the Docker base, so the next Node security release isn't missed. A process change, not part of this fix.
