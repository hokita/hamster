import { test, expect, type Page } from '@playwright/test'
import { signIn } from '../fixtures/auth'
import { clearFirestore, seedBookmark } from '../fixtures/firestore'

// Deliberately not a second real external site: this loopback literal is rejected synchronously
// by the backend's SSRF guard (isDisallowedHost in backend/src/services/ipGuard.ts checks
// node:net's isIP() before ever touching DNS or the network), so fetchMetadata always returns a
// null title with no network round trip and no flake risk. The bookmarks route then falls back to
// the URL itself as the title (backend/src/routes/bookmarks.ts: `title ?? url`), giving these
// tests a second, deterministic, offline-safe title that's clearly distinct from "Example Domain"
// — enough to prove the summary page renders the bookmark named by the URL's id, not just
// "whichever bookmark happens to exist".
const SECOND_URL = 'http://127.0.0.1/blocked-by-ip-guard'

async function addBookmark(page: Page, url: string, expectedTitle: string) {
  await page.getByLabel('URL').fill(url)
  await page.getByRole('button', { name: 'Add bookmark' }).click()
  await expect(page.getByRole('link', { name: expectedTitle })).toBeVisible()
}

test.describe('bookmark summary page', () => {
  test.beforeEach(async ({ page }) => {
    await clearFirestore()
    await signIn(page)
  })

  test('opens a bookmark and shows its summary page', async ({ page }) => {
    await addBookmark(page, 'https://example.com', 'Example Domain')
    await addBookmark(page, SECOND_URL, SECOND_URL)

    await page.getByRole('link', { name: SECOND_URL }).click()

    await expect(page).toHaveURL(/\/bookmarks\/.+/)
    await expect(page.getByRole('heading', { name: SECOND_URL })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Example Domain' })).not.toBeVisible()
    // No GEMINI_API_KEY in the e2e environment, so generation is unavailable and the page
    // stays in its empty state.
    await expect(page.getByText('No summary yet.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Generate summary' })).toBeVisible()
  })

  test('survives a reload of the summary page URL', async ({ page }) => {
    await addBookmark(page, 'https://example.com', 'Example Domain')
    await addBookmark(page, SECOND_URL, SECOND_URL)

    await page.getByRole('link', { name: SECOND_URL }).click()
    await expect(page).toHaveURL(/\/bookmarks\/.+/)

    await page.reload()

    await expect(page.getByRole('heading', { name: SECOND_URL })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Example Domain' })).not.toBeVisible()
  })

  test('attempts to generate a summary and shows the failure state', async ({ page }) => {
    await addBookmark(page, 'https://example.com', 'Example Domain')
    await page.getByRole('link', { name: 'Example Domain' }).click()
    await expect(page).toHaveURL(/\/bookmarks\/.+/)

    await page.getByRole('button', { name: 'Generate summary' }).click()

    // No GEMINI_API_KEY in the e2e environment, so POST /:id/summary deterministically returns
    // 503 and the page flips from its empty state to its failure state.
    await expect(page.getByText("Couldn't generate a summary.")).toBeVisible()
    const retryButton = page.getByRole('button', { name: 'Try again' })
    await expect(retryButton).toBeVisible()
    await expect(retryButton).toBeEnabled()
  })

  test('keeps the existing summary when a regeneration fails', async ({ page }) => {
    const id = await seedBookmark({
      url: 'https://example.com',
      title: 'Example Domain',
      summary: 'A stored summary.',
    })

    await page.goto(`/bookmarks/${id}`)
    await expect(page.getByText('A stored summary.')).toBeVisible()

    await page.getByRole('button', { name: 'Regenerate' }).click()

    // Same deterministic 503 as the generate case above — no GEMINI_API_KEY in e2e. The point
    // here is that a failed regeneration is non-destructive: the stored summary is still shown.
    await expect(page.getByText(/Couldn't regenerate the summary/)).toBeVisible()
    await expect(page.getByText('A stored summary.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Regenerate' })).toBeEnabled()
  })

  test('shows an error for a bookmark that does not exist', async ({ page }) => {
    await page.goto('/bookmarks/does-not-exist')

    await expect(page.getByText('Failed to load this bookmark.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back to bookmarks' })).toBeVisible()
  })
})
