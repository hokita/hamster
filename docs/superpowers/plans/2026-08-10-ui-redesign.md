# Frontend UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the hamster frontend (login, header, add-bookmark form, bookmark list) with Tailwind CSS v4 + Font Awesome, and add a handful of small frontend-only UX improvements (real loading state, relative timestamps, domain display, full-row click target), with no backend or API changes.

**Architecture:** Purely presentational changes to four existing files (`LoginPage.tsx`, `BookmarksPage.tsx`, `BookmarkForm.tsx`, `BookmarkList.tsx`) plus one new pure utility module (`relativeTime.ts`). No new components, no routing changes, no prop signature changes except `BookmarksPage` gaining internal `isLoading` state.

**Tech Stack:** React 18 + TypeScript + Tailwind CSS v4 (already installed) + `@fortawesome/react-fontawesome` (new) + Vitest/React Testing Library (existing).

**Spec:** `docs/superpowers/specs/2026-08-10-ui-redesign-design.md`

## Global Constraints

- Preserve these accessible names/labels exactly (existing tests assert on them): `aria-label="URL"` on the URL input; button accessible name `"Add bookmark"`; button accessible name `"Sign out"`; button accessible name `"Sign in with Google"`; bookmark row link accessible name equals the bookmark's `title`.
- No backend changes of any kind (no new endpoints, no schema changes).
- Light mode only — no dark mode.
- No mascot or emoji iconography anywhere. Icons come only from Font Awesome.
- `amber-600` (hover `amber-700`) is the *only* accent color, used only on the primary "Add bookmark" button and hover affordances on bookmark rows. Everything else is neutral gray/white. The login page uses no amber at all.
- Icons via `@fortawesome/react-fontawesome` component (`<FontAwesomeIcon icon={faX} />`), not the CSS/webfont package. All decorative icons get `aria-hidden="true"`.
- The favicon chip next to each bookmark uses the generic `faLink` icon as a placeholder — no real per-site favicon fetching.
- Follow this repo's TDD workflow: write the failing test before the implementation for every behavior-bearing change.

---

### Task 1: Relative time formatting utility

**Files:**
- Create: `frontend/src/relativeTime.ts`
- Test: `frontend/src/relativeTime.test.ts`

**Interfaces:**
- Produces: `formatRelativeTime(createdAt: string, now?: Date): string` — used by Task 7 (`BookmarkList.tsx`) to render each bookmark's meta line.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/relativeTime.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatRelativeTime } from './relativeTime'

describe('formatRelativeTime', () => {
  const now = new Date('2026-08-10T12:00:00.000Z')

  it('returns "just now" for under a minute', () => {
    const createdAt = new Date(now.getTime() - 59_000).toISOString()
    expect(formatRelativeTime(createdAt, now)).toBe('just now')
  })

  it('returns minutes for exactly 60 seconds ago', () => {
    const createdAt = new Date(now.getTime() - 60_000).toISOString()
    expect(formatRelativeTime(createdAt, now)).toBe('1m ago')
  })

  it('returns minutes for 59 minutes ago', () => {
    const createdAt = new Date(now.getTime() - 59 * 60_000).toISOString()
    expect(formatRelativeTime(createdAt, now)).toBe('59m ago')
  })

  it('returns hours for exactly 60 minutes ago', () => {
    const createdAt = new Date(now.getTime() - 60 * 60_000).toISOString()
    expect(formatRelativeTime(createdAt, now)).toBe('1h ago')
  })

  it('returns hours for 23 hours ago', () => {
    const createdAt = new Date(now.getTime() - 23 * 60 * 60_000).toISOString()
    expect(formatRelativeTime(createdAt, now)).toBe('23h ago')
  })

  it('returns days for exactly 24 hours ago', () => {
    const createdAt = new Date(now.getTime() - 24 * 60 * 60_000).toISOString()
    expect(formatRelativeTime(createdAt, now)).toBe('1d ago')
  })

  it('returns days for 6 days ago', () => {
    const createdAt = new Date(now.getTime() - 6 * 24 * 60 * 60_000).toISOString()
    expect(formatRelativeTime(createdAt, now)).toBe('6d ago')
  })

  it('returns an absolute date without year for exactly 7 days ago in the same year', () => {
    const createdAt = new Date(now.getTime() - 7 * 24 * 60 * 60_000).toISOString()
    expect(formatRelativeTime(createdAt, now)).toBe('Aug 3')
  })

  it('returns an absolute date with year when the date is in a previous year', () => {
    const createdAt = new Date('2025-01-15T12:00:00.000Z').toISOString()
    expect(formatRelativeTime(createdAt, now)).toBe('Jan 15, 2025')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/relativeTime.test.ts`
Expected: FAIL — `Cannot find module './relativeTime'` (file doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/relativeTime.ts`:

```ts
export function formatRelativeTime(createdAt: string, now: Date = new Date()): string {
  const created = new Date(createdAt)
  const diffSec = Math.floor((now.getTime() - created.getTime()) / 1000)

  if (diffSec < 60) return 'just now'

  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`

  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}h ago`

  const diffDay = Math.floor(diffHour / 24)
  if (diffDay < 7) return `${diffDay}d ago`

  const sameYear = created.getFullYear() === now.getFullYear()
  const options: Intl.DateTimeFormatOptions = sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' }
  return new Intl.DateTimeFormat('en-US', options).format(created)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/relativeTime.test.ts`
Expected: PASS (all 9 cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/relativeTime.ts frontend/src/relativeTime.test.ts
git commit -m "feat: add formatRelativeTime utility"
```

---

### Task 2: Install Font Awesome dependencies

**Files:**
- Modify: `frontend/package.json`, `frontend/package-lock.json`

**Interfaces:**
- Produces: `@fortawesome/react-fontawesome`'s `FontAwesomeIcon` component and icon definitions from `@fortawesome/free-solid-svg-icons` / `@fortawesome/free-brands-svg-icons`, importable by Tasks 3–7.

- [ ] **Step 1: Install the packages**

Run:
```bash
cd frontend && npm install @fortawesome/fontawesome-svg-core @fortawesome/free-solid-svg-icons @fortawesome/free-brands-svg-icons @fortawesome/react-fontawesome
```

- [ ] **Step 2: Verify the project still builds and lints**

Run: `cd frontend && npm run lint && npm run build`
Expected: both succeed with no errors (nothing imports the new packages yet, so this just confirms the install didn't break anything).

- [ ] **Step 3: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "chore: add Font Awesome dependencies"
```

---

### Task 3: Redesign LoginPage

**Files:**
- Modify: `frontend/src/pages/LoginPage.tsx`
- Test: `frontend/src/pages/LoginPage.test.tsx` (no changes expected — run to confirm still green)

**Interfaces:**
- Consumes: `FontAwesomeIcon` from `@fortawesome/react-fontawesome`, `faGoogle` from `@fortawesome/free-brands-svg-icons` (Task 2).

- [ ] **Step 1: Confirm the existing tests currently pass (baseline)**

Run: `cd frontend && npx vitest run src/pages/LoginPage.test.tsx`
Expected: PASS (3 tests) — this is the behavior contract this task must not break.

- [ ] **Step 2: Replace the component**

Replace the full contents of `frontend/src/pages/LoginPage.tsx`:

```tsx
import { useState } from 'react'
import { GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword } from 'firebase/auth'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faGoogle } from '@fortawesome/free-brands-svg-icons'
import { auth } from '../firebase'

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null)

  async function handleSignIn() {
    try {
      if (import.meta.env.VITE_E2E === 'true') {
        await signInWithEmailAndPassword(
          auth,
          import.meta.env.VITE_E2E_TEST_EMAIL,
          import.meta.env.VITE_E2E_TEST_PASSWORD
        )
      } else {
        const provider = new GoogleAuthProvider()
        await signInWithPopup(auth, provider)
      }
      setError(null)
    } catch {
      setError('Sign-in failed.')
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-dvh bg-gray-50 gap-6">
      <div className="flex flex-col items-center gap-4 bg-white border border-gray-200 rounded-lg shadow-sm px-10 py-8">
        <h1 className="text-2xl font-bold m-0">hamster</h1>
        <p className="text-sm text-gray-500 m-0">Your bookmarks, all in one place</p>
        <button
          onClick={handleSignIn}
          className="flex items-center gap-2 px-6 py-3 text-base cursor-pointer rounded-md border border-gray-300 hover:bg-gray-50 active:bg-gray-100"
        >
          <FontAwesomeIcon icon={faGoogle} aria-hidden="true" />
          Sign in with Google
        </button>
        {error && <p className="text-red-600 text-sm">{error}</p>}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Run the tests to verify they still pass**

Run: `cd frontend && npx vitest run src/pages/LoginPage.test.tsx`
Expected: PASS (3 tests, unchanged) — the button's accessible name is still exactly "Sign in with Google" because the icon is `aria-hidden`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/LoginPage.tsx
git commit -m "style: redesign LoginPage with Tailwind + Font Awesome"
```

---

### Task 4: Redesign BookmarksPage header and error banner

**Files:**
- Modify: `frontend/src/pages/BookmarksPage.tsx`
- Test: `frontend/src/pages/BookmarksPage.test.tsx` (no changes expected — run to confirm still green)

**Interfaces:**
- Consumes: `FontAwesomeIcon`, `faRightFromBracket`, `faTriangleExclamation` from Task 2's packages.

- [ ] **Step 1: Confirm the existing tests currently pass (baseline)**

Run: `cd frontend && npx vitest run src/pages/BookmarksPage.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 2: Restyle the header and error banner**

Replace the full contents of `frontend/src/pages/BookmarksPage.tsx`:

```tsx
import { useEffect, useState, useCallback, useRef } from 'react'
import { signOut } from 'firebase/auth'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faRightFromBracket, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'
import { auth } from '../firebase'
import { api } from '../api'
import type { Bookmark } from '../api'
import BookmarkForm from '../components/BookmarkForm'
import BookmarkList from '../components/BookmarkList'

export default function BookmarksPage() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [error, setError] = useState<string | null>(null)
  // Shared across the mount effect and refresh() so a slow, superseded request can't
  // overwrite state a newer request already applied.
  const requestId = useRef(0)

  const refresh = useCallback(async () => {
    const id = ++requestId.current
    try {
      const result = await api.listBookmarks()
      if (id !== requestId.current) return
      setBookmarks(result)
      setError(null)
    } catch {
      if (id !== requestId.current) return
      setError('Failed to load bookmarks.')
    }
  }, [])

  useEffect(() => {
    const id = ++requestId.current
    let cancelled = false
    api
      .listBookmarks()
      .then((result) => {
        if (cancelled || id !== requestId.current) return
        setBookmarks(result)
        setError(null)
      })
      .catch(() => {
        if (cancelled || id !== requestId.current) return
        setError('Failed to load bookmarks.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleAdd(bookmark: { url: string }) {
    try {
      await api.createBookmark(bookmark)
      await refresh()
    } catch {
      // Invalidate any in-flight load (mount fetch or refresh) so its eventual
      // resolution can't silently clear this error once it lands.
      requestId.current++
      setError('Failed to add bookmark.')
      throw new Error('Failed to add bookmark.')
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between px-4 pt-6 pb-4 border-b border-gray-200">
        <h1 className="text-2xl font-bold">hamster</h1>
        <button
          onClick={() => signOut(auth)}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 cursor-pointer"
        >
          <FontAwesomeIcon icon={faRightFromBracket} aria-hidden="true" />
          Sign out
        </button>
      </div>
      {error && (
        <div className="mx-4 mt-4 flex items-center gap-2 bg-red-50 border border-red-200 rounded-md px-3 py-2 text-red-700 text-sm">
          <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" />
          {error}
        </div>
      )}
      <BookmarkForm onAdd={handleAdd} />
      <BookmarkList bookmarks={bookmarks} />
    </div>
  )
}
```

- [ ] **Step 3: Run the tests to verify they still pass**

Run: `cd frontend && npx vitest run src/pages/BookmarksPage.test.tsx`
Expected: PASS (7 tests, unchanged) — `getByRole('button', { name: 'Sign out' })` and the `getByText`/`findByText` error-message queries still resolve because the icons are `aria-hidden` and the error string is still the element's exact text content.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/BookmarksPage.tsx
git commit -m "style: redesign BookmarksPage header and error banner"
```

---

### Task 5: Add loading state for the initial bookmark fetch

**Files:**
- Modify: `frontend/src/pages/BookmarksPage.tsx`
- Test: `frontend/src/pages/BookmarksPage.test.tsx`

**Interfaces:**
- Consumes: `faSpinner` from `@fortawesome/free-solid-svg-icons` (Task 2).
- Produces: a `role="status"` element with accessible name `"Loading bookmarks"`, present only while the initial mount fetch is pending.

- [ ] **Step 1: Write the failing tests**

Add these two `it` blocks inside the existing `describe('BookmarksPage', ...)` block in `frontend/src/pages/BookmarksPage.test.tsx` (after the last existing test):

```tsx
  it('shows a loading indicator until the initial fetch resolves, then hides it', async () => {
    let resolveMountFetch!: (value: Awaited<ReturnType<typeof api.listBookmarks>>) => void
    const mountFetchPromise = new Promise<Awaited<ReturnType<typeof api.listBookmarks>>>(
      (resolve) => {
        resolveMountFetch = resolve
      }
    )
    vi.mocked(api.listBookmarks).mockReturnValueOnce(mountFetchPromise)

    render(<BookmarksPage />)
    expect(screen.getByRole('status', { name: 'Loading bookmarks' })).toBeInTheDocument()

    resolveMountFetch([])
    await waitFor(() =>
      expect(screen.queryByRole('status', { name: 'Loading bookmarks' })).not.toBeInTheDocument()
    )
  })

  it('hides the loading indicator even when the initial fetch fails', async () => {
    vi.mocked(api.listBookmarks).mockRejectedValueOnce(new Error('network error'))
    render(<BookmarksPage />)
    await screen.findByText('Failed to load bookmarks.')
    expect(screen.queryByRole('status', { name: 'Loading bookmarks' })).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/pages/BookmarksPage.test.tsx`
Expected: FAIL — no element with `role="status"` exists yet.

- [ ] **Step 3: Implement the loading state**

In `frontend/src/pages/BookmarksPage.tsx`:

1. Add the import: `import { faRightFromBracket, faTriangleExclamation, faSpinner } from '@fortawesome/free-solid-svg-icons'` (replacing the Task 4 import line).
2. Add `const [isLoading, setIsLoading] = useState(true)` alongside the other `useState` calls.
3. Change the mount `useEffect` to clear the loading flag once the fetch settles, regardless of outcome:

```tsx
  useEffect(() => {
    const id = ++requestId.current
    let cancelled = false
    api
      .listBookmarks()
      .then((result) => {
        if (cancelled || id !== requestId.current) return
        setBookmarks(result)
        setError(null)
      })
      .catch(() => {
        if (cancelled || id !== requestId.current) return
        setError('Failed to load bookmarks.')
      })
      .finally(() => {
        if (cancelled) return
        setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])
```

4. Replace the `<BookmarkList bookmarks={bookmarks} />` line at the bottom of the JSX with:

```tsx
      <BookmarkForm onAdd={handleAdd} />
      {isLoading ? (
        <div
          role="status"
          aria-label="Loading bookmarks"
          className="flex justify-center py-10 text-gray-400"
        >
          <FontAwesomeIcon icon={faSpinner} spin size="lg" aria-hidden="true" />
        </div>
      ) : (
        <BookmarkList bookmarks={bookmarks} />
      )}
```

   (This replaces both the `<BookmarkForm onAdd={handleAdd} />` and `<BookmarkList bookmarks={bookmarks} />` lines from Task 4 — the form stays outside the `isLoading` branch so it's usable immediately.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/pages/BookmarksPage.test.tsx`
Expected: PASS (9 tests — the 7 from before plus the 2 new ones). The pre-existing "loads and shows bookmarks on mount" test still passes because it uses `findByRole` (which retries/awaits), so it naturally waits past the loading state.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/BookmarksPage.tsx frontend/src/pages/BookmarksPage.test.tsx
git commit -m "feat: show a loading indicator during the initial bookmark fetch"
```

---

### Task 6: Redesign BookmarkForm

**Files:**
- Modify: `frontend/src/components/BookmarkForm.tsx`
- Test: `frontend/src/components/BookmarkForm.test.tsx` (no changes expected — run to confirm still green)

**Interfaces:**
- Consumes: `FontAwesomeIcon`, `faPlus`, `faSpinner` from Task 2's packages.

- [ ] **Step 1: Confirm the existing tests currently pass (baseline)**

Run: `cd frontend && npx vitest run src/components/BookmarkForm.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 2: Restyle the form**

Replace the full contents of `frontend/src/components/BookmarkForm.tsx`:

```tsx
import { useState } from 'react'
import type { FormEvent } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faSpinner } from '@fortawesome/free-solid-svg-icons'

interface BookmarkFormProps {
  onAdd: (bookmark: { url: string }) => void | Promise<void>
}

export default function BookmarkForm({ onAdd }: BookmarkFormProps) {
  const [url, setUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (submitting || !url.trim()) return
    setSubmitting(true)
    try {
      await onAdd({ url: url.trim() })
      setUrl('')
    } catch {
      // onAdd failed; leave the field populated so the user doesn't lose their input
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 p-4">
      <input
        id="bookmark-url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="Paste a URL…"
        aria-label="URL"
        disabled={submitting}
        className="flex-1 border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500"
      />
      <button
        type="submit"
        disabled={submitting}
        className="flex items-center gap-2 px-4 py-2 rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
      >
        <FontAwesomeIcon icon={submitting ? faSpinner : faPlus} spin={submitting} aria-hidden="true" />
        Add bookmark
      </button>
    </form>
  )
}
```

- [ ] **Step 3: Run the tests to verify they still pass**

Run: `cd frontend && npx vitest run src/components/BookmarkForm.test.tsx`
Expected: PASS (5 tests, unchanged) — `aria-label="URL"` and the button's accessible name `"Add bookmark"` are both unchanged (icon is `aria-hidden`).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/BookmarkForm.tsx
git commit -m "style: redesign BookmarkForm with Tailwind + Font Awesome"
```

---

### Task 7: Redesign BookmarkList (rows, favicon, domain/time, empty state)

**Files:**
- Modify: `frontend/src/components/BookmarkList.tsx`
- Modify: `frontend/src/components/BookmarkList.test.tsx`

**Interfaces:**
- Consumes: `formatRelativeTime` from `frontend/src/relativeTime.ts` (Task 1); `FontAwesomeIcon`, `faLink`, `faArrowUpRightFromSquare` from Task 2's packages.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `frontend/src/components/BookmarkList.test.tsx`:

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
    expect(
      screen.getByText('No bookmarks yet — paste a URL above to add one.')
    ).toBeInTheDocument()
  })

  it('renders each bookmark as a link to its URL', () => {
    render(<BookmarkList bookmarks={bookmarks} />)
    const link = screen.getByRole('link', { name: 'Example Site' })
    expect(link).toHaveAttribute('href', 'https://example.com')
  })

  it("shows the bookmark's domain and relative time", () => {
    const recent = [{ ...bookmarks[0], createdAt: new Date().toISOString() }]
    render(<BookmarkList bookmarks={recent} />)
    const link = screen.getByRole('link', { name: 'Example Site' })
    expect(link).toHaveTextContent('example.com')
    expect(link).toHaveTextContent('just now')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/BookmarkList.test.tsx`
Expected: FAIL — the empty-state text no longer matches the current implementation's `"No bookmarks yet."`, and the domain/time test finds no such text.

- [ ] **Step 3: Implement the redesign**

Replace the full contents of `frontend/src/components/BookmarkList.tsx`:

```tsx
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faLink, faArrowUpRightFromSquare } from '@fortawesome/free-solid-svg-icons'
import type { Bookmark } from '../api'
import { formatRelativeTime } from '../relativeTime'

interface BookmarkListProps {
  bookmarks: Bookmark[]
}

export default function BookmarkList({ bookmarks }: BookmarkListProps) {
  if (bookmarks.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-gray-400">
        <FontAwesomeIcon icon={faLink} size="lg" aria-hidden="true" />
        <p className="m-0 text-sm">No bookmarks yet — paste a URL above to add one.</p>
      </div>
    )
  }

  return (
    <ul className="flex flex-col p-4">
      {bookmarks.map((bookmark) => (
        <li key={bookmark.id} className="group border-b border-gray-100 last:border-b-0">
          <a
            href={bookmark.url}
            target="_blank"
            rel="noreferrer"
            aria-label={bookmark.title}
            className="flex items-center gap-3 py-2.5 px-1 rounded-md hover:bg-gray-50"
          >
            <span className="flex items-center justify-center w-7 h-7 rounded-md bg-gray-100 text-gray-400 flex-shrink-0">
              <FontAwesomeIcon icon={faLink} size="xs" aria-hidden="true" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block font-medium text-gray-900 truncate">{bookmark.title}</span>
              <span className="block text-xs text-gray-500">
                {new URL(bookmark.url).hostname} · {formatRelativeTime(bookmark.createdAt)}
              </span>
            </span>
            <FontAwesomeIcon
              icon={faArrowUpRightFromSquare}
              aria-hidden="true"
              className="text-gray-300 opacity-0 group-hover:opacity-100 flex-shrink-0"
            />
          </a>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/BookmarkList.test.tsx`
Expected: PASS (3 tests). The link's accessible name stays exactly `bookmark.title` because of the explicit `aria-label`, even though the anchor visually contains the favicon and meta line too.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/BookmarkList.tsx frontend/src/components/BookmarkList.test.tsx
git commit -m "style: redesign BookmarkList with favicon, domain, and relative time"
```

---

### Task 8: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full frontend test suite**

Run: `cd frontend && npm test`
Expected: PASS — all suites green (App, LoginPage, BookmarksPage, BookmarkForm, BookmarkList, api, firebase, relativeTime).

- [ ] **Step 2: Run lint and format checks**

Run: `cd frontend && npm run lint && npm run format:check`
Expected: both succeed with no errors. If `format:check` fails, run `npm run format` and re-verify, then amend the affected commit(s) or add a small formatting-fix commit.

- [ ] **Step 3: Run the production build**

Run: `cd frontend && npm run build`
Expected: succeeds (type-checks via `tsc` then builds via `vite build`).

- [ ] **Step 4: Manually smoke-test in the browser**

Run: `cd frontend && npm run dev`, open the printed local URL, and check: login page renders the card + Google icon; after sign-in, the header shows the sign-out icon; adding a bookmark shows the spinner briefly on the button; the bookmark list shows favicon chip, domain, and relative time per row; hovering a row shows the external-link icon and highlights; an empty account shows the restrained empty-state message; a fresh page load briefly shows the loading spinner before the list appears.

- [ ] **Step 5: Commit any fixes found during smoke-testing, otherwise proceed**

No commit needed if nothing was found.
