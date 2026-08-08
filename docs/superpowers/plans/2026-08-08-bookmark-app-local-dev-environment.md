# Bookmark App Local Dev Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up hamster's local dev environment — backend, frontend, Firestore emulator, e2e — with a working vertical slice: log in, add a bookmark, see it in a list.

**Architecture:** Split stack mirroring the `corgi` repo, minus AI-specific pieces: React 18 + Vite + TS + Tailwind v4 frontend talking only to Firebase Auth and a Node 24 + Express + TS backend; the backend is the only thing touching Firestore, via the Admin SDK (bypasses Firestore rules, which deny all direct client access). Auth is Firebase Auth (Google sign-in) gated server-side by an `ALLOWED_EMAILS` allowlist.

**Tech Stack:** React 18, Vite, TypeScript, Tailwind CSS v4, Firebase Auth (client), Node 24, Express, firebase-admin, Firestore, Vitest, Supertest, Testing Library, Playwright.

**Related spec:** `docs/superpowers/specs/2026-08-08-bookmark-app-environment-design.md`

**Not covered by this plan** (see the follow-up deploy/CI plan): real GCP/Firebase project creation, Firebase Hosting, Cloud Run, GitHub Actions, Workload Identity Federation. This plan uses Firebase's `demo-*` project ID convention, which runs emulators in fully offline mode with no real GCP project required.

## Global Constraints

- Node.js 24, npm as the package manager (matches corgi).
- TypeScript strict mode throughout.
- TDD (red/green): write the failing test first, then the minimal implementation, for every piece of logic — per the user's global workflow instructions.
- Firebase Auth (Google sign-in) gated by an `ALLOWED_EMAILS` env var (comma-separated), checked server-side.
- Firestore is only ever accessed from the backend via the Admin SDK; Firestore security rules deny all direct client access (`allow read, write: if false`).
- Firebase emulator ports: Auth `9099`, Firestore `8081` (matches corgi).
- `services/firestore.ts` (real Firestore calls) is covered by the e2e suite against the Firestore emulator, not unit tests — route logic is unit-tested via mocking the service module, matching corgi's pattern. Do not add a unit test file for it.
- No react-router, no PWA plugin, no FontAwesome — YAGNI simplifications versus corgi, since hamster has exactly two views (logged out / logged in) and no offline requirement in the spec.
- `.env.e2e` files hold only fake/emulator credentials and are committed to git (not gitignored) for reproducibility, matching corgi.

---

## File Structure

```
hamster/
├── package.json                      # root: firebase-tools + emulators script
├── .gitignore
├── .prettierrc
├── .prettierignore
├── firebase.json                     # firestore + emulator config only (hosting added in deploy plan)
├── firestore.rules                   # deny-all
├── firestore.indexes.json
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── eslint.config.mjs
│   ├── vitest.config.ts
│   ├── .env.example
│   ├── .env.e2e
│   └── src/
│       ├── index.ts
│       ├── app.ts
│       ├── app.test.ts
│       ├── config/firebase.ts
│       ├── middleware/auth.ts
│       ├── middleware/auth.test.ts
│       ├── services/firestore.ts
│       └── routes/
│           ├── bookmarks.ts
│           └── bookmarks.test.ts
├── frontend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── eslint.config.js
│   ├── index.html
│   ├── .env.example
│   ├── .env.e2e
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── App.test.tsx
│       ├── index.css
│       ├── vite-env.d.ts
│       ├── test-setup.ts
│       ├── firebase.ts
│       ├── firebase.test.ts
│       ├── api.ts
│       ├── api.test.ts
│       ├── pages/
│       │   ├── LoginPage.tsx
│       │   ├── LoginPage.test.tsx
│       │   ├── BookmarksPage.tsx
│       │   └── BookmarksPage.test.tsx
│       └── components/
│           ├── BookmarkForm.tsx
│           ├── BookmarkForm.test.tsx
│           ├── BookmarkList.tsx
│           └── BookmarkList.test.tsx
└── e2e/
    ├── package.json
    ├── playwright.config.ts
    ├── global-setup.ts
    ├── fixtures/
    │   ├── auth.ts
    │   └── firestore.ts
    └── tests/
        └── bookmarks.spec.ts
```

---

### Task 1: Root tooling & Firebase local config

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.prettierrc`
- Create: `.prettierignore`
- Create: `firebase.json`
- Create: `firestore.rules`
- Create: `firestore.indexes.json`

**Interfaces:**
- Produces: `demo-hamster` — the Firebase project ID used for local (non-e2e) emulator runs. Firebase treats any `demo-*` project ID as fully offline (no real GCP project contacted). Later tasks' `.env` files reference this indirectly by leaving `FIREBASE_PROJECT_ID` set to `demo-hamster` for local dev.
- Produces: `npm run emulators` at the repo root — starts the Auth + Firestore emulators.

No TDD cycle in this task — it's infrastructure config with no application logic to unit test. The deliverable is verified by running the emulators.

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "hamster",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "emulators": "firebase emulators:start --project demo-hamster"
  },
  "devDependencies": {
    "firebase-tools": "^15.22.0"
  }
}
```

- [ ] **Step 2: Create root `.gitignore`**

```
node_modules/
dist/
.env
.env.local
.env.production
*.js.map
*-debug.log
.firebase/
```

- [ ] **Step 3: Create root `.prettierrc`**

```json
{
  "semi": false,
  "singleQuote": true,
  "trailingComma": "es5",
  "printWidth": 100,
  "tabWidth": 2
}
```

- [ ] **Step 4: Create root `.prettierignore`**

```
node_modules/
dist/
*.lock
```

- [ ] **Step 5: Create `firebase.json`**

```json
{
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "emulators": {
    "auth": {
      "port": 9099
    },
    "firestore": {
      "port": 8081
    },
    "ui": {
      "enabled": false
    }
  }
}
```

- [ ] **Step 6: Create `firestore.rules`**

```
rules_version = '2';

// hamster Firestore security rules.
//
// All Firestore access in this app goes through the backend, which uses the
// Firebase Admin SDK. The Admin SDK runs with service-account privileges and
// bypasses these rules entirely, so the app keeps functioning normally.
//
// No client (the React frontend or anything else) ever reads or writes
// Firestore directly — the frontend only uses Firebase Auth and talks to the
// backend API. Therefore direct client access is denied across the board.
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

- [ ] **Step 7: Create `firestore.indexes.json`**

```json
{
  "indexes": [],
  "fieldOverrides": []
}
```

- [ ] **Step 8: Install and verify emulators start**

Run: `npm install`

Run: `npm run emulators`

Expected: terminal output shows the Auth emulator listening on `9099` and the Firestore emulator listening on `8081`, with no errors. Stop with `Ctrl+C`.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json .gitignore .prettierrc .prettierignore firebase.json firestore.rules firestore.indexes.json
git commit -m "chore: scaffold root tooling and Firebase emulator config"
```

---

### Task 2: Backend scaffold + health check

**Files:**
- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/eslint.config.mjs`
- Create: `backend/vitest.config.ts`
- Create: `backend/.env.example`
- Create: `backend/src/app.ts`
- Create: `backend/src/app.test.ts`
- Create: `backend/src/index.ts`

**Interfaces:**
- Produces: `createApp(): express.Express` from `backend/src/app.ts` — used by `index.ts` (this task) and by every later backend task that mounts new routes.

- [ ] **Step 1: Create `backend/package.json`**

```json
{
  "name": "hamster-backend",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "tsx watch --env-file=.env src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "start:e2e": "tsx --env-file=.env.e2e src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src",
    "format": "prettier --write .",
    "format:check": "prettier --check ."
  },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.18.0",
    "firebase-admin": "^12.0.0"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^24.0.0",
    "@types/supertest": "^6.0.0",
    "eslint": "^10.5.0",
    "prettier": "^3.3.0",
    "supertest": "^7.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0",
    "typescript-eslint": "^8.61.1",
    "vitest": "^1.6.0"
  },
  "volta": {
    "node": "24.17.0"
  }
}
```

- [ ] **Step 2: Create `backend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

- [ ] **Step 3: Create `backend/eslint.config.mjs`**

```js
import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(eslint.configs.recommended, tseslint.configs.recommended, {
  ignores: ['dist/**'],
})
```

- [ ] **Step 4: Create `backend/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
  },
})
```

- [ ] **Step 5: Create `backend/.env.example`**

```
# Comma-separated Google account email addresses authorized to use the app.
ALLOWED_EMAILS=you@gmail.com
FIREBASE_PROJECT_ID=demo-hamster
FRONTEND_URL=http://localhost:5173
PORT=8080
```

- [ ] **Step 6: Install dependencies**

Run: `cd backend && npm install`

- [ ] **Step 7: Write the failing test**

Create `backend/src/app.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from './app'

describe('GET /health', () => {
  it('returns ok', async () => {
    const res = await request(createApp()).get('/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })
})
```

- [ ] **Step 8: Run test to verify it fails**

Run: `cd backend && npm test`
Expected: FAIL — `./app` has no exported member `createApp` (module doesn't exist yet).

- [ ] **Step 9: Write minimal implementation**

Create `backend/src/app.ts`:

```ts
import express from 'express'
import cors from 'cors'

export function createApp() {
  const app = express()
  // In dev (FRONTEND_URL unset), cors defaults to allow all origins — intentional for local development
  app.use(cors({ origin: process.env.FRONTEND_URL }))
  app.use(express.json())
  app.get('/health', (_req, res) => res.json({ ok: true }))
  return app
}
```

- [ ] **Step 10: Run test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS

- [ ] **Step 11: Create the entry point**

Create `backend/src/index.ts`:

```ts
import { createApp } from './app'

const port = Number(process.env.PORT) || 8080
createApp().listen(port, () => {
  console.log(`Listening on port ${port}`)
})
```

- [ ] **Step 12: Smoke check**

Run: `cd backend && cp .env.example .env && npm run dev`
Expected: console prints `Listening on port 8080`. In another terminal, `curl http://localhost:8080/health` returns `{"ok":true}`. Stop the dev server.

- [ ] **Step 13: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/tsconfig.json backend/eslint.config.mjs backend/vitest.config.ts backend/.env.example backend/src/app.ts backend/src/app.test.ts backend/src/index.ts
git commit -m "feat(backend): scaffold Express app with health check"
```

---

### Task 3: Backend Firebase Admin init + auth middleware

**Files:**
- Create: `backend/src/config/firebase.ts`
- Create: `backend/src/middleware/auth.ts`
- Create: `backend/src/middleware/auth.test.ts`
- Modify: `backend/src/index.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks beyond the project scaffold.
- Produces: `initFirebase(): void` from `backend/src/config/firebase.ts` — called once at process start in `index.ts`.
- Produces: `authMiddleware(req, res, next): Promise<void>` from `backend/src/middleware/auth.ts` — an Express middleware, consumed by Task 4 to protect the bookmarks routes.

- [ ] **Step 1: Create `backend/src/config/firebase.ts`**

```ts
import { initializeApp } from 'firebase-admin/app'

// Cloud Run supplies a project ID via its metadata server; local dev has no
// such source, so verifyIdToken() fails with auth/invalid-credential unless
// it's passed explicitly here.
export function initFirebase(): void {
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID })
}
```

- [ ] **Step 2: Write the failing test**

Create `backend/src/middleware/auth.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

const mockVerifyIdToken = vi.fn()
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}))

import { authMiddleware } from './auth'

const app = express()
app.get('/test', authMiddleware, (_req, res) => res.json({ ok: true }))

describe('authMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ALLOWED_EMAILS = 'owner@example.com'
  })

  it('returns 401 when Authorization header is missing', async () => {
    const res = await request(app).get('/test')
    expect(res.status).toBe(401)
  })

  it('returns 401 when token verification fails', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('Invalid token'))
    const res = await request(app).get('/test').set('Authorization', 'Bearer bad-token')
    expect(res.status).toBe(401)
  })

  it('returns 401 when email is not in the allowlist', async () => {
    mockVerifyIdToken.mockResolvedValue({ email: 'other@example.com' })
    const res = await request(app).get('/test').set('Authorization', 'Bearer valid-token')
    expect(res.status).toBe(401)
  })

  it('returns 401 when the token has no email claim', async () => {
    mockVerifyIdToken.mockResolvedValue({ email: undefined })
    const res = await request(app).get('/test').set('Authorization', 'Bearer valid-token')
    expect(res.status).toBe(401)
  })

  it('calls next when the token is valid and the email is allowed', async () => {
    mockVerifyIdToken.mockResolvedValue({ email: 'owner@example.com' })
    const res = await request(app).get('/test').set('Authorization', 'Bearer valid-token')
    expect(res.status).toBe(200)
  })

  it('accepts case and whitespace variations in the configured address', async () => {
    process.env.ALLOWED_EMAILS = ' Owner@Example.com '
    mockVerifyIdToken.mockResolvedValue({ email: 'OWNER@example.com' })
    const res = await request(app).get('/test').set('Authorization', 'Bearer valid-token')
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npm test`
Expected: FAIL — `./auth` module does not exist.

- [ ] **Step 4: Write minimal implementation**

Create `backend/src/middleware/auth.ts`:

```ts
import type { Request, Response, NextFunction } from 'express'
import { getAuth } from 'firebase-admin/auth'

function allowedEmails(): Set<string> {
  return new Set(
    (process.env.ALLOWED_EMAILS ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  )
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = req.headers.authorization?.split('Bearer ')[1]
  if (!token) {
    res.status(401).json({ error: 'Missing token' })
    return
  }
  try {
    const decoded = await getAuth().verifyIdToken(token)
    if (!decoded.email || !allowedEmails().has(decoded.email.toLowerCase())) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    next()
  } catch {
    res.status(401).json({ error: 'Invalid token' })
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS

- [ ] **Step 6: Wire Firebase init into the entry point**

Modify `backend/src/index.ts`:

```ts
import { initFirebase } from './config/firebase'
import { createApp } from './app'

initFirebase()

const port = Number(process.env.PORT) || 8080
createApp().listen(port, () => {
  console.log(`Listening on port ${port}`)
})
```

- [ ] **Step 7: Run the full backend test suite**

Run: `cd backend && npm test`
Expected: PASS (all tests, including `app.test.ts` from Task 2)

- [ ] **Step 8: Commit**

```bash
git add backend/src/config/firebase.ts backend/src/middleware/auth.ts backend/src/middleware/auth.test.ts backend/src/index.ts
git commit -m "feat(backend): add Firebase init and allowlist auth middleware"
```

---

### Task 4: Backend bookmarks service + routes

**Files:**
- Create: `backend/src/services/firestore.ts`
- Create: `backend/src/routes/bookmarks.ts`
- Create: `backend/src/routes/bookmarks.test.ts`
- Modify: `backend/src/app.ts`
- Modify: `backend/src/app.test.ts`

**Interfaces:**
- Consumes: `authMiddleware` from `backend/src/middleware/auth.ts` (Task 3).
- Produces: `listBookmarks(): Promise<BookmarkDoc[]>` and `createBookmark(url: string, title: string): Promise<BookmarkDoc>` from `backend/src/services/firestore.ts`, where `BookmarkDoc = { id: string; url: string; title: string; createdAt: string }` (ISO 8601 string).
- Produces: `createBookmarksRouter(): Router` from `backend/src/routes/bookmarks.ts`, mounted at `/api/bookmarks`.

- [ ] **Step 1: Write the failing route test**

Create `backend/src/routes/bookmarks.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../services/firestore', () => ({
  listBookmarks: vi.fn(),
  createBookmark: vi.fn(),
}))

import { createBookmarksRouter } from './bookmarks'
import * as db from '../services/firestore'

const app = express()
app.use(express.json())
app.use('/api/bookmarks', createBookmarksRouter())

describe('GET /api/bookmarks', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the list of bookmarks', async () => {
    vi.mocked(db.listBookmarks).mockResolvedValue([
      {
        id: '1',
        url: 'https://example.com',
        title: 'Example',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ])
    const res = await request(app).get('/api/bookmarks')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].title).toBe('Example')
  })
})

describe('POST /api/bookmarks', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a bookmark and returns it', async () => {
    vi.mocked(db.createBookmark).mockResolvedValue({
      id: '1',
      url: 'https://example.com',
      title: 'Example',
      createdAt: '2024-01-01T00:00:00.000Z',
    })
    const res = await request(app)
      .post('/api/bookmarks')
      .send({ url: 'https://example.com', title: 'Example' })
    expect(res.status).toBe(201)
    expect(db.createBookmark).toHaveBeenCalledWith('https://example.com', 'Example')
    expect(res.body.title).toBe('Example')
  })

  it('returns 400 when url is missing', async () => {
    const res = await request(app).post('/api/bookmarks').send({ title: 'Example' })
    expect(res.status).toBe(400)
    expect(db.createBookmark).not.toHaveBeenCalled()
  })

  it('returns 400 when title is missing', async () => {
    const res = await request(app).post('/api/bookmarks').send({ url: 'https://example.com' })
    expect(res.status).toBe(400)
    expect(db.createBookmark).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test`
Expected: FAIL — `./bookmarks` module does not exist.

- [ ] **Step 3: Write the Firestore service (no direct unit test — see Global Constraints)**

Create `backend/src/services/firestore.ts`:

```ts
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

export interface BookmarkDoc {
  id: string
  url: string
  title: string
  createdAt: string
}

export async function createBookmark(url: string, title: string): Promise<BookmarkDoc> {
  const db = getFirestore()
  const now = Timestamp.now()
  const ref = await db.collection('bookmarks').add({ url, title, createdAt: now })
  return { id: ref.id, url, title, createdAt: now.toDate().toISOString() }
}

export async function listBookmarks(): Promise<BookmarkDoc[]> {
  const db = getFirestore()
  const snap = await db.collection('bookmarks').orderBy('createdAt', 'desc').get()
  return snap.docs.map((doc) => {
    const data = doc.data() as { url: string; title: string; createdAt: Timestamp }
    return {
      id: doc.id,
      url: data.url,
      title: data.title,
      createdAt: data.createdAt.toDate().toISOString(),
    }
  })
}
```

- [ ] **Step 4: Write the router implementation**

Create `backend/src/routes/bookmarks.ts`:

```ts
import { Router } from 'express'
import type { Request, Response } from 'express'
import * as db from '../services/firestore'

export function createBookmarksRouter(): Router {
  const router = Router()

  router.get('/', async (_req: Request, res: Response) => {
    const bookmarks = await db.listBookmarks()
    res.json(bookmarks)
  })

  router.post('/', async (req: Request, res: Response) => {
    const { url, title } = req.body as { url?: string; title?: string }
    if (!url || !title) {
      res.status(400).json({ error: 'url and title are required' })
      return
    }
    const bookmark = await db.createBookmark(url, title)
    res.status(201).json(bookmark)
  })

  return router
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS

- [ ] **Step 6: Write the failing app-level auth test**

Modify `backend/src/app.test.ts`, adding this describe block:

```ts
describe('GET /api/bookmarks', () => {
  it('requires authentication', async () => {
    const res = await request(createApp()).get('/api/bookmarks')
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd backend && npm test`
Expected: FAIL — `/api/bookmarks` is not mounted yet, so the request 404s instead of returning 401.

- [ ] **Step 8: Wire the router into the app behind auth**

Modify `backend/src/app.ts`:

```ts
import express from 'express'
import cors from 'cors'
import { authMiddleware } from './middleware/auth'
import { createBookmarksRouter } from './routes/bookmarks'

export function createApp() {
  const app = express()
  // In dev (FRONTEND_URL unset), cors defaults to allow all origins — intentional for local development
  app.use(cors({ origin: process.env.FRONTEND_URL }))
  app.use(express.json())
  app.get('/health', (_req, res) => res.json({ ok: true }))
  app.use('/api/bookmarks', authMiddleware, createBookmarksRouter())
  return app
}
```

- [ ] **Step 9: Run the full backend test suite**

Run: `cd backend && npm test`
Expected: PASS (all tests)

- [ ] **Step 10: Commit**

```bash
git add backend/src/services/firestore.ts backend/src/routes/bookmarks.ts backend/src/routes/bookmarks.test.ts backend/src/app.ts backend/src/app.test.ts
git commit -m "feat(backend): add bookmarks Firestore service and API routes"
```

---

### Task 5: Frontend scaffold + Tailwind + Firebase client

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/eslint.config.js`
- Create: `frontend/index.html`
- Create: `frontend/.env.example`
- Create: `frontend/src/index.css`
- Create: `frontend/src/vite-env.d.ts`
- Create: `frontend/src/test-setup.ts`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/firebase.ts`
- Create: `frontend/src/firebase.test.ts`

**Interfaces:**
- Produces: `auth` (a `firebase/auth` `Auth` instance) exported from `frontend/src/firebase.ts` — consumed by every later frontend task.
- Produces: a placeholder `App` component that Task 6 will replace with the real conditional-render logic.

- [ ] **Step 1: Create `frontend/package.json`**

```json
{
  "name": "hamster-frontend",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "dev:e2e": "vite --mode e2e --port 5174 --strictPort",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src",
    "format": "prettier --write .",
    "format:check": "prettier --check ."
  },
  "dependencies": {
    "firebase": "^10.12.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@tailwindcss/vite": "^4.3.1",
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/react": "^16.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "eslint": "^10.5.0",
    "eslint-plugin-react-hooks": "^7.1.1",
    "eslint-plugin-react-refresh": "^0.5.3",
    "globals": "^17.6.0",
    "jsdom": "^24.1.0",
    "prettier": "^3.3.0",
    "tailwindcss": "^4.3.1",
    "typescript": "^5.4.0",
    "typescript-eslint": "^8.61.1",
    "vite": "^5.3.0",
    "vitest": "^1.6.0"
  },
  "volta": {
    "node": "24.17.0"
  }
}
```

- [ ] **Step 2: Create `frontend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true
  },
  "include": ["src"],
  "exclude": ["**/*.test.ts", "**/*.test.tsx"]
}
```

- [ ] **Step 3: Create `frontend/vite.config.ts`**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test-setup.ts',
  },
})
```

- [ ] **Step 4: Create `frontend/eslint.config.js`**

```js
import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'

export default tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    ignores: ['dist/**'],
  }
)
```

- [ ] **Step 5: Create `frontend/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>hamster</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create `frontend/.env.example`**

```
VITE_FIREBASE_API_KEY=your-firebase-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_API_URL=http://localhost:8080
```

- [ ] **Step 7: Create `frontend/src/index.css`**

```css
@import 'tailwindcss';

*,
*::before,
*::after {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  -webkit-text-size-adjust: 100%;
}
```

- [ ] **Step 8: Create `frontend/src/vite-env.d.ts`**

```ts
/// <reference types="vite/client" />
```

- [ ] **Step 9: Create `frontend/src/test-setup.ts`**

```ts
import '@testing-library/jest-dom'
```

- [ ] **Step 10: Create a placeholder `frontend/src/App.tsx`**

```tsx
export default function App() {
  return <div className="p-6">hamster</div>
}
```

- [ ] **Step 11: Create `frontend/src/main.tsx`**

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

- [ ] **Step 12: Install dependencies**

Run: `cd frontend && npm install`

- [ ] **Step 13: Write the failing test**

Create `frontend/src/firebase.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockConnectAuthEmulator = vi.fn()
const mockGetAuth = vi.fn(() => ({}))

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({})),
}))
vi.mock('firebase/auth', () => ({
  getAuth: mockGetAuth,
  connectAuthEmulator: mockConnectAuthEmulator,
}))

describe('firebase emulator wiring', () => {
  beforeEach(() => {
    vi.resetModules()
    mockConnectAuthEmulator.mockClear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('connects to the Auth emulator when VITE_E2E is true', async () => {
    vi.stubEnv('VITE_E2E', 'true')
    await import('./firebase')
    expect(mockConnectAuthEmulator).toHaveBeenCalledWith(
      expect.anything(),
      'http://localhost:9099',
      { disableWarnings: true }
    )
  })

  it('does not connect to the Auth emulator otherwise', async () => {
    vi.stubEnv('VITE_E2E', 'false')
    await import('./firebase')
    expect(mockConnectAuthEmulator).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 14: Run test to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — `./firebase` module does not exist.

- [ ] **Step 15: Write minimal implementation**

Create `frontend/src/firebase.ts`:

```ts
import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator } from 'firebase/auth'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
}

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)

if (import.meta.env.VITE_E2E === 'true') {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true })
}
```

- [ ] **Step 16: Run test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS

- [ ] **Step 17: Smoke check**

Run: `cd frontend && cp .env.example .env && npm run dev`
Expected: dev server starts on `:5173`; opening it in a browser shows "hamster". Stop the dev server.

- [ ] **Step 18: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/tsconfig.json frontend/vite.config.ts frontend/eslint.config.js frontend/index.html frontend/.env.example frontend/src/index.css frontend/src/vite-env.d.ts frontend/src/test-setup.ts frontend/src/App.tsx frontend/src/main.tsx frontend/src/firebase.ts frontend/src/firebase.test.ts
git commit -m "feat(frontend): scaffold Vite/React/Tailwind app with Firebase client"
```

---

### Task 6: Frontend auth flow — LoginPage + App

**Files:**
- Create: `frontend/src/pages/LoginPage.tsx`
- Create: `frontend/src/pages/LoginPage.test.tsx`
- Create: `frontend/src/pages/BookmarksPage.tsx` (placeholder — replaced in Task 8)
- Modify: `frontend/src/App.tsx`
- Create: `frontend/src/App.test.tsx`

**Interfaces:**
- Consumes: `auth` from `frontend/src/firebase.ts` (Task 5).
- Produces: default export `LoginPage` from `frontend/src/pages/LoginPage.tsx`.
- Produces: default export `BookmarksPage` from `frontend/src/pages/BookmarksPage.tsx` — a placeholder in this task; Task 8 replaces its contents (App's import stays the same).

- [ ] **Step 1: Write the failing LoginPage test**

Create `frontend/src/pages/LoginPage.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockSignInWithPopup, mockSignInWithEmailAndPassword } = vi.hoisted(() => ({
  mockSignInWithPopup: vi.fn().mockResolvedValue(undefined),
  mockSignInWithEmailAndPassword: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: vi.fn(),
  signInWithPopup: mockSignInWithPopup,
  signInWithEmailAndPassword: mockSignInWithEmailAndPassword,
}))
vi.mock('../firebase', () => ({ auth: {} }))

import LoginPage from './LoginPage'

describe('LoginPage', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.unstubAllEnvs())

  it('signs in with the real Google popup by default', async () => {
    render(<LoginPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }))
    await waitFor(() => expect(mockSignInWithPopup).toHaveBeenCalled())
    expect(mockSignInWithEmailAndPassword).not.toHaveBeenCalled()
  })

  it('signs in against the Auth emulator with a fixed test user in e2e mode', async () => {
    vi.stubEnv('VITE_E2E', 'true')
    vi.stubEnv('VITE_E2E_TEST_EMAIL', 'e2e@example.com')
    vi.stubEnv('VITE_E2E_TEST_PASSWORD', 'e2e-test-password-123')

    render(<LoginPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }))
    await waitFor(() =>
      expect(mockSignInWithEmailAndPassword).toHaveBeenCalledWith(
        {},
        'e2e@example.com',
        'e2e-test-password-123'
      )
    )
    expect(mockSignInWithPopup).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — `./LoginPage` module does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/pages/LoginPage.tsx`:

```tsx
import { GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword } from 'firebase/auth'
import { auth } from '../firebase'

export default function LoginPage() {
  async function handleSignIn() {
    if (import.meta.env.VITE_E2E === 'true') {
      await signInWithEmailAndPassword(
        auth,
        import.meta.env.VITE_E2E_TEST_EMAIL,
        import.meta.env.VITE_E2E_TEST_PASSWORD
      )
      return
    }
    const provider = new GoogleAuthProvider()
    await signInWithPopup(auth, provider)
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-dvh gap-6">
      <h1 className="text-3xl font-bold m-0">hamster</h1>
      <button
        onClick={handleSignIn}
        className="px-6 py-3 text-base cursor-pointer rounded-lg border border-gray-300 hover:bg-gray-50 active:bg-gray-100"
      >
        Sign in with Google
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS

- [ ] **Step 5: Create the `BookmarksPage` placeholder**

Create `frontend/src/pages/BookmarksPage.tsx`:

```tsx
export default function BookmarksPage() {
  return <div className="p-6">Bookmarks</div>
}
```

- [ ] **Step 6: Write the failing App test**

Create `frontend/src/App.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

const mockOnAuthStateChanged = vi.fn()
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: mockOnAuthStateChanged,
}))
vi.mock('./firebase', () => ({ auth: {} }))
vi.mock('./pages/LoginPage', () => ({ default: () => <div>login page</div> }))
vi.mock('./pages/BookmarksPage', () => ({ default: () => <div>bookmarks page</div> }))

import App from './App'

describe('App', () => {
  it('renders nothing while auth state is unknown', () => {
    mockOnAuthStateChanged.mockImplementation(() => () => {})
    const { container } = render(<App />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders LoginPage when signed out', () => {
    mockOnAuthStateChanged.mockImplementation((_auth, callback) => {
      callback(null)
      return () => {}
    })
    render(<App />)
    expect(screen.getByText('login page')).toBeInTheDocument()
  })

  it('renders BookmarksPage when signed in', () => {
    mockOnAuthStateChanged.mockImplementation((_auth, callback) => {
      callback({ uid: 'u1' })
      return () => {}
    })
    render(<App />)
    expect(screen.getByText('bookmarks page')).toBeInTheDocument()
  })
})
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — `App` still renders the static placeholder from Task 5, not the mocked page content.

- [ ] **Step 8: Write minimal implementation**

Modify `frontend/src/App.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import type { User } from 'firebase/auth'
import { auth } from './firebase'
import LoginPage from './pages/LoginPage'
import BookmarksPage from './pages/BookmarksPage'

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined)

  useEffect(() => {
    return onAuthStateChanged(auth, setUser)
  }, [])

  if (user === undefined) return null
  return user ? <BookmarksPage /> : <LoginPage />
}
```

- [ ] **Step 9: Run the full frontend test suite**

Run: `cd frontend && npm test`
Expected: PASS (all tests)

- [ ] **Step 10: Commit**

```bash
git add frontend/src/pages/LoginPage.tsx frontend/src/pages/LoginPage.test.tsx frontend/src/pages/BookmarksPage.tsx frontend/src/App.tsx frontend/src/App.test.tsx
git commit -m "feat(frontend): add login flow and auth-gated App shell"
```

---

### Task 7: Frontend API client

**Files:**
- Create: `frontend/src/api.ts`
- Create: `frontend/src/api.test.ts`

**Interfaces:**
- Consumes: `auth` from `frontend/src/firebase.ts` (Task 5).
- Produces: `api.listBookmarks(): Promise<Bookmark[]>` and `api.createBookmark(bookmark: { url: string; title: string }): Promise<Bookmark>` from `frontend/src/api.ts`, where `Bookmark = { id: string; url: string; title: string; createdAt: string }`. Consumed by Task 8.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/api.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./firebase', () => ({
  auth: { currentUser: { getIdToken: vi.fn().mockResolvedValue('fake-token') } },
}))

import { api } from './api'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

beforeEach(() => {
  mockFetch.mockReset()
})

describe('api.listBookmarks', () => {
  it('fetches bookmarks with an auth header', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [
        { id: '1', url: 'https://example.com', title: 'Example', createdAt: '2024-01-01' },
      ],
    })
    const result = await api.listBookmarks()
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/bookmarks'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer fake-token' }),
      })
    )
    expect(result).toHaveLength(1)
  })

  it('throws when the response is not ok', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 })
    await expect(api.listBookmarks()).rejects.toThrow('API error: 500')
  })
})

describe('api.createBookmark', () => {
  it('posts the bookmark and returns the created record', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: '1',
        url: 'https://example.com',
        title: 'Example',
        createdAt: '2024-01-01',
      }),
    })
    const result = await api.createBookmark({ url: 'https://example.com', title: 'Example' })
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/bookmarks'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ url: 'https://example.com', title: 'Example' }),
      })
    )
    expect(result.title).toBe('Example')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — `./api` module does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/api.ts`:

```ts
import { auth } from './firebase'

export interface Bookmark {
  id: string
  url: string
  title: string
  createdAt: string
}

const BASE_URL = import.meta.env.VITE_API_URL ?? ''

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = await auth.currentUser?.getIdToken()
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options?.headers,
    },
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export const api = {
  listBookmarks: () => request<Bookmark[]>('/api/bookmarks'),
  createBookmark: (bookmark: { url: string; title: string }) =>
    request<Bookmark>('/api/bookmarks', {
      method: 'POST',
      body: JSON.stringify(bookmark),
    }),
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api.ts frontend/src/api.test.ts
git commit -m "feat(frontend): add backend API client"
```

---

### Task 8: BookmarkForm, BookmarkList, and the real BookmarksPage

**Files:**
- Create: `frontend/src/components/BookmarkForm.tsx`
- Create: `frontend/src/components/BookmarkForm.test.tsx`
- Create: `frontend/src/components/BookmarkList.tsx`
- Create: `frontend/src/components/BookmarkList.test.tsx`
- Modify: `frontend/src/pages/BookmarksPage.tsx`
- Create: `frontend/src/pages/BookmarksPage.test.tsx`

**Interfaces:**
- Consumes: `api` and `Bookmark` from `frontend/src/api.ts` (Task 7).
- Produces: default export `BookmarkForm` with props `{ onAdd: (bookmark: { url: string; title: string }) => void | Promise<void> }`.
- Produces: default export `BookmarkList` with props `{ bookmarks: Bookmark[] }`.

- [ ] **Step 1: Write the failing BookmarkForm test**

Create `frontend/src/components/BookmarkForm.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import BookmarkForm from './BookmarkForm'

describe('BookmarkForm', () => {
  it('calls onAdd with trimmed title and url, then clears the fields', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined)
    render(<BookmarkForm onAdd={onAdd} />)

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '  Example  ' } })
    fireEvent.change(screen.getByLabelText('URL'), {
      target: { value: '  https://example.com  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))

    expect(onAdd).toHaveBeenCalledWith({ url: 'https://example.com', title: 'Example' })
    await Promise.resolve()
    expect(screen.getByLabelText('Title')).toHaveValue('')
    expect(screen.getByLabelText('URL')).toHaveValue('')
  })

  it('does not call onAdd when a field is empty', () => {
    const onAdd = vi.fn()
    render(<BookmarkForm onAdd={onAdd} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))
    expect(onAdd).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — `./BookmarkForm` module does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/components/BookmarkForm.tsx`:

```tsx
import { useState } from 'react'
import type { FormEvent } from 'react'

interface BookmarkFormProps {
  onAdd: (bookmark: { url: string; title: string }) => void | Promise<void>
}

export default function BookmarkForm({ onAdd }: BookmarkFormProps) {
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!url.trim() || !title.trim()) return
    await onAdd({ url: url.trim(), title: title.trim() })
    setUrl('')
    setTitle('')
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 p-4">
      <input
        id="bookmark-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        aria-label="Title"
        className="flex-1 border border-gray-300 rounded px-3 py-2"
      />
      <input
        id="bookmark-url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="URL"
        aria-label="URL"
        className="flex-1 border border-gray-300 rounded px-3 py-2"
      />
      <button
        type="submit"
        className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
      >
        Add bookmark
      </button>
    </form>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS

- [ ] **Step 5: Write the failing BookmarkList test**

Create `frontend/src/components/BookmarkList.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import BookmarkList from './BookmarkList'

const bookmarks = [
  {
    id: '1',
    url: 'https://example.com',
    title: 'Example Site',
    createdAt: '2024-01-01T00:00:00.000Z',
  },
]

describe('BookmarkList', () => {
  it('shows an empty state when there are no bookmarks', () => {
    render(<BookmarkList bookmarks={[]} />)
    expect(screen.getByText('No bookmarks yet.')).toBeInTheDocument()
  })

  it('renders each bookmark as a link to its URL', () => {
    render(<BookmarkList bookmarks={bookmarks} />)
    const link = screen.getByRole('link', { name: 'Example Site' })
    expect(link).toHaveAttribute('href', 'https://example.com')
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — `./BookmarkList` module does not exist.

- [ ] **Step 7: Write minimal implementation**

Create `frontend/src/components/BookmarkList.tsx`:

```tsx
import type { Bookmark } from '../api'

interface BookmarkListProps {
  bookmarks: Bookmark[]
}

export default function BookmarkList({ bookmarks }: BookmarkListProps) {
  if (bookmarks.length === 0) {
    return <p className="p-4 text-gray-500">No bookmarks yet.</p>
  }

  return (
    <ul className="flex flex-col gap-2 p-4">
      {bookmarks.map((bookmark) => (
        <li key={bookmark.id} className="border border-gray-200 rounded px-3 py-2">
          <a
            href={bookmark.url}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-blue-600 hover:underline"
          >
            {bookmark.title}
          </a>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS

- [ ] **Step 9: Write the failing BookmarksPage test**

Create `frontend/src/pages/BookmarksPage.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../api', () => ({
  api: {
    listBookmarks: vi.fn(),
    createBookmark: vi.fn(),
  },
}))

import { api } from '../api'
import BookmarksPage from './BookmarksPage'

describe('BookmarksPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.listBookmarks).mockResolvedValue([])
  })

  it('loads and shows bookmarks on mount', async () => {
    vi.mocked(api.listBookmarks).mockResolvedValue([
      {
        id: '1',
        url: 'https://example.com',
        title: 'Example Site',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ])
    render(<BookmarksPage />)
    expect(await screen.findByRole('link', { name: 'Example Site' })).toBeInTheDocument()
  })

  it('adds a bookmark and refreshes the list', async () => {
    vi.mocked(api.createBookmark).mockResolvedValue({
      id: '2',
      url: 'https://example.com',
      title: 'New Site',
      createdAt: '2024-01-01T00:00:00.000Z',
    })
    render(<BookmarksPage />)
    await waitFor(() => expect(api.listBookmarks).toHaveBeenCalledTimes(1))

    vi.mocked(api.listBookmarks).mockResolvedValue([
      {
        id: '2',
        url: 'https://example.com',
        title: 'New Site',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ])
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'New Site' } })
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))

    expect(await screen.findByRole('link', { name: 'New Site' })).toBeInTheDocument()
    expect(api.listBookmarks).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 10: Run test to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — `BookmarksPage` still renders the static placeholder text from Task 6, not the form/list.

- [ ] **Step 11: Write minimal implementation**

Modify `frontend/src/pages/BookmarksPage.tsx`:

```tsx
import { useEffect, useState, useCallback } from 'react'
import { api } from '../api'
import type { Bookmark } from '../api'
import BookmarkForm from '../components/BookmarkForm'
import BookmarkList from '../components/BookmarkList'

export default function BookmarksPage() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])

  const refresh = useCallback(async () => {
    setBookmarks(await api.listBookmarks())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function handleAdd(bookmark: { url: string; title: string }) {
    await api.createBookmark(bookmark)
    await refresh()
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold px-4 pt-6">hamster</h1>
      <BookmarkForm onAdd={handleAdd} />
      <BookmarkList bookmarks={bookmarks} />
    </div>
  )
}
```

- [ ] **Step 12: Run the full frontend test suite**

Run: `cd frontend && npm test`
Expected: PASS (all tests)

- [ ] **Step 13: Commit**

```bash
git add frontend/src/components/BookmarkForm.tsx frontend/src/components/BookmarkForm.test.tsx frontend/src/components/BookmarkList.tsx frontend/src/components/BookmarkList.test.tsx frontend/src/pages/BookmarksPage.tsx frontend/src/pages/BookmarksPage.test.tsx
git commit -m "feat(frontend): add bookmark form, list, and wire up BookmarksPage"
```

---

### Task 9: End-to-end test — login, add, list

**Files:**
- Create: `e2e/package.json`
- Create: `e2e/playwright.config.ts`
- Create: `e2e/global-setup.ts`
- Create: `e2e/fixtures/auth.ts`
- Create: `e2e/fixtures/firestore.ts`
- Create: `e2e/tests/bookmarks.spec.ts`
- Create: `backend/.env.e2e`
- Create: `frontend/.env.e2e`

**Interfaces:**
- Consumes: `backend`'s `start:e2e` script (Task 2) and `frontend`'s `dev:e2e` script (Task 5), both already defined.
- Produces: nothing consumed by later tasks — this is the outermost verification layer for this plan.

- [ ] **Step 1: Create `backend/.env.e2e`**

```
PORT=8090
FIRESTORE_EMULATOR_HOST=localhost:8081
FIREBASE_AUTH_EMULATOR_HOST=localhost:9099
FIREBASE_PROJECT_ID=demo-hamster-e2e
ALLOWED_EMAILS=e2e@example.com
FRONTEND_URL=http://localhost:5174
```

- [ ] **Step 2: Create `frontend/.env.e2e`**

```
VITE_FIREBASE_API_KEY=fake-api-key
VITE_FIREBASE_AUTH_DOMAIN=demo-hamster-e2e.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=demo-hamster-e2e
VITE_API_URL=http://localhost:8090
VITE_E2E=true
VITE_E2E_TEST_EMAIL=e2e@example.com
VITE_E2E_TEST_PASSWORD=e2e-test-password-123
```

- [ ] **Step 3: Create `e2e/package.json`**

```json
{
  "name": "hamster-e2e",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "test": "playwright test",
    "test:ui": "playwright test --ui",
    "report": "playwright show-report"
  },
  "devDependencies": {
    "@playwright/test": "^1.48.0",
    "firebase-tools": "^15.22.0"
  },
  "volta": {
    "node": "24.17.0"
  }
}
```

- [ ] **Step 4: Create `e2e/fixtures/auth.ts`**

```ts
import { expect, type Page } from '@playwright/test'

export const AUTH_EMULATOR_URL = 'http://localhost:9099'
export const TEST_EMAIL = 'e2e@example.com'
export const TEST_PASSWORD = 'e2e-test-password-123'

export async function signIn(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Sign in with Google' }).click()
  await expect(page.getByRole('button', { name: 'Add bookmark' })).toBeVisible()
}
```

- [ ] **Step 5: Create `e2e/fixtures/firestore.ts`**

```ts
const FIRESTORE_EMULATOR_URL = 'http://localhost:8081'
const PROJECT_ID = 'demo-hamster-e2e'

export async function clearFirestore() {
  await fetch(
    `${FIRESTORE_EMULATOR_URL}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' }
  )
}
```

- [ ] **Step 6: Create `e2e/global-setup.ts`**

```ts
import { AUTH_EMULATOR_URL, TEST_EMAIL, TEST_PASSWORD } from './fixtures/auth'

async function waitUntilListening(url: string, attempts = 20, delayMs = 500) {
  for (let i = 0; i < attempts; i++) {
    try {
      await fetch(url)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  throw new Error(`Timed out waiting for ${url} to accept connections`)
}

export default async function globalSetup() {
  await waitUntilListening(AUTH_EMULATOR_URL)

  await fetch(
    `${AUTH_EMULATOR_URL}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, returnSecureToken: true }),
    }
  ).catch(() => {})
}
```

- [ ] **Step 7: Create `e2e/playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test'
import path from 'node:path'

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  globalSetup: require.resolve('./global-setup'),
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'on-first-retry',
  },
  reporter: [['html', { open: 'never' }]],
  webServer: [
    {
      command: `${path.resolve(__dirname, 'node_modules/.bin/firebase')} emulators:start --project demo-hamster-e2e --only auth,firestore`,
      cwd: path.resolve(__dirname, '..'),
      port: 8081,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'npm run start:e2e',
      cwd: path.resolve(__dirname, '../backend'),
      port: 8090,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run dev:e2e',
      cwd: path.resolve(__dirname, '../frontend'),
      port: 5174,
      reuseExistingServer: !process.env.CI,
    },
  ],
})
```

- [ ] **Step 8: Write the e2e test**

Create `e2e/tests/bookmarks.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { signIn } from '../fixtures/auth'
import { clearFirestore } from '../fixtures/firestore'

test.describe('bookmarks', () => {
  test.beforeEach(async ({ page }) => {
    await clearFirestore()
    await signIn(page)
  })

  test('adds a bookmark and shows it in the list', async ({ page }) => {
    await page.getByLabel('Title').fill('Example Site')
    await page.getByLabel('URL').fill('https://example.com')
    await page.getByRole('button', { name: 'Add bookmark' }).click()

    await expect(page.getByRole('link', { name: 'Example Site' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Example Site' })).toHaveAttribute(
      'href',
      'https://example.com'
    )
  })

  test('persists bookmarks across a reload', async ({ page }) => {
    await page.getByLabel('Title').fill('Example Site')
    await page.getByLabel('URL').fill('https://example.com')
    await page.getByRole('button', { name: 'Add bookmark' }).click()
    await expect(page.getByRole('link', { name: 'Example Site' })).toBeVisible()

    await page.reload()
    await expect(page.getByRole('link', { name: 'Example Site' })).toBeVisible()
  })
})
```

- [ ] **Step 9: Install e2e dependencies and browsers**

Run: `cd e2e && npm install && npx playwright install --with-deps chromium`

- [ ] **Step 10: Run the e2e suite**

Run: `cd e2e && npm test`
Expected: PASS — both tests pass. Playwright will start the Firestore/Auth emulators, the backend (`start:e2e`), and the frontend (`dev:e2e`) automatically via `webServer`.

- [ ] **Step 11: Commit**

```bash
git add backend/.env.e2e frontend/.env.e2e e2e/package.json e2e/package-lock.json e2e/playwright.config.ts e2e/global-setup.ts e2e/fixtures/auth.ts e2e/fixtures/firestore.ts e2e/tests/bookmarks.spec.ts
git commit -m "test(e2e): add Playwright login-add-list end-to-end test"
```

---

### Task 10: README and local-dev docs

**Files:**
- Modify: `README.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Write the README**

Replace the contents of `README.md`:

```markdown
# hamster

Personal bookmark manager — save a URL and title, see them in a list.

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18, Vite, TypeScript, Tailwind CSS v4, Firebase Auth |
| Backend | Node.js 24, Express, TypeScript |
| Storage | Firestore (via the backend only — the frontend never touches Firestore directly) |
| Hosting | Firebase Hosting (frontend) + Cloud Run (backend) — see the deploy plan |

## Project structure

\`\`\`
hamster/
├── frontend/   # React app
├── backend/    # Express API
└── e2e/        # Playwright end-to-end tests
\`\`\`

## Local development

**1. Start the Firebase emulators (Auth + Firestore)**

\`\`\`sh
npm install
npm run emulators
\`\`\`

**2. Backend** (in a second terminal)

\`\`\`sh
cd backend
cp .env.example .env   # set ALLOWED_EMAILS to your Google account email
npm install
npm run dev             # starts on :8080
\`\`\`

**3. Frontend** (in a third terminal)

\`\`\`sh
cd frontend
cp .env.example .env
npm install
npm run dev              # starts on :5173
\`\`\`

Open http://localhost:5173 and sign in with the Google account listed in `ALLOWED_EMAILS`.

## Tests

\`\`\`sh
cd backend && npm test
cd frontend && npm test
cd e2e && npm test        # runs emulators + backend + frontend automatically
\`\`\`

## Environment variables (backend)

| Variable | Description |
|---|---|
| `ALLOWED_EMAILS` | Comma-separated Google account emails allowed to use the app |
| `FIREBASE_PROJECT_ID` | Firebase project ID (`demo-hamster` for local dev — no real GCP project needed) |
| `FRONTEND_URL` | Frontend origin for CORS |
| `PORT` | Port the backend listens on |

## Environment variables (frontend)

| Variable | Description |
|---|---|
| `VITE_FIREBASE_API_KEY` | Firebase Web API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase Auth domain |
| `VITE_FIREBASE_PROJECT_ID` | Firebase project ID |
| `VITE_API_URL` | Backend base URL |
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document local dev setup"
```

---

## Self-Review Notes

- **Spec coverage:** architecture (Task 1–9), data model (Task 4), API surface (Task 4), frontend (Task 5–8), local dev (Task 1–2, README), testing (every task's TDD cycle + Task 9 e2e). Deploy/CI is explicitly out of scope for this plan per the spec's own scoping and the earlier plan-structure decision.
- **Type consistency checked:** `Bookmark`/`BookmarkDoc` shape (`id`, `url`, `title`, `createdAt: string`) is identical across `backend/src/services/firestore.ts`, `backend/src/routes/bookmarks.test.ts`, `frontend/src/api.ts`, and every frontend component/test that touches it. `createBookmarksRouter()` takes no arguments and is referenced the same way in `app.ts` and `bookmarks.test.ts`. `authMiddleware` signature is consistent between its definition and its use in `app.ts`.
- **No placeholders:** every step contains complete, runnable code — no TBD/TODO markers.
