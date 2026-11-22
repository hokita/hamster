import { test, expect } from '@playwright/test'
import { signIn } from '../fixtures/auth'
import { clearFirestore } from '../fixtures/firestore'

test.describe('bookmarks', () => {
  test.beforeEach(async ({ page }) => {
    await clearFirestore()
    await signIn(page)
  })

  test('adds a bookmark and shows it in the list', async ({ page }) => {
    await page.getByLabel('URL').fill('https://example.com')
    await page.getByRole('button', { name: 'Add bookmark' }).click()

    await expect(page.getByRole('link', { name: 'Example Domain' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Example Domain' })).toHaveAttribute(
      'href',
      /^\/bookmarks\/.+/
    )
    await expect(
      page.getByRole('link', { name: 'Open example.com in a new tab' })
    ).toHaveAttribute('href', 'https://example.com')
  })

  test('deletes a bookmark from the list, for good', async ({ page }) => {
    await page.getByLabel('URL').fill('https://example.com')
    await page.getByRole('button', { name: 'Add bookmark' }).click()
    await expect(page.getByRole('link', { name: 'Example Domain' })).toBeVisible()

    await page.getByRole('button', { name: 'Delete Example Domain on example.com' }).click()
    await expect(page.getByRole('link', { name: 'Example Domain' })).toBeVisible()
    await page
      .getByRole('button', { name: 'Confirm deleting Example Domain on example.com' })
      .click()

    await expect(page.getByRole('link', { name: 'Example Domain' })).toHaveCount(0)

    await page.reload()
    await expect(page.getByText('No bookmarks yet — paste a URL above to add one.')).toBeVisible()
  })

  test('keeps a bookmark when the delete is cancelled', async ({ page }) => {
    await page.getByLabel('URL').fill('https://example.com')
    await page.getByRole('button', { name: 'Add bookmark' }).click()
    await expect(page.getByRole('link', { name: 'Example Domain' })).toBeVisible()

    await page.getByRole('button', { name: 'Delete Example Domain on example.com' }).click()
    await page
      .getByRole('button', { name: 'Cancel deleting Example Domain on example.com' })
      .click()

    await page.reload()
    await expect(page.getByRole('link', { name: 'Example Domain' })).toBeVisible()
  })

  test('deletes a bookmark from its own page and returns to the list', async ({ page }) => {
    await page.getByLabel('URL').fill('https://example.com')
    await page.getByRole('button', { name: 'Add bookmark' }).click()
    await page.getByRole('link', { name: 'Example Domain' }).click()
    await expect(page.getByRole('heading', { name: 'Example Domain' })).toBeVisible()

    await page.getByRole('button', { name: 'Delete Example Domain on example.com' }).click()
    await page
      .getByRole('button', { name: 'Confirm deleting Example Domain on example.com' })
      .click()

    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByText('No bookmarks yet — paste a URL above to add one.')).toBeVisible()
  })

  test('marks a bookmark as read, and the flag outlives a reload', async ({ page }) => {
    await page.getByLabel('URL').fill('https://example.com')
    await page.getByRole('button', { name: 'Add bookmark' }).click()
    await expect(page.getByRole('link', { name: /Example Domain/ })).toBeVisible()

    await page.getByRole('button', { name: 'Mark Example Domain on example.com as read' }).click()
    await expect(
      page.getByRole('button', { name: 'Mark Example Domain on example.com as unread' })
    ).toBeVisible()
    await expect(page.getByRole('link', { name: /Example Domain/ })).toContainText('Read')

    await page.reload()
    await expect(
      page.getByRole('button', { name: 'Mark Example Domain on example.com as unread' })
    ).toBeVisible()
  })

  test('filters the list by read state', async ({ page }) => {
    await page.getByLabel('URL').fill('https://example.com')
    await page.getByRole('button', { name: 'Add bookmark' }).click()
    await expect(page.getByRole('link', { name: /Example Domain/ })).toBeVisible()

    await page.getByRole('button', { name: 'Unread', exact: true }).click()
    await expect(page.getByRole('link', { name: /Example Domain/ })).toBeVisible()

    const readWritten = page.waitForResponse(
      (response) => response.url().includes('/read') && response.request().method() === 'PUT'
    )
    await page.getByRole('button', { name: 'Mark Example Domain on example.com as read' }).click()
    await expect(page.getByRole('link', { name: /Example Domain/ })).toHaveCount(0)
    await expect(page.getByText('Nothing unread.')).toBeVisible()
    expect((await readWritten).status()).toBe(204)

    await page.reload()
    await page.getByRole('button', { name: 'Read', exact: true }).click()
    await expect(page.getByRole('link', { name: /Example Domain/ })).toBeVisible()
  })

  test("unmarks from the bookmark's own page, and the list agrees", async ({ page }) => {
    await page.getByLabel('URL').fill('https://example.com')
    await page.getByRole('button', { name: 'Add bookmark' }).click()
    await page.getByRole('button', { name: 'Mark Example Domain on example.com as read' }).click()
    await expect(
      page.getByRole('button', { name: 'Mark Example Domain on example.com as unread' })
    ).toBeVisible()

    await page.getByRole('link', { name: /Example Domain/ }).click()
    await expect(page.getByRole('heading', { name: 'Example Domain' })).toBeVisible()
    await page.getByRole('button', { name: 'Mark Example Domain on example.com as unread' }).click()
    await expect(
      page.getByRole('button', { name: 'Mark Example Domain on example.com as read' })
    ).toBeVisible()

    await page.getByRole('link', { name: 'Back to bookmarks' }).click()
    await expect(
      page.getByRole('button', { name: 'Mark Example Domain on example.com as read' })
    ).toBeVisible()
    await expect(page.getByRole('link', { name: /Example Domain/ })).not.toContainText('Read')
  })

  test('persists bookmarks across a reload', async ({ page }) => {
    await page.getByLabel('URL').fill('https://example.com')
    await page.getByRole('button', { name: 'Add bookmark' }).click()
    await expect(page.getByRole('link', { name: 'Example Domain' })).toBeVisible()

    await page.reload()
    await expect(page.getByRole('link', { name: 'Example Domain' })).toBeVisible()
  })
})
