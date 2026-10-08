# hamster

Personal bookmark manager — save a URL and title, see them in a list, read an
AI-generated summary of each saved page, mark off the ones you have read, and
delete the ones you're done with.

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

## Marking as read

Every row in the list carries a check button that marks its bookmark read, and each bookmark's
page has the same control spelled out under its summary, where a reader ends up once they have
read it. A read bookmark's title dims and its row says "Read", so a glance down the list picks out
what is still waiting. The same button undoes it: read state is one click in either direction, so
unlike deleting it asks nothing first.

Above the list, an All / Unread / Read filter narrows what is shown. It starts on All, so nothing
is hidden until you ask for it, and it applies to the list the page already holds — switching
costs no round trip, and a bookmark leaves the Unread view the moment it is marked, not a request
later. The choice is not persisted: a reload opens on All again. When a filter matches nothing,
the list says which filter is empty rather than offering the "paste a URL above" advice that
belongs to a genuinely empty library.

`PUT /api/bookmarks/:id/read` takes `{ "isRead": true }` or `false` — the state to store, not
"flip it", so a retried request after a dropped response cannot land the bookmark on the opposite
of what was asked for. It answers `204`, or `404` if the bookmark is gone: a flag recorded about
something that no longer exists is a failure, not a state that already holds. Both places show
the change immediately and put it back, with an error, if the write fails. Bookmarks saved before
this feature carry no stored flag and read as unread.

## Deleting

Every row in the list carries a delete button, and each bookmark's own page has one under its
summary. Deleting is permanent — there is no trash and no undo — so both ask for confirmation
first, inline next to the button. Deleting from a bookmark's page returns to the list.

`DELETE /api/bookmarks/:id` is idempotent: it answers `204` whether or not the bookmark was still
there, so a second delete (a stale list row, a retried request) is not an error. A summary
generation still running for a deleted bookmark fails its own write rather than recreating it.

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

The top page shows the opening overview of each stored summary below its article title and
metadata, limited to two lines so the list stays easy to scan. Markdown emphasis is preserved;
links and images do not add controls to the row. Existing summaries work immediately, and a
new bookmark's preview appears when its automatic summary finishes. Bookmarks without a
summary keep their usual row until one is generated.

Saving a bookmark also assigns it a handful of short topic labels, generated with the
lighter `gemini-3.5-flash-lite` model from the same page content. Labels appear as chips
in the list and on each bookmark's page. They are best-effort: a labelling failure never
blocks the summary, and regenerating a summary regenerates the labels too.

## Translating a summary

An English summary carries a **Translate to Japanese** button beside **Regenerate**. It sends the
stored summary to the same Gemini model and asks for Japanese that keeps the document's structure —
headings, bullets and bold survive, and nothing is condensed on the way across. The translation
replaces the English in place and the button becomes **Show English**; switching back and forth
after that is free, because the Japanese is held on the page.

The button only appears where it applies: a summary that is already Japanese, or a bookmark with no
summary, does not get one. A failed translation changes nothing — the English stays on screen under
an error, ready to try again.

Nothing is stored. The translation lives on the page and is gone on navigation or reload, like the
chat below, so a regenerated summary can never be left with a stale Japanese version beside it —
regenerating drops the translation and puts the button back to its offer.

`POST /api/bookmarks/:id/translation` takes no body: it translates the summary the backend has
stored, so a caller cannot push arbitrary text into a paid Gemini call. It answers
`{ "translation": "…", "source": "…", "labels": [...] }` — the translation, the summary it was made
from, and the labels read alongside it —
`404` if the bookmark is gone, `409` if it has no summary yet, `503` without `GEMINI_API_KEY`, and
`502` if the translation itself fails.

`source` is what keeps the two sides of the toggle in step. A page holding an older summary — one
regenerated in another tab, say — would otherwise pair the new Japanese with the English it still
had on screen, and it has no other way to notice: a bookmark that already has its summary and
labels does not poll for changes. The page adopts the summary the backend actually translated —
and its labels, so the chips never end up describing text that has been replaced — which is what
makes **Show English** reveal the original of the Japanese beside it. A summary that arrived while
the translation was in flight is fresher than what the endpoint read, so that one stands instead.

## Asking questions

Each bookmark's page has an "Ask a question" box under the summary. You can ask about the
article or any other topic. The same Gemini model uses the fetched article as context for
article questions and general knowledge for questions beyond it, distinguishing article content
from additional explanations. Answers use the question's language when that is English or
Japanese, and English otherwise. If the article cannot be fetched, general questions still work;
the assistant explains that the page is unavailable when asked about its specific contents.
Follow-up questions see the earlier exchange. The conversation is not saved anywhere: it lives
on the page and is gone on navigation. The backend refetches the article for every question.
A failed question stays in the chat with a Retry button next to the error.

Like summaries, asking needs `GEMINI_API_KEY`; without it the box answers every question with
the failure state.

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
| `GEMINI_API_KEY` | Gemini API key used to generate bookmark summaries, translate them into Japanese, and answer article and general questions (all are disabled when unset) |
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
