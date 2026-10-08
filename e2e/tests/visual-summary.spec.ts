import { test, expect } from '@playwright/test'
import { signIn } from '../fixtures/auth'
import { clearFirestore, seedBookmark } from '../fixtures/firestore'
import type { VisualSummary } from '../../backend/src/visualSummary'

const source =
  'Product A costs $10, product B costs $20. First read the summary, then check the result.'
const visualSummary: VisualSummary = {
  blocks: [
    {
      type: 'cards',
      title: 'Key points',
      items: [{ title: 'Two products', text: 'A costs $10 and B costs $20.' }],
    },
    {
      type: 'comparison',
      title: 'Comparison',
      columns: ['Product', 'Price'],
      rows: [
        ['A', '$10'],
        ['B', '$20'],
      ],
    },
    { type: 'steps', title: 'Procedure', items: ['Read the summary', 'Check the result'] },
    {
      type: 'qa',
      title: 'Questions',
      items: [{ question: 'How much does A cost?', answer: 'A costs $10.' }],
    },
  ],
}

test.describe('visual summaries', () => {
  test.beforeEach(async ({ page }) => {
    await clearFirestore()
    await signIn(page)
  })

  test('restores saved JSON after reload and navigation without generating, while resetting operation state', async ({
    page,
  }) => {
    const id = await seedBookmark({
      url: 'https://example.com',
      title: 'Saved products',
      summary: source,
      visualSummary,
    })
    let calls = 0
    page.on('request', (request) => {
      if (request.url().endsWith('/visual-summary')) calls++
    })
    await page.goto(`/bookmarks/${id}`)
    await expect(page.getByRole('table', { name: 'Comparison' })).toBeVisible()
    const checkbox = page.getByRole('checkbox', { name: '1. Read the summary' })
    await checkbox.check()
    await page.locator('summary', { hasText: 'How much does A cost?' }).click()
    await page.reload()
    await expect(page.getByRole('table', { name: 'Comparison' })).toBeVisible()
    await expect(checkbox).not.toBeChecked()
    await expect(page.locator('details')).not.toHaveAttribute('open')
    await page.getByRole('link', { name: 'Back to bookmarks' }).click()
    await page.locator(`a[href="/bookmarks/${id}"]`).click()
    await expect(page.getByRole('table', { name: 'Comparison' })).toBeVisible()
    expect(calls).toBe(0)
    // Even an out-of-band text edit that leaves the saved JSON behind is rejected on read.
    const updated = await page.request.patch(
      `http://localhost:8081/v1/projects/demo-hamster-e2e/databases/(default)/documents/bookmarks/${id}?updateMask.fieldPaths=summary`,
      {
        headers: { Authorization: 'Bearer owner' },
        data: { fields: { summary: { stringValue: 'Updated saved summary.' } } },
      }
    )
    expect(updated.ok()).toBe(true)
    await page.reload()
    await expect(page.getByText('Updated saved summary.', { exact: true })).toBeVisible()
    await expect(page.getByRole('table')).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Generate visual summary' })).toBeVisible()
    expect(calls).toBe(0)
  })

  test('renders a mobile layout, keeps the original, and supports keyboard checkbox and Q&A controls', async ({
    page,
  }) => {
    const id = await seedBookmark({
      url: 'https://example.com',
      title: 'Products',
      summary: source,
    })
    let calls = 0
    await page.route('**/api/bookmarks/*/visual-summary', async (route) => {
      calls++
      expect(route.request().method()).toBe('POST')
      expect(route.request().postData()).toBeNull()
      expect(route.request().headers().authorization).toMatch(/^Bearer /)
      await route.fulfill({ json: { source, visualSummary } })
    })
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto(`/bookmarks/${id}`)
    await expect(page.getByText(source, { exact: true })).toBeVisible()
    expect(calls).toBe(0)
    await page.getByRole('button', { name: 'Generate visual summary' }).click()
    await expect(page.getByRole('table', { name: 'Comparison' })).toBeVisible()
    await expect(page.getByText(source, { exact: true })).toBeVisible()
    expect(calls).toBe(1)

    const checkbox = page.getByRole('checkbox', { name: '1. Read the summary' })
    await checkbox.focus()
    await page.keyboard.press('Space')
    await expect(checkbox).toBeChecked()
    await page.keyboard.press('Space')
    await expect(checkbox).not.toBeChecked()

    const question = page.locator('summary', { hasText: 'How much does A cost?' })
    const details = question.locator('..')
    await question.focus()
    await page.keyboard.press('Enter')
    await expect(details).toHaveAttribute('open', '')
    await expect(page.getByText('A costs $10.', { exact: true })).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(details).not.toHaveAttribute('open')
    expect(calls).toBe(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

    await page.reload()
    await expect(page.getByRole('button', { name: 'Generate visual summary' })).toBeVisible()
    await expect(page.getByRole('table')).not.toBeVisible()
    expect(calls).toBe(1)
  })

  test('shows missing-key failure and allows retry without losing the source summary', async ({
    page,
  }) => {
    const id = await seedBookmark({
      url: 'https://example.com',
      title: 'Products',
      summary: source,
    })
    await page.goto(`/bookmarks/${id}`)
    await page.getByRole('button', { name: 'Generate visual summary' }).click()
    await expect(page.getByRole('alert')).toContainText('GEMINI_API_KEY')
    await expect(page.getByText(source, { exact: true })).toBeVisible()
    await page.route('**/api/bookmarks/*/visual-summary', (route) =>
      route.fulfill({ json: { source, visualSummary } })
    )
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByRole('table', { name: 'Comparison' })).toBeVisible()
    await expect(page.getByRole('alert')).not.toBeVisible()
  })
})
