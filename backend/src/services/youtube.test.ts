import { afterEach, describe, expect, it } from 'vitest'
import {
  canonicalVideoUrl,
  isYouTubeSummariesEnabled,
  MAX_VIDEO_SECONDS,
  parseIsoDuration,
  parseYouTubeVideoId,
} from './youtube'

const ID = 'dQw4w9WgXcQ'

describe('parseYouTubeVideoId', () => {
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `http://youtube.com/watch?v=${ID}&t=42s`,
    `https://m.youtube.com/watch?feature=share&v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}&list=RDxyz`,
    `https://www.youtube.com/watch?v=${ID}&list=PL1&index=3&si=abc&pp=x`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abc&t=42`,
    `https://www.youtube.com/shorts/${ID}?feature=share`,
    `https://www.youtube.com/live/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `https://www.youtube.com/v/${ID}`,
    `https://WWW.YOUTUBE.COM/watch?v=${ID}`,
    `https://youtu.be/${ID}/`,
  ])('accepts %s', (url) => {
    expect(parseYouTubeVideoId(url)).toBe(ID)
  })

  it.each([
    'https://www.youtube.com/',
    'https://www.youtube.com/@aiDotEngineer',
    'https://www.youtube.com/channel/UCx',
    'https://www.youtube.com/c/name',
    'https://www.youtube.com/user/name',
    'https://www.youtube.com/playlist?list=PL1',
    'https://www.youtube.com/results?search_query=x',
    'https://www.youtube.com/feed/subscriptions',
    'https://www.youtube.com/watch?v=short',
    `https://www.youtube.com/watch?v=${ID}%22x`,
    `https://youtube.com.evil.test/watch?v=${ID}`,
    `https://notyoutube.com/watch?v=${ID}`,
    `https://user@www.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com:8443/watch?v=${ID}`,
    `ftp://www.youtube.com/watch?v=${ID}`,
    'not a url',
  ])('rejects %s', (url) => {
    expect(parseYouTubeVideoId(url)).toBeNull()
  })
})

describe('canonicalVideoUrl', () => {
  it('builds the canonical watch URL', () => {
    expect(canonicalVideoUrl('O_zcc6Xl12g')).toBe('https://www.youtube.com/watch?v=O_zcc6Xl12g')
  })
})

describe('parseIsoDuration', () => {
  it.each([
    ['PT17M30S', 1050],
    ['PT1H', 3600],
    ['PT1H0M1S', 3601],
    ['P1DT2H', 93600],
    ['PT45S', 45],
    ['P0D', 0],
  ])('parses %s as %i seconds', (value, seconds) => {
    expect(parseIsoDuration(value)).toBe(seconds)
  })

  it.each(['', '17:30', 'PT'])('returns null for %j', (value) => {
    expect(parseIsoDuration(value)).toBeNull()
  })
})

describe('MAX_VIDEO_SECONDS', () => {
  it('is one hour', () => {
    expect(MAX_VIDEO_SECONDS).toBe(3600)
  })
})

describe('isYouTubeSummariesEnabled', () => {
  const original = process.env.YOUTUBE_SUMMARIES
  afterEach(() => {
    if (original === undefined) delete process.env.YOUTUBE_SUMMARIES
    else process.env.YOUTUBE_SUMMARIES = original
  })

  it('is true only for the exact string "on"', () => {
    process.env.YOUTUBE_SUMMARIES = 'on'
    expect(isYouTubeSummariesEnabled()).toBe(true)
    for (const value of ['true', 'ON']) {
      process.env.YOUTUBE_SUMMARIES = value
      expect(isYouTubeSummariesEnabled()).toBe(false)
    }
    delete process.env.YOUTUBE_SUMMARIES
    expect(isYouTubeSummariesEnabled()).toBe(false)
  })
})
