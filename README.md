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

Saving a bookmark also assigns it a handful of short topic labels, generated with the
lighter `gemini-3.5-flash-lite` model from the same page content. Labels appear as chips
in the list and on each bookmark's page. They are best-effort: a labelling failure never
blocks the summary, and regenerating a summary regenerates the labels too.

## Visual summaries (Generative UI)

A saved summary, including one created before this feature, offers **Generate visual summary**.
Previously generated UI is restored from Firestore on page load without a Gemini call. If none
is saved, clicking sends the saved text to Gemini, which chooses useful
blocks and their order: key-point cards, comparison tables, checkable procedures, and expandable
Q&A. A summary can use just one type; comparisons and procedures are requested only when the
source explicitly supports them. The original text summary stays readable throughout generation
and after failure. The visual summary uses the saved summary's language, even when its Japanese
translation is currently displayed.

The implementation uses the existing `@google/genai` SDK (locked at 2.16.0) and
`gemini-3.8-flash`, with `models.generateContent`, `responseMimeType: 'application/json'` and
`responseJsonSchema`. Compatibility was checked against Google's
[model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash),
[structured-output guide](https://ai.google.dev/gemini-api/docs/structured-output), and
[SDK configuration reference](https://googleapis.github.io/js-genai/release_docs/interfaces/types.GenerateContentConfig.html).
The backend validates the parsed JSON independently: 1–6 blocks, only the four permitted types,
no extra fields, non-empty text, and the following limits (string lengths use JavaScript UTF-16
code units):

| Content | Limit |
|---|---|
| Block/card titles and column headings | 120 characters |
| Card text, steps and answers | 1,200 characters |
| Questions / table cells | 200 / 400 characters |
| Cards / steps / Q&A per block | 6 / 10 / 6 |
| Comparison columns / rows | 2–5 / 2–8; every row must match the column count |
| Saved input / generated JSON | 40,000 / 60,000 characters; oversized input is rejected, never truncated |

`POST /api/bookmarks/:id/visual-summary` uses the existing Firebase authentication and verified
email allowlist. It accepts no prompt or summary in the body and reads the saved summary from
Firestore. It saves the validated JSON before returning
`{ "visualSummary": { "blocks": [...] }, "source": "…" }`. If valid saved UI exists, it returns
that UI without calling Gemini, even without an API key. Missing bookmarks return `404`, missing/changed summaries `409`, oversized saved text
`422`, missing `GEMINI_API_KEY` `503`, generation/validation failures `502`, and generation
timeouts `504`. Database failures return `500`. The SDK request and server wait are bounded at
30 seconds; the browser stops waiting at 35 seconds. Failure shows an error and **Try again**,
and duplicate clicks are disabled.

Only predefined React components render the JSON. All generated strings are escaped text nodes;
HTML, JavaScript and JSX are never evaluated. Checkboxes have labels, Q&A uses native
`details`/`summary` controls, loading/errors are announced, and wide tables scroll within a
keyboard-focusable region on phones. Generated UI is persisted; checked steps and open questions
live only in the current page session. Navigation resets these operations and restores saved UI
when revisiting. Source changes and starting summary regeneration clear the current UI and
cancel the client wait. Late responses are ignored, and a response whose source
differs from the text on screen asks the reader to reload rather than replacing newer text.

Each explicit generation or retry when no valid saved UI exists can add one paid Gemini request, using only the saved summary
as input, with LOW thinking and an 8,192-token output budget (including thinking). Viewing a page,
checking steps, expanding Q&A or rereading an already generated UI adds no Gemini cost. Concurrent
requests for the same bookmark and saved text share a request within one server process; this
does not deduplicate across Cloud Run instances. Reopening saved UI adds no Gemini calls. Saving
uses a Firestore transaction; restoring uses the existing bookmark detail read. Actual charges depend on token usage and
[Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing); aborting a client wait does not
guarantee cancellation of billable server work. There are no automatic retries. A storage failure
returns `500` and leaves the text summary intact; retry may incur another Gemini call.

Persisted UI contains a source SHA-256 hash, summary version and validated JSON string (Firestore
does not support nested arrays such as comparison rows). Every detail read revalidates the JSON
and rejects mismatched source/version or corrupt data. The list response omits the UI payload.
Updating the summary atomically deletes saved UI and changes the version, including identical-text
regenerations. A save transaction checks both text and version, so late generations cannot overwrite
an updated summary or recreate a deleted bookmark. Legacy summaries require no migration.

The prompt forbids adding unsupported facts, numbers or steps, and treats saved content as
untrusted data. Structural validation does not prove factual accuracy: a visual summary can
still reflect errors in the saved summary or in the model's rearrangement. Compare it with the
original text when accuracy matters. Updates in other tabs are noticed when the page next reads
the bookmark or when generation detects a source mismatch; this feature adds no background polling.

Validation includes backend schema/service/authenticated-route tests, frontend loading/retry,
safe-text and stale-response tests, and Playwright tests for mobile layout and keyboard-operated
checkbox/Q&A controls. Run the existing `npm test`, `npm run build`, and `npm run lint` in both
`backend` and `frontend`, and `npm test` in `e2e`. Gemini is mocked in automated tests; no live API
key or paid call is required.

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
| `GEMINI_API_KEY` | Gemini API key used to generate bookmark summaries and visual summaries, translate summaries into Japanese, and answer article and general questions (all are disabled when unset) |
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
