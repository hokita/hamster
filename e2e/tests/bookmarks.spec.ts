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
