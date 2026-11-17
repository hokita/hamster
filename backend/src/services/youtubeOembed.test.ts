import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./safeFetch', () => ({
  fetchAllowedUrl: vi.fn(),
}))

import { fetchAllowedUrl } from './safeFetch'
import { fetchYouTubeTitle, YOUTUBE_FAVICON_URL } from './youtubeOembed'

const VIDEO_ID = 'O_zcc6Xl12g'

function jsonResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    ...init,
  })
}

function allow(response: Response) {
  vi.mocked(fetchAllowedUrl).mockResolvedValue({ response, finalUrl: 'https://www.youtube.com/' })
}

describe('fetchYouTubeTitle', () => {
  beforeEach(() => vi.resetAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('exposes the YouTube favicon url', () => {
    expect(YOUTUBE_FAVICON_URL).toBe('https://www.youtube.com/favicon.ico')
  })

  it('requests the oEmbed endpoint for the canonical url with a 5s timeout signal', async () => {
    const signal = new AbortController().signal
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(signal)
    allow(jsonResponse(JSON.stringify({ title: 'x' })))

    await fetchYouTubeTitle(VIDEO_ID)

    expect(timeout).toHaveBeenCalledWith(5000)
    expect(fetchAllowedUrl).toHaveBeenCalledWith(
      'https://www.youtube.com/oembed?url=' +
        encodeURIComponent(`https://www.youtube.com/watch?v=${VIDEO_ID}`) +
        '&format=json',
      signal
    )
  })

  it('trims and collapses whitespace in the title', async () => {
    allow(jsonResponse(JSON.stringify({ title: '  All Code Is\nSlop  ' })))
    expect(await fetchYouTubeTitle(VIDEO_ID)).toBe('All Code Is Slop')
  })

  it('cuts titles longer than 300 characters', async () => {
    allow(jsonResponse(JSON.stringify({ title: 'a'.repeat(400) })))
    expect(await fetchYouTubeTitle(VIDEO_ID)).toBe('a'.repeat(300))
  })

  it.each([401, 404])('returns null for a %i response', async (status) => {
    allow(jsonResponse('{"title":"x"}', { status }))
    expect(await fetchYouTubeTitle(VIDEO_ID)).toBeNull()
  })

  it('returns null when fetchAllowedUrl returns null', async () => {
    vi.mocked(fetchAllowedUrl).mockResolvedValue(null)
    expect(await fetchYouTubeTitle(VIDEO_ID)).toBeNull()
  })

  it('returns null when the fetch throws (timeout)', async () => {
    vi.mocked(fetchAllowedUrl).mockRejectedValue(new DOMException('timeout', 'TimeoutError'))
    expect(await fetchYouTubeTitle(VIDEO_ID)).toBeNull()
  })

  it('returns null for a non-JSON content type', async () => {
    allow(jsonResponse('{"title":"x"}', { headers: { 'content-type': 'text/html' } }))
    expect(await fetchYouTubeTitle(VIDEO_ID)).toBeNull()
  })

  it('returns null for invalid JSON', async () => {
    allow(jsonResponse('not json'))
    expect(await fetchYouTubeTitle(VIDEO_ID)).toBeNull()
  })

  it.each([
    ['missing', {}],
    ['empty', { title: '   ' }],
    ['not a string', { title: 5 }],
  ])('returns null for a %s title', async (_name, body) => {
    allow(jsonResponse(JSON.stringify(body)))
    expect(await fetchYouTubeTitle(VIDEO_ID)).toBeNull()
  })

  it('returns null for a body over 64 KB', async () => {
    allow(jsonResponse(JSON.stringify({ title: 'x', pad: 'a'.repeat(65 * 1024) })))
    expect(await fetchYouTubeTitle(VIDEO_ID)).toBeNull()
  })
})
