import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./firestore', () => ({
  listBookmarks: vi.fn(),
  createBookmark: vi.fn(),
  getBookmark: vi.fn(),
  updateSummary: vi.fn(),
  updateLabels: vi.fn(),
  listAllLabels: vi.fn(),
  deleteBookmark: vi.fn(),
  setReadState: vi.fn(),
  getTranscript: vi.fn(),
  saveVideoSummary: vi.fn(),
  setVideoSummaryState: vi.fn(),
}))
vi.mock('./youtubeDataApi', () => ({
  checkVideo: vi.fn(),
}))
vi.mock('./videoSummarizer', async () => {
  const actual = await vi.importActual<typeof import('./videoSummarizer')>('./videoSummarizer')
  return {
    watchVideo: vi.fn(),
    VideoUnwatchableError: actual.VideoUnwatchableError,
    VideoNoContentError: actual.VideoNoContentError,
  }
})
vi.mock('./metadataFetcher', () => ({
  fetchMetadata: vi.fn(),
}))
vi.mock('./youtubeOembed', async () => {
  const actual = await vi.importActual<typeof import('./youtubeOembed')>('./youtubeOembed')
  return {
    fetchYouTubeTitle: vi.fn(),
    YOUTUBE_FAVICON_URL: actual.YOUTUBE_FAVICON_URL,
  }
})
vi.mock('./articleFetcher', () => ({
  fetchArticleText: vi.fn(),
}))
vi.mock('./summarizer', async () => {
  const actual = await vi.importActual<typeof import('./summarizer')>('./summarizer')
  return {
    summarize: vi.fn(),
    isSummarizerConfigured: vi.fn(),
    SummarizerUnavailableError: actual.SummarizerUnavailableError,
    // videoSummarizer's real module (imported below for its error classes) reads this at load.
    SUMMARY_FORMAT_RULES: actual.SUMMARY_FORMAT_RULES,
  }
})
vi.mock('./shortSummarizer', () => ({
  summarizeShort: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('./labeler', () => ({
  generateLabels: vi.fn(),
}))
vi.mock('./translator', async () => {
  const actual = await vi.importActual<typeof import('./translator')>('./translator')
  return {
    translate: vi.fn(),
    isTranslatorConfigured: vi.fn(),
    TranslatorUnavailableError: actual.TranslatorUnavailableError,
  }
})
vi.mock('./articleChat', async () => {
  const actual = await vi.importActual<typeof import('./articleChat')>('./articleChat')
  return {
    answerQuestion: vi.fn(),
    isChatConfigured: vi.fn(),
    ChatUnavailableError: actual.ChatUnavailableError,
  }
})

import {
  createSummaryGenerator,
  describeSummaryFailure,
  RUNNING_ELSEWHERE,
  VideoSummaryError,
  SummaryStorageError,
  ArticleUnreadableError,
} from './summaryGeneration'
import * as db from './firestore'
import { fetchArticleText } from './articleFetcher'
import { summarize, isSummarizerConfigured, SummarizerUnavailableError } from './summarizer'
import { generateLabels } from './labeler'
import { VideoUnwatchableError, VideoNoContentError } from './videoSummarizer'
import type { BookmarkDoc } from './firestore'

const article: BookmarkDoc = {
  id: 'a1',
  url: 'https://example.com/post',
  title: 'Post',
  createdAt: '2024-01-01T00:00:00.000Z',
}

const video: BookmarkDoc = {
  id: 'v1',
  url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  title: 'Talk',
  createdAt: '2024-01-01T00:00:00.000Z',
}

const runningSince = (msAgo: number): BookmarkDoc => ({
  ...video,
  videoSummaryState: {
    status: 'running',
    updatedAt: new Date(Date.now() - msAgo).toISOString(),
  },
})

const originalFlag = process.env.YOUTUBE_SUMMARIES

beforeEach(() => {
  vi.clearAllMocks()
  process.env.YOUTUBE_SUMMARIES = 'on'
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  if (originalFlag === undefined) delete process.env.YOUTUBE_SUMMARIES
  else process.env.YOUTUBE_SUMMARIES = originalFlag
})

describe('createSummaryGenerator', () => {
  it('two start/join calls for one id share one generation', async () => {
    vi.mocked(isSummarizerConfigured).mockReturnValue(true)
    vi.mocked(fetchArticleText).mockResolvedValue('Article body')
    vi.mocked(summarize).mockResolvedValue('Summary.')
    vi.mocked(db.listAllLabels).mockResolvedValue([])
    vi.mocked(generateLabels).mockResolvedValue(['tech'])
    const summaries = createSummaryGenerator()

    const started = summaries.start(article)
    expect(summaries.join(article.id)).toBe(started)

    await expect(started).resolves.toEqual({
      summary: 'Summary.',
      shortSummary: undefined,
      labels: ['tech'],
    })
    expect(summarize).toHaveBeenCalledTimes(1)
    expect(summaries.join(article.id)).toBeUndefined()
  })

  it('a run that settles after a newer run for the same id does not remove the newer entry', async () => {
    vi.mocked(isSummarizerConfigured).mockReturnValue(true)
    vi.mocked(db.listAllLabels).mockResolvedValue([])
    vi.mocked(generateLabels).mockResolvedValue(['tech'])
    let finishFirst!: (text: string) => void
    vi.mocked(fetchArticleText)
      .mockReturnValueOnce(new Promise((resolve) => (finishFirst = resolve)))
      .mockReturnValueOnce(new Promise(() => {}))
    vi.mocked(summarize).mockResolvedValue('Summary.')
    const summaries = createSummaryGenerator()

    const first = summaries.start(article)
    const second = summaries.start(article)
    finishFirst('Article body')
    await first

    expect(summaries.join(article.id)).toBe(second)
  })

  it('isRunningElsewhere is true only for a video with a fresh running state and nothing in flight', async () => {
    const summaries = createSummaryGenerator()

    expect(summaries.isRunningElsewhere(article)).toBe(false)
    expect(summaries.isRunningElsewhere(runningSince(10 * 60_000))).toBe(true)
    expect(summaries.isRunningElsewhere(runningSince(12 * 60_000))).toBe(false)

    vi.mocked(isSummarizerConfigured).mockReturnValue(true)
    vi.mocked(db.getTranscript).mockReturnValue(new Promise(() => {}))
    void summaries.start(video)
    expect(summaries.isRunningElsewhere(runningSince(10 * 60_000))).toBe(false)
  })
})

describe('describeSummaryFailure', () => {
  it('maps every failure to the route body and the Muse message', () => {
    expect(describeSummaryFailure(new VideoSummaryError('video_too_long', 422))).toEqual({
      httpStatus: 422,
      body: { error: 'Could not summarize this video', code: 'video_too_long' },
      message: "This video is longer than 60 minutes, so it can't be summarized.",
    })
    expect(describeSummaryFailure(new VideoSummaryError('video_unavailable', 422))).toEqual({
      httpStatus: 422,
      body: { error: 'Could not summarize this video', code: 'video_unavailable' },
      message: "This video is private, removed or can't be watched.",
    })
    expect(describeSummaryFailure(new VideoUnwatchableError())).toEqual({
      httpStatus: 502,
      body: { error: 'Could not summarize this video', code: 'video_unavailable' },
      message: "This video is private, removed or can't be watched.",
    })
    expect(describeSummaryFailure(new VideoSummaryError('video_live', 422))).toEqual({
      httpStatus: 422,
      body: { error: 'Could not summarize this video', code: 'video_live' },
      message: "Live streams can't be summarized.",
    })
    expect(describeSummaryFailure(new VideoNoContentError())).toEqual({
      httpStatus: 422,
      body: { error: 'Could not summarize this video', code: 'video_no_content' },
      message: 'This video has no speech or content to summarize.',
    })
    expect(describeSummaryFailure(new VideoSummaryError('video_length_unknown', 502))).toEqual({
      httpStatus: 502,
      body: { error: 'Could not summarize this video', code: 'video_length_unknown' },
      message: "Couldn't check this video's length. Try again later.",
    })
    expect(RUNNING_ELSEWHERE).toEqual({
      httpStatus: 409,
      body: {
        error: 'A summary for this video is already being generated',
        code: 'video_summary_running',
      },
      message:
        'This video is already being summarized. Check back with open_bookmark in a few minutes.',
    })
    expect(describeSummaryFailure(new SummarizerUnavailableError())).toEqual({
      httpStatus: 503,
      body: { error: 'Summarization is not configured' },
      message: "Summaries aren't set up on this server.",
    })
    expect(describeSummaryFailure(new SummaryStorageError(new Error('denied')))).toEqual({
      httpStatus: 500,
      body: { error: 'Failed to save the summary' },
      message: "The summary was generated but couldn't be saved. Try again.",
    })
    expect(describeSummaryFailure(new ArticleUnreadableError())).toEqual({
      httpStatus: 502,
      body: { error: 'Could not read the linked page' },
      message: "Couldn't read the linked page.",
    })
    expect(describeSummaryFailure(new Error('gemini 500'))).toEqual({
      httpStatus: 502,
      body: { error: 'Failed to generate a summary' },
      message: "Couldn't generate a summary. Try again later.",
    })
  })
})
