import { test, expect } from '@playwright/test'
import { signIn } from '../fixtures/auth'
import { clearFirestore } from '../fixtures/firestore'

test.describe('bookmark summary page', () => {
  test.beforeEach(async ({ page }) => {
    await clearFirestore()
    await signIn(page)
  })

  test('opens a bookmark and shows its summary page', async ({ page }) => {
    await page.getByLabel('URL').fill('https://example.com')
    await page.getByRole('button', { name: 'Add bookmark' }).click()
    await expect(page.getByRole('link', { name: 'Example Domain' })).toBeVisible()

    await page.getByRole('link', { name: 'Example Domain' }).click()

    await expect(page).toHaveURL(/\/bookmarks\/.+/)
    await expect(page.getByRole('heading', { name: 'Example Domain' })).toBeVisible()
    // No GEMINI_API_KEY in the e2e environment, so generation is unavailable and the page
    // stays in its empty state.
    await expect(page.getByText('No summary yet.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Generate summary' })).toBeVisible()
  })

  test('survives a reload of the summary page URL', async ({ page }) => {
    await page.getByLabel('URL').fill('https://example.com')
    await page.getByRole('button', { name: 'Add bookmark' }).click()
    await page.getByRole('link', { name: 'Example Domain' }).click()
    await expect(page).toHaveURL(/\/bookmarks\/.+/)

    await page.reload()

    await expect(page.getByRole('heading', { name: 'Example Domain' })).toBeVisible()
  })
})
