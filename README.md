# hamster

Personal bookmark manager — save a URL and title, see them in a list, and read an
AI-generated summary of each saved page.

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18, Vite, TypeScript, Tailwind CSS v4, Firebase Auth |
| Backend | Node.js 24, Express, TypeScript |
| Storage | Firestore (via the backend only — the frontend never touches Firestore directly) |
| Hosting | Firebase Hosting (frontend) + Cloud Run (backend) — see the deploy plan |

## Project structure

```
hamster/
├── frontend/   # React app
├── backend/    # Express API
└── e2e/        # Playwright end-to-end tests
```

## Summaries

Each bookmark has its own page at `/bookmarks/:id` showing a summary of the linked
article — an overview paragraph, a "Key points" section of four to six bullet points, and a
closing takeaway — generated with the Gemini API. The model writes the summary in Markdown,
and the page renders it: section headings, bullets and bold lead-ins, so it can be skimmed
rather than read straight through. Only that subset is rendered — links and images are
dropped (their text stays), because a summary is written from an untrusted page and nothing
in the prompt asks for a URL. English and Japanese articles are summarized in their own
language, headings included; anything else is summarized in English. Summaries saved before
this feature are plain text, which renders as it always did. Generation runs automatically
just after a bookmark is saved; if it fails — or if the bookmark predates this feature — the page
offers a **Generate summary** button. Once a summary exists, a **Regenerate** button under
it runs a fresh generation; if that fails, the existing summary is left as it was.

Summarization needs `GEMINI_API_KEY`. Without it the app works normally and every
bookmark page simply shows its empty state.

## Local development

**1. Start the Firebase emulators (Auth + Firestore)**

```sh
npm install
npm run emulators
```

**2. Backend** (in a second terminal)

```sh
cd backend
cp .env.example .env   # set ALLOWED_EMAILS to your Google account email
npm install
npm run dev             # starts on :8080
```

**3. Frontend** (in a third terminal)

```sh
cd frontend
cp .env.example .env
npm install
npm run dev              # starts on :5173
```

Open http://localhost:5173 and sign in — locally, sign-in goes through the Auth emulator's fake identity picker, so type the email listed in `ALLOWED_EMAILS` when prompted.

## Tests

```sh
(cd backend && npm test)
(cd frontend && npm test)
(cd e2e && npm install && npx playwright install --with-deps chromium && npm test)
# e2e runs emulators + backend + frontend automatically
```

## Environment variables (backend)

| Variable | Description |
|---|---|
| `ALLOWED_EMAILS` | Comma-separated Google account emails allowed to use the app |
| `FIREBASE_PROJECT_ID` | Firebase project ID (`demo-hamster` for local dev — no real GCP project needed) |
| `FRONTEND_URL` | Frontend origin for CORS |
| `PORT` | Port the backend listens on |
| `GEMINI_API_KEY` | Gemini API key used to generate bookmark summaries (summarization is disabled when unset) |
| `FIRESTORE_EMULATOR_HOST` | Host:port of the Firestore emulator (routes the Admin SDK to it instead of production) |
| `FIREBASE_AUTH_EMULATOR_HOST` | Host:port of the Auth emulator (routes the Admin SDK to it instead of production) |

## Environment variables (frontend)

| Variable | Description |
|---|---|
| `VITE_FIREBASE_API_KEY` | Firebase Web API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase Auth domain |
| `VITE_FIREBASE_PROJECT_ID` | Firebase project ID |
| `VITE_API_URL` | Backend base URL |
| `VITE_USE_AUTH_EMULATOR` | Connect the Firebase Auth client to the local Auth emulator |

## Troubleshooting

If `npm run emulators` or `cd e2e && npm test` fails with a "port already in use" error for port 8081 or 9099, a leftover Firestore emulator Java process may still be running. Check for it with `lsof -i :8081` and kill it if present (this is a known Firebase emulator teardown quirk on macOS).
