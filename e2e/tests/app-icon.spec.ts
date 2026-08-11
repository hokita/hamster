import { test, expect } from '@playwright/test'
import type { APIResponse } from '@playwright/test'

// A missing asset does not 404 here: both Vite's history fallback and the Firebase
// Hosting `**` rewrite serve index.html with a 200. So status alone proves nothing —
// every asset assertion has to look at the bytes that actually came back.
const SIGNATURES: Record<string, { type: RegExp; magic: (b: Buffer) => boolean }> = {
  png: {
    type: /^image\/png/,
    magic: (b) =>
      b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  ico: {
    type: /^image\/(vnd\.microsoft\.icon|x-icon)/,
    magic: (b) => b.subarray(0, 4).equals(Buffer.from([0x00, 0x00, 0x01, 0x00])),
  },
  svg: {
    type: /^image\/svg\+xml/,
    magic: (b) => /^\s*(<\?xml|<svg)/.test(b.subarray(0, 200).toString('utf8')),
  },
}

async function expectRealAsset(response: APIResponse, href: string) {
  expect(response.status(), `${href} should be served`).toBe(200)

  const contentType = response.headers()['content-type'] ?? ''
  expect(contentType, `${href} fell through to the SPA fallback`).not.toMatch(/text\/html/)

  const ext = href.split('.').pop() ?? ''
  const signature = SIGNATURES[ext]
  expect(signature, `no signature defined for .${ext}`).toBeDefined()

  expect(contentType, `${href} served with the wrong content type`).toMatch(signature.type)
  const body = await response.body()
  expect(signature.magic(body), `${href} body is not a real .${ext}`).toBe(true)
}

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
      .locator('link[rel*="icon"]')
      .evaluateAll((links) => links.map((l) => (l as HTMLLinkElement).getAttribute('href') ?? ''))
    // rel="icon" x2, rel="shortcut icon", rel="apple-touch-icon"
    expect(hrefs).toHaveLength(4)

    for (const href of hrefs) {
      await expectRealAsset(await request.get(href), href)
    }
  })

  test('manifest points at icons that exist', async ({ request }) => {
    const response = await request.get('/site.webmanifest')
    expect(response.status()).toBe(200)
    expect(
      response.headers()['content-type'] ?? '',
      '/site.webmanifest fell through to the SPA fallback'
    ).not.toMatch(/text\/html/)

    const manifest = JSON.parse((await response.body()).toString('utf8'))
    expect(manifest.name).toBe('hamster')
    expect(manifest.icons.length).toBeGreaterThan(0)

    for (const icon of manifest.icons) {
      await expectRealAsset(await request.get(icon.src), icon.src)
    }
  })

  // The manifest's display member is honoured by iOS 15.4+ for Add to Home Screen, so
  // anything other than `browser` drops Safari's navigation controls (no back button).
  // This PR only adds an icon; it should not change how the app launches.
  test('home screen launches keep browser navigation controls', async ({ request }) => {
    const manifest = JSON.parse((await (await request.get('/site.webmanifest')).body()).toString())

    expect(manifest.display ?? 'browser').toBe('browser')
    await expect(request.get('/').then((r) => r.text())).resolves.not.toMatch(
      /apple-mobile-web-app-capable|["']mobile-web-app-capable["']/
    )
  })
})
