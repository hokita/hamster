import { checkVideo } from '../src/services/youtubeDataApi'
import {
  watchVideo,
  VIDEO_MODEL,
  VIDEO_TIMEOUT_MS,
  VIDEO_MAX_OUTPUT_TOKENS,
} from '../src/services/videoSummarizer'
import { summarizeShort } from '../src/services/shortSummarizer'

const VIDEO_ID = 'O_zcc6Xl12g'
const MEDIA_RESOLUTION = 'MEDIA_RESOLUTION_LOW'
const END_OFFSET = '3600s'

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

async function main(): Promise<void> {
  if (process.argv.length > 2) fail('This script takes no arguments; the video id is hard-coded.')
  for (const name of ['GEMINI_API_KEY', 'YOUTUBE_API_KEY']) {
    if (!process.env[name]) fail(`${name} is not set`)
  }

  const check = await checkVideo(VIDEO_ID)
  console.log('Data API check')
  console.log('  kind:', check.kind)
  if (check.kind !== 'ok') {
    console.log('  result:', JSON.stringify(check))
    fail('checkVideo did not return ok; not calling watchVideo')
  }
  console.log('  durationSeconds:', check.durationSeconds)
  console.log('  title:', check.title)

  console.log('Request shape')
  console.log('  model:', VIDEO_MODEL)
  console.log('  mediaResolution:', MEDIA_RESOLUTION)
  console.log('  endOffset:', END_OFFSET)
  console.log('  maxOutputTokens:', VIDEO_MAX_OUTPUT_TOKENS)
  console.log('  timeoutMs:', VIDEO_TIMEOUT_MS)

  const result = await watchVideo(VIDEO_ID, check.title ?? '', check.durationSeconds)
  console.log('Result')
  console.log('  latencyMs:', result.latencyMs)
  console.log('  finishReason:', result.finishReason)
  for (const [name, count] of Object.entries(result.usage)) console.log(`  ${name}:`, count)
  console.log('  transcript chars:', result.transcript.length)
  console.log('  transcript first 300 chars:', result.transcript.slice(0, 300))
  console.log('Summary')
  console.log(result.summary)

  const short = await summarizeShort(check.title ?? '', result.summary)
  console.log('Short summary')
  console.log(short)
}

main().catch((err) => {
  console.error('Failed:', err instanceof Error ? err.name : 'unknown error')
  console.error(err instanceof Error ? err.message : 'non-error thrown')
  process.exit(1)
})
