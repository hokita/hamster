import { test, expect } from '@playwright/test'
import { signIn } from '../fixtures/auth'
import { clearFirestore, seedBookmark } from '../fixtures/firestore'

test.describe('ask about an article', () => {
  test.beforeEach(async ({ page }) => {
    await clearFirestore()
    await signIn(page)
  })

  test('offers a question box on the bookmark page', async ({ page }) => {
    const id = await seedBookmark({
      url: 'https://example.com',
      title: 'Example Domain',
      summary: 'A stored summary.',
    })

    await page.goto(`/bookmarks/${id}`)

    await expect(page.getByRole('heading', { name: 'Ask about this article' })).toBeVisible()
    await expect(page.getByLabel('Ask a question about this article')).toBeVisible()
    // Nothing typed yet, so there is nothing to ask.
    await expect(page.getByRole('button', { name: 'Ask' })).toBeDisabled()
  })

  test('keeps the question and offers a retry when answering fails', async ({ page }) => {
    const id = await seedBookmark({
      url: 'https://example.com',
      title: 'Example Domain',
      summary: 'A stored summary.',
    })

    await page.goto(`/bookmarks/${id}`)
    await page.getByLabel('Ask a question about this article').fill('What is this page about?')
    await page.getByRole('button', { name: 'Ask' }).click()

    // No GEMINI_API_KEY in the e2e environment, so POST /:id/chat deterministically returns 503.
    // The question must survive the failure so Retry can resend the same conversation.
    await expect(page.getByText('What is this page about?')).toBeVisible()
    await expect(page.getByText("Couldn't answer that question.")).toBeVisible()
    await expect(page.getByRole('button', { name: 'Retry' })).toBeEnabled()
  })
})
