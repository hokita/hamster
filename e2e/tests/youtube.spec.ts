import { test, expect } from '@playwright/test'
import { signIn } from '../fixtures/auth'
import { clearFirestore, seedBookmark } from '../fixtures/firestore'

// The e2e backend has no YOUTUBE_SUMMARIES flag and no API keys, so these tests only read
// seeded video summary state — nothing here reaches YouTube or Gemini.
test.describe('YouTube bookmark summary states', () => {
  test.beforeEach(async ({ page }) => {
    await clearFirestore()
    await signIn(page)
  })

  test('explains a video that is too long, with no retry', async ({ page }) => {
    const id = await seedBookmark({
      url: 'https://youtu.be/O_zcc6Xl12g',
      title: 'All Code Is Slop',
      videoSummaryState: {
        status: 'failed',
        code: 'video_too_long',
        updatedAt: new Date().toISOString(),
      },
    })

    await page.goto(`/bookmarks/${id}`)

    await expect(
      page.getByText("This video is longer than 60 minutes, so it wasn't summarized.")
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0)
  })

  test('shows progress while a video summary is running', async ({ page }) => {
    const id = await seedBookmark({
      url: 'https://youtu.be/O_zcc6Xl12g',
      title: 'All Code Is Slop',
      videoSummaryState: { status: 'running', updatedAt: new Date().toISOString() },
    })

    await page.goto(`/bookmarks/${id}`)

    await expect(
      page.getByText('Summarizing the video — this can take a few minutes.')
    ).toBeVisible()
    await expect(page.getByRole('button', { name: /Generate summary/ })).toBeDisabled()
  })
})
