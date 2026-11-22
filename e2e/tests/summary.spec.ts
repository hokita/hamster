import { test, expect, type Page } from '@playwright/test'
import { signIn } from '../fixtures/auth'
import { clearFirestore, seedBookmark } from '../fixtures/firestore'

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

for (const width of [390, 1280]) {
  test(`shows the complete short sentence at ${width}px`, async ({ page }) => {
    await clearFirestore()
    await page.setViewportSize({ width, height: 844 })
    const overview =
      'Engineering leaders need to balance delivery speed with professional growth. '.repeat(12)
    const sentence =
      'The article explains how engineering leaders can balance faster delivery with thoughtful practice that builds architectural judgment, debugging skills, and long-term professional growth.'
    await seedBookmark({
      url: 'https://example.com',
      title: 'Long article',
      summary: overview,
      shortSummary: sentence,
    })
    await signIn(page)

    const preview = page.getByRole('link', { name: /Long article/ }).locator('span[lang]')
    await expect(preview).toBeVisible()
    const dimensions = await preview.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
      contentHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      width: element.clientWidth,
      contentWidth: element.scrollWidth,
    }))
    await expect(preview).toHaveText(sentence)
    expect(dimensions.contentHeight).toBeLessThanOrEqual(dimensions.clientHeight + 1)
    expect(dimensions.contentWidth).toBeLessThanOrEqual(dimensions.width + 1)
    if (width === 390) expect(dimensions.height).toBeGreaterThan(dimensions.lineHeight)
    await expect(page.getByText(overview.trim(), { exact: true })).not.toBeVisible()

    await page.getByRole('link', { name: /Long article/ }).click()
    await expect(page.getByText(overview.trim(), { exact: true })).toBeVisible()
  })
}
