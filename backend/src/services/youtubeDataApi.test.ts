import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./safeFetch', () => ({
  fetchAllowedUrl: vi.fn(),
}))

import { fetchAllowedUrl } from './safeFetch'
import { checkVideo } from './youtubeDataApi'

const VIDEO_ID = 'O_zcc6Xl12g'
const KEY = 'test-secret-key-123'

interface ItemOptions {
  duration?: string | null
  privacyStatus?: string
  liveBroadcastContent?: string
  title?: string
}

function item({
  duration = 'PT10M',
  privacyStatus = 'public',
  liveBroadcastContent = 'none',
  title = 'A video',
}: ItemOptions = {}) {
  return {
    contentDetails: duration === null ? {} : { duration },
    status: { privacyStatus },
    snippet: { title, liveBroadcastContent },
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return new Response(text, { status: 200, ...init })
}

function allow(response: Response) {
  vi.mocked(fetchAllowedUrl).mockResolvedValue({
    response,
    finalUrl: 'https://www.googleapis.com/',
  })
}

describe('checkVideo', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('YOUTUBE_API_KEY', KEY)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('sends the key as a header, never in the url, with a 5s timeout', async () => {
    const signal = new AbortController().signal
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(signal)
    allow(jsonResponse({ items: [item()] }))

    await checkVideo(VIDEO_ID)

    expect(timeout).toHaveBeenCalledWith(5000)
    expect(fetchAllowedUrl).toHaveBeenCalledWith(
      `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,status,snippet&id=${VIDEO_ID}`,
      signal,
      { 'X-Goog-Api-Key': KEY }
    )
    expect(vi.mocked(fetchAllowedUrl).mock.calls[0][0]).not.toContain(KEY)
  })

  it('url-encodes the video id', async () => {
    allow(jsonResponse({ items: [item()] }))
    await checkVideo('a/b&c')
    expect(vi.mocked(fetchAllowedUrl).mock.calls[0][0]).toContain('&id=a%2Fb%26c')
  })

  it('is unknown without fetching when the key is unset', async () => {
    vi.stubEnv('YOUTUBE_API_KEY', '')
    expect(await checkVideo(VIDEO_ID)).toEqual({ kind: 'unknown' })
    expect(fetchAllowedUrl).not.toHaveBeenCalled()
  })

  it('is unknown on a non-200 response', async () => {
    allow(jsonResponse({ error: 'quota' }, { status: 403 }))
    expect(await checkVideo(VIDEO_ID)).toEqual({ kind: 'unknown' })
  })

  it('is unknown when fetchAllowedUrl returns null', async () => {
    vi.mocked(fetchAllowedUrl).mockResolvedValue(null)
    expect(await checkVideo(VIDEO_ID)).toEqual({ kind: 'unknown' })
  })

  it('is unknown when fetchAllowedUrl throws', async () => {
    vi.mocked(fetchAllowedUrl).mockRejectedValue(new Error('boom'))
    expect(await checkVideo(VIDEO_ID)).toEqual({ kind: 'unknown' })
  })

  it('is unknown on a bad JSON body', async () => {
    allow(jsonResponse('not json {'))
    expect(await checkVideo(VIDEO_ID)).toEqual({ kind: 'unknown' })
  })

  it('is unknown when the body exceeds the size cap', async () => {
    allow(jsonResponse(' '.repeat(256 * 1024 + 1)))
    expect(await checkVideo(VIDEO_ID)).toEqual({ kind: 'unknown' })
  })

  it('is unavailable when no item is returned', async () => {
    allow(jsonResponse({ items: [] }))
    expect(await checkVideo(VIDEO_ID)).toEqual({ kind: 'unavailable' })
  })

  it.each(['private', 'unlisted'])('is unavailable when privacyStatus is %s', async (p) => {
    allow(jsonResponse({ items: [item({ privacyStatus: p })] }))
    expect(await checkVideo(VIDEO_ID)).toEqual({ kind: 'unavailable' })
  })

  it.each(['live', 'upcoming'])('is live when liveBroadcastContent is %s', async (l) => {
    allow(jsonResponse({ items: [item({ liveBroadcastContent: l })] }))
    expect(await checkVideo(VIDEO_ID)).toEqual({ kind: 'live' })
  })

  it('is ok at exactly one hour, with the trimmed snippet title', async () => {
    allow(jsonResponse({ items: [item({ duration: 'PT1H', title: '  My talk  ' })] }))
    expect(await checkVideo(VIDEO_ID)).toEqual({
      kind: 'ok',
      durationSeconds: 3600,
      title: 'My talk',
    })
  })

  it('has a null title when the snippet title is missing or empty', async () => {
    allow(jsonResponse({ items: [item({ title: '   ' })] }))
    expect(await checkVideo(VIDEO_ID)).toMatchObject({ kind: 'ok', title: null })
    allow(
      jsonResponse({ items: [{ contentDetails: { duration: 'PT5M' }, status: {}, snippet: {} }] })
    )
    expect(await checkVideo(VIDEO_ID)).toMatchObject({ kind: 'ok', title: null })
  })

  it('is too_long one second over an hour', async () => {
    allow(jsonResponse({ items: [item({ duration: 'PT1H0M1S' })] }))
    expect(await checkVideo(VIDEO_ID)).toEqual({ kind: 'too_long', durationSeconds: 3601 })
  })

  it.each(['P0D', null])('is unknown for a zero or missing duration (%s)', async (d) => {
    allow(jsonResponse({ items: [item({ duration: d })] }))
    expect(await checkVideo(VIDEO_ID)).toEqual({ kind: 'unknown' })
  })

  it('never logs the key when fetchAllowedUrl throws an error containing it', async () => {
    const spy = vi.mocked(console.error)
    vi.mocked(fetchAllowedUrl).mockRejectedValue(new Error(`failed for key=${KEY}`))

    await checkVideo(VIDEO_ID)

    for (const call of spy.mock.calls) {
      for (const arg of call) expect(String(arg)).not.toContain(KEY)
    }
  })
})
