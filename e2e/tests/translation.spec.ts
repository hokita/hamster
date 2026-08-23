import { test, expect } from '@playwright/test'
import { signIn } from '../fixtures/auth'
import { clearFirestore, seedBookmark } from '../fixtures/firestore'

const ENGLISH_SUMMARY = 'The article explains widgets.'
const JAPANESE_SUMMARY = 'この記事はウィジェットの仕組みを説明しています。'

test.describe('translating a summary into Japanese', () => {
  test.beforeEach(async ({ page }) => {
    await clearFirestore()
    await signIn(page)
  })

  test('offers a translation under an English summary', async ({ page }) => {
    const id = await seedBookmark({
      url: 'https://example.com',
      title: 'Example Domain',
      summary: ENGLISH_SUMMARY,
    })

    await page.goto(`/bookmarks/${id}`)

    await expect(page.getByText(ENGLISH_SUMMARY)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Translate to Japanese' })).toBeEnabled()
  })

  test('does not offer one for a summary that is already Japanese', async ({ page }) => {
    const id = await seedBookmark({
      url: 'https://example.com',
      title: 'Example Domain',
      summary: JAPANESE_SUMMARY,
    })

    await page.goto(`/bookmarks/${id}`)

    await expect(page.getByText(JAPANESE_SUMMARY)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Translate to Japanese' })).toHaveCount(0)
    // The summary itself is unaffected — only the button it would have carried is gone.
    await expect(page.getByRole('button', { name: 'Regenerate' })).toBeVisible()
  })

  test('keeps the English summary when the translation fails', async ({ page }) => {
    const id = await seedBookmark({
      url: 'https://example.com',
      title: 'Example Domain',
      summary: ENGLISH_SUMMARY,
    })

    await page.goto(`/bookmarks/${id}`)
    await page.getByRole('button', { name: 'Translate to Japanese' }).click()

    // No GEMINI_API_KEY in the e2e environment, so POST /:id/translation deterministically
    // returns 503. Nothing was replaced: the English is still there and still readable, and the
    // button is ready for another try.
    await expect(page.getByText("Couldn't translate the summary.")).toBeVisible()
    await expect(page.getByText(ENGLISH_SUMMARY)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Translate to Japanese' })).toBeEnabled()
  })
})
