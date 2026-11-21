import * as db from './firestore'
import type { BookmarkDoc } from './firestore'
import { fetchMetadata } from './metadataFetcher'
import { parseYouTubeVideoId } from './youtube'
import { fetchYouTubeTitle, YOUTUBE_FAVICON_URL } from './youtubeOembed'

export async function saveBookmark(url: string): Promise<BookmarkDoc> {
  // Independent of YOUTUBE_SUMMARIES: the oEmbed title is wanted whether or not videos are
  // summarized. A failed oEmbed falls through to the ordinary metadata fetch.
  const videoId = parseYouTubeVideoId(url)
  const videoTitle = videoId ? await fetchYouTubeTitle(videoId) : null
  const { title, faviconUrl } = videoTitle
    ? { title: videoTitle, faviconUrl: YOUTUBE_FAVICON_URL }
    : await fetchMetadata(url)
  return db.createBookmark(url, title ?? url, faviconUrl)
}
