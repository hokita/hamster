# hamster: Deploy & CI — Design

## Overview

This spec covers deploying hamster to real infrastructure and adding CI: Firebase Hosting (frontend) + Cloud Run (backend), GitHub Actions for both CI (lint/test/e2e gating every PR) and CD (deploy on push to `main`), Workload Identity Federation for keyless GCP auth, and the auth hardening required before this app is reachable from the real internet. This follows on from `2026-08-08-bookmark-app-environment-design.md` (local dev environment, implemented and merged), and mirrors the `corgi` repo's deploy setup, adapted to hamster's simpler (no-AI) stack.

## Goals

- Deploy the frontend to Firebase Hosting and the backend to Cloud Run, both automatically on push to `main`.
- Add a CI workflow that gates every PR on lint, typecheck, unit tests, and the full e2e suite.
- Close the `email_verified` gap in `authMiddleware` before the app is reachable outside the local emulators.
- No static GCP credentials anywhere — GitHub Actions authenticates via Workload Identity Federation.

## Non-goals

- Custom domain / DNS setup — the default `*.web.app` / `*.run.app` URLs are fine for personal use.
- Multi-environment (staging/prod) — single production environment only, matching corgi.
- Monitoring/alerting beyond what Cloud Run and Firebase provide by default.

## Infrastructure (already provisioned)

Created interactively during this planning session, mirroring corgi's setup:

| Resource | Value |
|---|---|
| GCP/Firebase project | `hamster-52b093` (project number `307699341719`) |
| Region | `asia-northeast1` (Cloud Run + Firestore, matching corgi) |
| Billing | Linked to the existing billing account |
| Firestore | Native mode, `asia-northeast1` |
| Firebase Auth | Google sign-in provider enabled |
| Firebase Web App | App ID `1:307699341719:web:8ceb6d32b5b108aab74cd2` |
| — `apiKey` | `AIzaSyD-6W4XYa-70FuYgnqD4Ou5RONVwcQPx-k` |
| — `authDomain` | `hamster-52b093.firebaseapp.com` |
| Artifact Registry | `hamster` repo, `asia-northeast1-docker.pkg.dev/hamster-52b093/hamster/backend` |
| WIF pool/provider | `projects/307699341719/locations/global/workloadIdentityPools/github-actions/providers/github`, restricted to `assertion.repository=='hokita/hamster'` |
| Deploy service account | `github-actions-deploy@hamster-52b093.iam.gserviceaccount.com` — roles: `artifactregistry.writer`, `datastore.indexAdmin`, `firebasehosting.admin`, `firebaserules.admin`, `iam.serviceAccountUser`, `run.developer`, `serviceusage.serviceUsageViewer` |
| Secret Manager | `ALLOWED_EMAILS` secret (value: the owner's email), readable by Cloud Run's default compute service account (`307699341719-compute@developer.gserviceaccount.com`) |
| GitHub repo secrets | `WIF_PROVIDER`, `WIF_SERVICE_ACCOUNT` (already set on `hokita/hamster`) |
| Firebase Hosting URL | `https://hamster-52b093.web.app` |

## Backend deploy: Dockerfile + Cloud Run

`backend/Dockerfile` — two-stage Alpine build, identical shape to corgi's:

```dockerfile
FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
EXPOSE 8080
CMD ["node", "dist/index.js"]
```

Deploy command (run from `backend.yml`):

```bash
gcloud run deploy hamster-backend \
  --image asia-northeast1-docker.pkg.dev/hamster-52b093/hamster/backend:latest \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 2 \
  --set-env-vars "FIREBASE_PROJECT_ID=hamster-52b093,FRONTEND_URL=https://hamster-52b093.web.app" \
  --set-secrets "ALLOWED_EMAILS=ALLOWED_EMAILS:latest"
```

`--allow-unauthenticated` is correct here — Cloud Run's own IAM isn't the access-control layer, `authMiddleware`'s allowlist check is. `--min-instances 0` keeps cost near-zero for personal-scale traffic (matches corgi).

## Frontend deploy: Firebase Hosting

`firebase.json` gains a `hosting` block (currently has only `firestore` + `emulators`):

```json
"hosting": {
  "public": "frontend/dist",
  "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
  "rewrites": [{ "source": "**", "destination": "/index.html" }]
}
```

New `.firebaserc`:

```json
{ "projects": { "default": "hamster-52b093" } }
```

Deploy step (`frontend.yml`): build with the real Firebase web config as build-time env vars, then `firebase deploy --only hosting`. Firebase's client config is public-facing by design (security is enforced by Firestore rules + backend auth, not by hiding these values), so it's set directly in the workflow YAML as plain values — not GitHub secrets — matching corgi's approach.

```yaml
env:
  VITE_FIREBASE_API_KEY: AIzaSyD-6W4XYa-70FuYgnqD4Ou5RONVwcQPx-k
  VITE_FIREBASE_AUTH_DOMAIN: hamster-52b093.firebaseapp.com
  VITE_FIREBASE_PROJECT_ID: hamster-52b093
  VITE_API_URL: <backend Cloud Run URL — known only after the first backend deploy>
```

## GitHub Actions workflows

Four workflows, matching corgi's structure:

| Workflow | Trigger | Steps |
|---|---|---|
| `ci.yml` | every PR | Three parallel jobs: `frontend` (install, lint, `tsc --noEmit`, test), `backend` (same), `e2e` (installs Java for the Firestore emulator + Playwright/Chromium, runs the full e2e suite) |
| `backend.yml` | push to `main`, path-filtered on `backend/**` | lint → test → build → WIF auth → Docker build/push → `gcloud run deploy` |
| `frontend.yml` | push to `main`, path-filtered on `frontend/**`, `firebase.json`, `.firebaserc` | lint → test → build (with web config env vars) → WIF auth → `firebase deploy --only hosting` |
| `firestore-rules.yml` | push to `main`, path-filtered on `firestore.rules`, `firestore.indexes.json`, `firebase.json` | WIF auth → `firebase deploy --only firestore` |

All deploy workflows authenticate via `google-github-actions/auth@v2` using the `WIF_PROVIDER`/`WIF_SERVICE_ACCOUNT` repo secrets — no static service-account keys anywhere. Path-filtering keeps deploys independent and minimal-blast-radius: a frontend-only change doesn't redeploy the backend.

## Auth hardening: `email_verified` check

**Problem:** `authMiddleware` currently accepts any token whose `email` claim is in `ALLOWED_EMAILS`, without checking `email_verified`. Against a real Firebase project, if the Email/Password sign-in provider were ever enabled, anyone could self-register the allowlisted address (unverified) and pass the check — bypassing the app's only security boundary.

**Fix:** `backend/src/middleware/auth.ts` also requires `decoded.email_verified === true`. Real Google sign-ins are always pre-verified, so this doesn't change normal usage.

**e2e implication:** the e2e test user is created via a raw `accounts:signUp` call against the Auth emulator (`e2e/global-setup.ts`), which produces an **unverified** account — a naive `email_verified` check would break e2e. Rather than gating the check behind an env flag (which would make prod and test run different security logic — a real footgun if ever misconfigured), `global-setup.ts` makes one additional `accounts:update` call (using the ID token returned by `accounts:signUp`) setting `emailVerified: true` on the test user. This matches how a real Google sign-in actually behaves, so `authMiddleware`'s logic stays identical in every environment — no flag, no env-dependent branch.

## Testing & verification

- `authMiddleware`'s new `email_verified` check gets new unit test cases (verified-and-allowed → 200, unverified-and-allowed-email → 401), following the existing test file's mocking pattern.
- The full local test suites (backend, frontend) and the e2e suite must stay green after the `global-setup.ts` change — this is the regression check that proves the fix doesn't break the existing local-dev flow.
- `ci.yml` itself is the acceptance test for the CI portion of this plan: opening a PR against this branch should show all three jobs (frontend/backend/e2e) running and passing.
- The deploy workflows can only be fully verified by actually merging to `main` and watching the real deploy — covered as manual verification steps at the end of the implementation plan, not automated tests.

## Open items / sequencing notes

- **Backend must deploy before frontend's first real deploy** — `frontend.yml`'s `VITE_API_URL` needs the Cloud Run service URL, which only exists after `backend.yml` runs once. The implementation plan should deploy backend manually once (via `gcloud run deploy` locally, using the command above) to obtain the URL, then hardcode it into `frontend.yml`, before enabling the automated frontend workflow.
- **Firestore rules already deployed?** No — `firestore.rules`/`firestore.indexes.json` exist locally (deny-all rules) but have never been pushed to the real `hamster-52b093` project. `firestore-rules.yml`'s first run (or a manual `firebase deploy --only firestore`) needs to happen so the real project's Firestore is actually locked down, not left at Firebase's more permissive un-configured default.
- **Custom domain, staging environment, monitoring**: explicitly out of scope per Non-goals — revisit only if actually needed later.
