import { test, expect } from '@playwright/test'

test.describe('app icon and title', () => {
  test('sets the page title', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle('hamster')
  })

  test('declares the favicon, apple-touch-icon and manifest', async ({ page }) => {
    await page.goto('/')

    await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute(
      'href',
      '/favicon.svg'
    )
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      'href',
      '/apple-touch-icon.png'
    )
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/site.webmanifest')
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
      'content',
      'hamster'
    )
  })

  test('serves every declared icon asset', async ({ page, request }) => {
    await page.goto('/')

    const hrefs = await page
      .locator('link[rel*="icon"], link[rel="manifest"]')
      .evaluateAll((links) => links.map((l) => (l as HTMLLinkElement).getAttribute('href') ?? ''))
    expect(hrefs.length).toBeGreaterThan(0)

    for (const href of hrefs) {
      const response = await request.get(href)
      expect(response.status(), `${href} should be served`).toBe(200)
      expect((await response.body()).byteLength, `${href} should not be empty`).toBeGreaterThan(0)
    }
  })

  test('manifest points at icons that exist', async ({ request }) => {
    const manifest = await (await request.get('/site.webmanifest')).json()
    expect(manifest.name).toBe('hamster')

    for (const icon of manifest.icons) {
      const response = await request.get(icon.src)
      expect(response.status(), `${icon.src} should be served`).toBe(200)
    }
  })
})
