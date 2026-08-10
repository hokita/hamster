# hamster: Frontend UI Redesign — Design

## Overview

The current frontend (`LoginPage`, `BookmarksPage`, `BookmarkForm`, `BookmarkList`) works but is styled with bare, undifferentiated Tailwind utility classes — plain borders, default grays, no iconography. This spec redesigns the visual presentation of all three screens using Tailwind CSS v4 (already installed) and Font Awesome, plus a handful of small, frontend-only UX additions. It does not change the app's features, API contracts, or data model.

## Goals

- Restyle all existing screens (login, header, add-bookmark form, bookmark list) with a coherent, clean & neutral visual language, using amber as the one accent color.
- Introduce Font Awesome (via `@fortawesome/react-fontawesome`) as the icon system, replacing the current icon-free UI.
- Add small, frontend-only UX improvements that the current UI lacks: a real loading state on initial fetch, relative "time ago" timestamps, a domain line per bookmark, a full-row click target with a hover affordance, and a more legible error display.
- Preserve every existing accessible name, label, and behavior that current tests assert on, so this is a styling/markup change, not a behavioral one — see [Preserving existing test contracts](#preserving-existing-test-contracts).

## Non-goals

- No backend changes of any kind — no delete endpoint, no favicon-fetching service, no schema changes. Confirmed with the user: this pass is frontend-only.
- No dark mode — light mode only, per user decision.
- No mascot or emoji iconography anywhere in the UI. An earlier direction used a hamster emoji and a warm gradient "hero" band; the user rejected it as "too cute" and "don't use hamster icon." The approved direction is clean & neutral with no gradients and no emoji.
- No real per-site favicons. The favicon chip next to each bookmark uses a generic Font Awesome `link` icon as a placeholder — the user is producing a custom icon separately and will swap it in later. Fetching real site favicons (e.g. via a public favicon service) is explicitly out of scope for this spec.
- No new copy elements like a "N bookmarks" counter or a greeting line — kept deliberately minimal rather than adding UI that wasn't requested.
- No changes to `BookmarkForm`'s or `BookmarkList`'s props/API — only their internal markup and styling change.

## Visual language

- **Palette**: near-grayscale (`gray-50`/`white` backgrounds, `gray-200`/`gray-100` borders, `gray-900`/`gray-500` text), with `amber-600` (hover `amber-700`) as the single accent color. Amber appears only on the primary "Add bookmark" button (background) and its input's focus ring — nowhere else (not the header, not bookmark-row hovers, not the login page, no background gradients).
- **Shape**: subtle rounding (`rounded-md`, ~6px) on inputs, buttons, and the favicon chip. No pill shapes.
- **Icons**: `@fortawesome/react-fontawesome` + `@fortawesome/fontawesome-svg-core` + `@fortawesome/free-solid-svg-icons` + `@fortawesome/free-brands-svg-icons`. This is the React-idiomatic setup (per-icon tree-shakeable imports via `<FontAwesomeIcon icon={faX} />`), as opposed to importing the `@fortawesome/fontawesome-free` CSS/webfont package — it avoids pulling in an unused icon-set bundle and fits the existing React + TypeScript stack.
  - Icons used: `faLink` (favicon placeholder chip), `faArrowUpRightFromSquare` (external-link hover affordance on rows), `faRightFromBracket` (sign out), `faPlus` (add button, default state), `faSpinner` with a spin animation (add button, submitting state; initial-load spinner), `faTriangleExclamation` (error banners), `faGoogle` from the brands package (sign-in button).
  - All decorative icons get `aria-hidden="true"` so they never affect an element's accessible name (this is what keeps existing `getByRole(..., { name: ... })` test queries passing — see below).

## Component changes

### LoginPage

A centered card (white background, `border border-gray-200`, subtle shadow, rounded) replaces the current bare centered column. Inside: the "hamster" wordmark, a small gray tagline, and the sign-in button — unchanged behavior (Google popup in normal mode, fixed test-user email/password sign-in in E2E mode), now rendered with the `faGoogle` brand icon next to the "Sign in with Google" label. The button stays neutrally styled (bordered, `hover:bg-gray-50`) — no amber accent on this page, per the user's explicit choice to keep login fully neutral.

### BookmarksPage header

Left: "hamster" title. Right: a "Sign out" control, now paired with the `faRightFromBracket` icon. A `border-b border-gray-200` separates the header from the page content. No greeting text or bookmark count — intentionally minimal.

### BookmarkForm

Same inline row layout (input + button). The input's placeholder text changes to "Paste a URL…" — its `aria-label="URL"` is unchanged. The button becomes `amber-600`/`hover:amber-700` and shows the `faPlus` icon next to the "Add bookmark" label in the default state; while `submitting` is true (existing state), the icon swaps to a spinning `faSpinner` in place of `faPlus`. The button's accessible name stays exactly `"Add bookmark"` throughout, since the icon is `aria-hidden`.

### BookmarkList / bookmark rows

Each bookmark renders as a slim row instead of a bordered box: a small rounded favicon chip (`faLink` placeholder icon on a light gray background), the title, and a meta line showing the domain (`new URL(bookmark.url).hostname`) and a relative timestamp (e.g. "2h ago", computed client-side from `createdAt` — no backend change). Rows are separated by a thin `border-b border-gray-100` rather than being individually boxed, and get `hover:bg-gray-50` plus a `faArrowUpRightFromSquare` icon that fades in on hover as a click affordance.

The whole row becomes the clickable link (not just the title), for a larger click target. To keep the link's accessible name equal to just the bookmark title — matching what `BookmarksPage.test.tsx` and `BookmarkList.test.tsx` already assert via `getByRole('link', { name: <title> })` — the anchor gets `aria-label={bookmark.title}` explicitly, even though it visually contains the favicon, title, and meta line too. This is a standard pattern for "the whole card is a link" components and requires no test changes for the link-query assertions themselves.

### Relative time formatting

A small new pure utility (e.g. `formatRelativeTime(createdAt: string, now: Date): string`) drives the meta line:

| Age | Output |
|---|---|
| < 1 minute | `just now` |
| < 60 minutes | `{n}m ago` |
| < 24 hours | `{n}h ago` |
| < 7 days | `{n}d ago` |
| ≥ 7 days | absolute date: `MMM D` (e.g. `Jan 5`) if `createdAt` falls in the current calendar year, otherwise `MMM D, YYYY` (e.g. `Jan 5, 2025`) |

Taking `now` as a parameter (rather than reading `Date.now()` internally) keeps the function pure and trivially testable.

### Empty state

Shown only once the initial fetch has completed and the list is genuinely empty: a single muted `faLink` icon above one line of plain text — "No bookmarks yet — paste a URL above to add one." No further decoration.

### Loading state (new)

Today, `BookmarksPage` initializes `bookmarks` to `[]`, so the empty-state message flashes on screen before the first fetch resolves — it's indistinguishable from a genuinely empty list. This spec adds a real `isLoading` state, `true` until the initial mount fetch settles (`false` on both success and failure — a failed initial load shows the error banner, not an indefinite spinner). While loading, a centered `faSpinner` (spinning) renders instead of either the bookmark list or the empty state. This does not apply to the `refresh()` call after adding a bookmark — only the initial mount fetch, so adding a bookmark doesn't cause the whole list to flash a spinner.

### Error state

Same underlying error text and triggering logic (unchanged from `BookmarksPage`'s existing `error` state and messages), but visually wrapped in a `bg-red-50 border border-red-200 rounded-md` strip with a `faTriangleExclamation` icon, instead of bare red text.

## Preserving existing test contracts

This redesign is markup/styling only — no prop signatures, callback shapes, or user-facing behavior change except the two additions above (loading state, full-row click target). To keep the existing test suite meaningful and mostly passing as-is:

- `aria-label="URL"` on the URL input — unchanged.
- Accessible name `"Add bookmark"` on the submit button — unchanged (icon is `aria-hidden`).
- Accessible name `"Sign out"` on the sign-out button — unchanged.
- Accessible name `"Sign in with Google"` on the login button — unchanged.
- Bookmark row link accessible name equals the bookmark's `title` — preserved via explicit `aria-label` on the row anchor (see above).

Two existing assertions *do* need updating as part of implementing this spec, because the visible copy is intentionally changing:

- `BookmarkList.test.tsx`: `expect(screen.getByText('No bookmarks yet.')).toBeInTheDocument()` — update to the new empty-state copy, and update the test to first resolve/skip past the new loading state where applicable.
- Any test relying on the old boxed-row DOM structure (none currently assert on markup/classes directly, only on roles/text, so this should be limited to the empty-state text above).

New tests to add (red before green, per this repo's TDD workflow):

- `formatRelativeTime` unit tests covering each bucket in the table above, plus the boundary values (59s, 60s, 59m, 60m, 23h, 24h, 6d, 7d).
- `BookmarksPage.test.tsx`: a test asserting a loading indicator is present before `listBookmarks` resolves and gone after, using a stable query (e.g. `role="status"` with an accessible name like "Loading bookmarks").
- `BookmarkList.test.tsx`: a test asserting the rendered row shows the domain and a relative-time string for a given `createdAt`.

## Dependencies

New: `@fortawesome/react-fontawesome`, `@fortawesome/fontawesome-svg-core`, `@fortawesome/free-solid-svg-icons`, `@fortawesome/free-brands-svg-icons`. No other new dependencies — Tailwind CSS v4 is already in place, and relative-time/domain formatting are implemented as small local utilities rather than pulling in a date library.

## Open items / sequencing notes

- The favicon chip icon (`faLink`) is an explicit placeholder. The user is creating a custom favicon/icon separately; swapping it in is out of scope for this spec and can be a small follow-up once that asset exists.
- No Firestore, API route, or `Bookmark` type changes are needed — this is purely a frontend presentation-layer change.
