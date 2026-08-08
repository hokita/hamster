import { expect, type Page } from '@playwright/test'

export const AUTH_EMULATOR_URL = 'http://localhost:9099'
export const TEST_EMAIL = 'e2e@example.com'
export const TEST_PASSWORD = 'e2e-test-password-123'

export async function signIn(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Sign in with Google' }).click()
  await expect(page.getByRole('button', { name: 'Add bookmark' })).toBeVisible()
}
