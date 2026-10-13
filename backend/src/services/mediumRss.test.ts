import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./safeFetch', () => ({ fetchAllowedUrl: vi.fn() }))

import { fetchAllowedUrl } from './safeFetch'
import { fetchMediumRssArticle } from './mediumRss'

const url = 'https://copyconstruct.medium.com/article-bd3dcb2c5f7b'
const item = `<item><title><![CDATA[Debugging & code]]></title>
  <link>${url}?source=rss</link>
  <content:encoded><![CDATA[<p>Read &amp; understand.</p>]]></content:encoded></item>`
const feed = (entries = item) =>
  `<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>${entries}</channel></rss>`

function respond(xml: string, status = 200) {
  vi.mocked(fetchAllowedUrl).mockResolvedValue({
    response: new Response(xml, { status }),
    finalUrl: 'https://copyconstruct.medium.com/feed',
  })
}

beforeEach(() => vi.resetAllMocks())

describe('fetchMediumRssArticle', () => {
  it('matches the article ID, preserves CDATA HTML, and decodes the title', async () => {
    respond(
      feed(
        `<item><title>Other</title><link>https://copyconstruct.medium.com/other-aaaaaaaaaaaa</link></item>${item}`
      )
    )
    await expect(fetchMediumRssArticle(url)).resolves.toEqual({
      title: 'Debugging & code',
      html: '<p>Read &amp; understand.</p>',
    })
    expect(fetchAllowedUrl).toHaveBeenCalledWith(
      'https://copyconstruct.medium.com/feed',
      expect.any(AbortSignal)
    )
  })

  it('supports Medium @author URLs and ignores tracking parameters', async () => {
    respond(feed())
    await expect(
      fetchMediumRssArticle('https://medium.com/@copyconstruct/article-bd3dcb2c5f7b?source=share')
    ).resolves.not.toBeNull()
    expect(fetchAllowedUrl).toHaveBeenCalledWith(
      'https://medium.com/feed/@copyconstruct',
      expect.any(AbortSignal)
    )
  })

  it.each([
    'https://medium.com.evil.test/article-bd3dcb2c5f7b',
    'https://evilmedium.com/article-bd3dcb2c5f7b',
    'https://example.com/article-bd3dcb2c5f7b',
    'https://medium.com/article-bd3dcb2c5f7b',
    'https://copyconstruct.medium.com/not-an-article',
    'file://copyconstruct.medium.com/article-bd3dcb2c5f7b',
    'invalid',
  ])('does not fetch a feed for unsupported URL %s', async (input) => {
    await expect(fetchMediumRssArticle(input)).resolves.toBeNull()
    expect(fetchAllowedUrl).not.toHaveBeenCalled()
  })

  it.each([
    feed(''),
    feed(item.replace('bd3dcb2c5f7b', 'aaaaaaaaaaaa')),
    feed(
      item.replace(
        /<content:encoded>[\s\S]*?<\/content:encoded>/,
        '<description>Teaser only</description>'
      )
    ),
    '<rss><channel>',
    '<html>Blocked</html>',
    '<!DOCTYPE rss [<!ENTITY custom "fake">]>' + feed(),
  ])('rejects missing content, nonmatching entries, and invalid feeds', async (xml) => {
    respond(xml)
    await expect(fetchMediumRssArticle(url)).resolves.toBeNull()
  })

  it('rejects oversized feeds', async () => {
    respond(feed(item + ' '.repeat(5_000_000)))
    await expect(fetchMediumRssArticle(url)).resolves.toBeNull()
  })

  it('returns null when the feed is blocked or unsafe', async () => {
    respond(feed(), 403)
    await expect(fetchMediumRssArticle(url)).resolves.toBeNull()
    vi.mocked(fetchAllowedUrl).mockResolvedValue(null)
    await expect(fetchMediumRssArticle(url)).resolves.toBeNull()
  })

  it('returns null on network failure', async () => {
    vi.mocked(fetchAllowedUrl).mockRejectedValue(new Error('network failure'))
    await expect(fetchMediumRssArticle(url)).resolves.toBeNull()
  })
})
