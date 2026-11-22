export const VIDEO_SUMMARY_RUNNING_MESSAGE = 'Summarizing the video — this can take a few minutes.'

export const GENERIC_SUMMARY_FAILURE_MESSAGE = "Couldn't generate a summary."

const MESSAGES: Record<string, string> = {
  video_too_long: "This video is longer than 60 minutes, so it wasn't summarized.",
  video_unavailable:
    "Couldn't watch this video. Only public YouTube videos can be summarized — it may be private, " +
    'unlisted, members-only, age-restricted or removed.',
  video_live: 'This is a live or upcoming stream. Try again after it has ended.',
  video_no_content: 'This video has no speech or on-screen text to summarize.',
  video_length_unknown: "Couldn't check this video's length. Try again later.",
  video_summary_running: VIDEO_SUMMARY_RUNNING_MESSAGE,
}

export function videoSummaryMessage(code: string | undefined): string {
  return code !== undefined && Object.prototype.hasOwnProperty.call(MESSAGES, code)
    ? MESSAGES[code]
    : GENERIC_SUMMARY_FAILURE_MESSAGE
}
