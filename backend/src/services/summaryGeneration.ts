import * as db from './firestore'
import type { BookmarkDoc, VideoSummaryCode } from './firestore'
import { fetchArticleText } from './articleFetcher'
import { parseYouTubeVideoId, isYouTubeSummariesEnabled } from './youtube'
import { checkVideo } from './youtubeDataApi'
import type { VideoCheck } from './youtubeDataApi'
import { watchVideo, VideoUnwatchableError, VideoNoContentError } from './videoSummarizer'
import { summarize, isSummarizerConfigured, SummarizerUnavailableError } from './summarizer'
import { generateLabels } from './labeler'
import { summarizeShort } from './shortSummarizer'

export type Generated = { summary: string; shortSummary?: string; labels: string[] | null }

export interface SummaryGenerator {
  join(id: string): Promise<Generated> | undefined
  isRunningElsewhere(bookmark: BookmarkDoc): boolean
  start(bookmark: BookmarkDoc): Promise<Generated>
}

export type SummaryFailure = {
  httpStatus: number
  body: { error: string; code?: string }
  message: string
}

export class ArticleUnreadableError extends Error {
  constructor() {
    super('Could not read the linked page')
  }
}

export class SummaryStorageError extends Error {
  readonly cause: unknown

  constructor(cause: unknown) {
    super('Failed to save the summary')
    this.cause = cause
  }
}

type VideoRefusalCode = Exclude<VideoSummaryCode, 'generic'>

export class VideoSummaryError extends Error {
  constructor(
    readonly code: VideoRefusalCode,
    readonly httpStatus: 422 | 502
  ) {
    super(`video summary refused: ${code}`)
  }
}

const REFUSALS: Record<
  Exclude<VideoCheck['kind'], 'ok'>,
  { code: VideoRefusalCode; httpStatus: 422 | 502 }
> = {
  too_long: { code: 'video_too_long', httpStatus: 422 },
  unavailable: { code: 'video_unavailable', httpStatus: 422 },
  live: { code: 'video_live', httpStatus: 422 },
  unknown: { code: 'video_length_unknown', httpStatus: 502 },
}

const VIDEO_MESSAGES: Record<VideoRefusalCode, string> = {
  video_too_long: "This video is longer than 60 minutes, so it can't be summarized.",
  video_unavailable: "This video is private, removed or can't be watched.",
  video_live: "Live streams can't be summarized.",
  video_no_content: 'This video has no speech or content to summarize.',
  video_length_unknown: "Couldn't check this video's length. Try again later.",
}

export const RUNNING_ELSEWHERE = {
  httpStatus: 409,
  body: {
    error: 'A summary for this video is already being generated',
    code: 'video_summary_running',
  },
  message:
    'This video is already being summarized. Check back with open_bookmark in a few minutes.',
} as const

function videoFailure(code: VideoRefusalCode, httpStatus: 422 | 502): SummaryFailure {
  return {
    httpStatus,
    body: { error: 'Could not summarize this video', code },
    message: VIDEO_MESSAGES[code],
  }
}

export function describeSummaryFailure(error: unknown): SummaryFailure {
  if (error instanceof VideoSummaryError) return videoFailure(error.code, error.httpStatus)
  if (error instanceof VideoUnwatchableError) return videoFailure('video_unavailable', 502)
  if (error instanceof VideoNoContentError) return videoFailure('video_no_content', 422)
  if (error instanceof SummarizerUnavailableError) {
    return {
      httpStatus: 503,
      body: { error: 'Summarization is not configured' },
      message: "Summaries aren't set up on this server.",
    }
  }
  if (error instanceof SummaryStorageError) {
    return {
      httpStatus: 500,
      body: { error: 'Failed to save the summary' },
      message: "The summary was generated but couldn't be saved. Try again.",
    }
  }
  if (error instanceof ArticleUnreadableError) {
    return {
      httpStatus: 502,
      body: { error: 'Could not read the linked page' },
      message: "Couldn't read the linked page.",
    }
  }
  return {
    httpStatus: 502,
    body: { error: 'Failed to generate a summary' },
    message: "Couldn't generate a summary. Try again later.",
  }
}

const RUNNING_STALE_MS = 660_000

function isFreshRunning(bookmark: BookmarkDoc): boolean {
  const state = bookmark.videoSummaryState
  return state?.status === 'running' && Date.now() - Date.parse(state.updatedAt) < RUNNING_STALE_MS
}

async function writeVideoState(
  id: string,
  state: { status: 'running' } | { status: 'failed'; code: VideoSummaryCode }
): Promise<void> {
  try {
    await db.setVideoSummaryState(id, state)
  } catch (error) {
    console.error(`video summary state write failed for bookmark ${id}:`, error)
  }
}

async function shortSummaryOf(id: string, title: string, summary: string) {
  try {
    return await summarizeShort(title, summary)
  } catch (error) {
    console.error(`short summary generation failed for bookmark ${id}:`, error)
    return undefined
  }
}

async function labelVideo(id: string, title: string, summary: string, transcript: string) {
  try {
    const existingLabels = await db.listAllLabels()
    const labels = await generateLabels(
      title,
      `${summary}\n\n${transcript}`,
      existingLabels,
      'video'
    )
    await db.updateLabels(id, labels)
    return labels
  } catch (error) {
    console.error(`label generation failed for bookmark ${id}:`, error)
    return null
  }
}

async function generateArticleSummary(bookmark: BookmarkDoc): Promise<Generated> {
  if (!isSummarizerConfigured()) throw new SummarizerUnavailableError()

  const text = await fetchArticleText(bookmark.url)
  if (!text) throw new ArticleUnreadableError()

  const summary = await summarize(bookmark.title, text)
  let shortSummary: string | undefined
  try {
    shortSummary = await summarizeShort(bookmark.title, summary)
  } catch (error) {
    console.error(`short summary generation failed for bookmark ${bookmark.id}:`, error)
  }

  try {
    await db.updateSummary(bookmark.id, summary, shortSummary)
  } catch (error) {
    throw new SummaryStorageError(error)
  }

  let labels: string[] | null = null
  try {
    const existingLabels = await db.listAllLabels()
    const generatedLabels = await generateLabels(bookmark.title, text, existingLabels)
    await db.updateLabels(bookmark.id, generatedLabels)
    labels = generatedLabels
  } catch (error) {
    console.error(`label generation failed for bookmark ${bookmark.id}:`, error)
  }

  return { summary, shortSummary, labels }
}

async function generateVideoSummary(bookmark: BookmarkDoc, videoId: string): Promise<Generated> {
  if (!isSummarizerConfigured()) throw new SummarizerUnavailableError()

  const transcript = await db.getTranscript(bookmark.id)
  if (transcript !== null) return summarizeTranscript(bookmark, transcript)

  const check = await checkVideo(videoId)
  if (check.kind !== 'ok') {
    const { code, httpStatus } = REFUSALS[check.kind]
    await writeVideoState(bookmark.id, { status: 'failed', code })
    throw new VideoSummaryError(code, httpStatus)
  }

  await writeVideoState(bookmark.id, { status: 'running' })
  const title = check.title ?? bookmark.title
  let watched
  try {
    watched = await watchVideo(videoId, title, check.durationSeconds)
  } catch (error) {
    const code: VideoSummaryCode =
      error instanceof VideoUnwatchableError
        ? 'video_unavailable'
        : error instanceof VideoNoContentError
          ? 'video_no_content'
          : 'generic'
    await writeVideoState(bookmark.id, { status: 'failed', code })
    throw error
  }
  console.log(`video summary watched for bookmark ${bookmark.id}:`, {
    videoId,
    latencyMs: watched.latencyMs,
    finishReason: watched.finishReason,
    usage: watched.usage,
  })

  const shortSummary = await shortSummaryOf(bookmark.id, title, watched.summary)

  const repairTitle = bookmark.title === bookmark.url && check.title !== null
  try {
    await db.saveVideoSummary(bookmark.id, {
      videoId,
      transcript: watched.transcript,
      summary: watched.summary,
      shortSummary,
      ...(repairTitle ? { title } : {}),
    })
  } catch (error) {
    await writeVideoState(bookmark.id, { status: 'failed', code: 'generic' })
    throw new SummaryStorageError(error)
  }

  const labels = await labelVideo(bookmark.id, title, watched.summary, watched.transcript)
  return { summary: watched.summary, shortSummary, labels }
}

async function summarizeTranscript(bookmark: BookmarkDoc, transcript: string): Promise<Generated> {
  const summary = await summarize(bookmark.title, transcript, 'video')
  const shortSummary = await shortSummaryOf(bookmark.id, bookmark.title, summary)
  try {
    await db.updateSummary(bookmark.id, summary, shortSummary)
  } catch (error) {
    throw new SummaryStorageError(error)
  }
  const labels = await labelVideo(bookmark.id, bookmark.title, summary, transcript)
  return { summary, shortSummary, labels }
}

export function createSummaryGenerator(): SummaryGenerator {
  const inFlight = new Map<string, Promise<Generated>>()

  return {
    join(id) {
      return inFlight.get(id)
    },

    isRunningElsewhere(bookmark) {
      return (
        !inFlight.has(bookmark.id) &&
        isYouTubeSummariesEnabled() &&
        parseYouTubeVideoId(bookmark.url) !== null &&
        isFreshRunning(bookmark)
      )
    },

    start(bookmark) {
      const videoId = isYouTubeSummariesEnabled() ? parseYouTubeVideoId(bookmark.url) : null
      const generation = videoId
        ? generateVideoSummary(bookmark, videoId)
        : generateArticleSummary(bookmark)
      inFlight.set(bookmark.id, generation)

      const cleanup = () => {
        if (inFlight.get(bookmark.id) === generation) inFlight.delete(bookmark.id)
      }
      generation.then(cleanup, cleanup)

      return generation
    },
  }
}
