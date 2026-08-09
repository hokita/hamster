# hamster: Bookmark App Environment — Design

## Overview

hamster is a personal bookmark manager: save a URL + title, view them in a list. Single user (the owner), gated by an email allowlist. This spec covers the first pass — standing up the full dev/deploy environment plus the minimal vertical slice needed to prove it works end to end. Richer bookmark features (edit, delete, tags, search, folders) are out of scope here and come in a later spec.

This design mirrors the architecture of the `corgi` repo (a personal AI chat app on the same stack), with AI-specific pieces (Gemini, Langfuse) dropped since they don't apply.

## Goals

- Stand up frontend + backend + Firestore + Auth, wired together and deployable.
- Prove the wiring works with a minimal vertical slice: log in, add a bookmark, see it in a list.
- Local dev environment (emulators) and full deploy/CI pipeline, matching corgi's parity.

## Non-goals (this pass)

- Edit/delete bookmarks, tags, search, folders, favicon/title fetching.
- Multi-user support — the allowlist is scoped to a single owner email.
- Browser extension or import/export.

## Architecture

```
hamster/
├── frontend/   # React 18 + Vite + TS + Tailwind v4, Firebase Auth
├── backend/    # Node 24 + Express + TS, Firebase Admin SDK
└── e2e/        # Playwright, full login → add → list flow
```

- The frontend never talks to Firestore directly — only to Firebase Auth (login) and the backend API.
- The backend is the only thing that touches Firestore, via the Admin SDK (which runs with service-account privileges and bypasses Firestore security rules).
- Firestore rules deny all direct client access (`allow read, write: if false`), identical posture to corgi's — closes the database to the public internet while backend-mediated access keeps working.
- Auth: Firebase Auth (Google sign-in) client-side, verified server-side by an Express `authMiddleware` that checks the decoded token's email against an `ALLOWED_EMAILS` env var (comma-separated, same shape as corgi's even though it holds one email here).

## Data model

Firestore collection `bookmarks`, no per-user partitioning needed — the allowlist already restricts the whole app to a single owner.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Firestore doc ID |
| `url` | string | required |
| `title` | string | required |
| `createdAt` | timestamp | server-set on create |

## API surface

All routes under `/api/bookmarks` except `/health`, protected by `authMiddleware`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | unauthenticated health check |
| GET | `/api/bookmarks` | list all bookmarks, newest first |
| POST | `/api/bookmarks` | create `{ url, title }` |

## Frontend

- `src/firebase.ts` — Firebase client init (Auth), mirrors corgi's `frontend/src/firebase.ts`.
- Login screen (Google sign-in via Firebase Auth).
- Bookmark form (URL + title) that POSTs to the backend.
- Bookmark list that GETs from the backend, newest first.

## Local development

- Firebase emulators: Auth (`:9099`), Firestore (`:8081`) — same ports as corgi.
- `backend/.env`: `ALLOWED_EMAILS`, `FIREBASE_PROJECT_ID`, `FRONTEND_URL`, `PORT`.
- `frontend/.env`: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_API_URL`.
- `npm run dev` in each of `frontend/` and `backend/`.

## Testing (TDD — red/green)

- Backend: Vitest + Supertest for route tests, following corgi's `app.test.ts` pattern.
- Frontend: Vitest + Testing Library for component tests.
- E2E: Playwright in `e2e/`, one test covering login → add bookmark → see it in list, run against emulators.

## Deploy & CI

Full corgi parity:

- Frontend → Firebase Hosting.
- Backend → Cloud Run (`asia-northeast1`), two-stage Alpine Dockerfile (build → slim runtime), `--min-instances 0 --max-instances 2` (scale-to-zero, cheap personal-scale config).
- GitHub Actions:
  - `ci.yml` — lint, typecheck, test (frontend + backend) and e2e on every PR.
  - `frontend.yml` — deploy to Firebase Hosting on push to `main` when `frontend/**` changes.
  - `backend.yml` — build/push Docker image and deploy to Cloud Run on push to `main` when `backend/**` changes.
  - `firestore-rules.yml` — deploy `firestore.rules` / `firestore.indexes.json` on push to `main` when they change.
- GCP auth via Workload Identity Federation (no static service-account keys), same as corgi.
- Secrets (`ALLOWED_EMAILS`) via GCP Secret Manager, wired into Cloud Run via `--set-secrets`.

## Open items / setup dependencies

- **New Firebase/GCP project**: does not exist yet. Needs creating via `firebase login` + project creation, which requires interactive Google account auth — done alongside implementation, not automatable end-to-end.
- **Workload Identity Federation pool**: needs setting up for the new project so GitHub Actions can deploy without static keys.
- **Owner's allowlisted email**: the single value for `ALLOWED_EMAILS`.
