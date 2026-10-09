import ReactMarkdown from 'react-markdown'
import { textLanguage } from '../textLanguage'

interface SummaryPreviewProps {
  summary?: string
  isSummarizing?: boolean
}

export default function SummaryPreview({ summary, isSummarizing }: SummaryPreviewProps) {
  // Stop at the first paragraph, heading or list boundary. Legacy summaries do not always
  // leave a blank line before their bullets, including Japanese "・" bullets.
  const overview = summary
    ?.trim()
    .split(/\r?\n(?:[ \t]*\r?\n|[ \t]*(?:#{1,6}[ \t]+|[-+*][ \t]+|・[ \t]*|\d+[.)][ \t]+))/)[0]

  if (!overview) {
    return (
      <span className="mt-1 block text-sm text-gray-400">
        {isSummarizing ? 'Your summary will appear here.' : 'Open article to generate a summary.'}
      </span>
    )
  }

  return (
    <span
      lang={textLanguage(overview)}
      className="mt-1 block line-clamp-2 text-sm leading-5 text-gray-600"
    >
      <ReactMarkdown
        // The preview sits inside the row link. Unwrap Markdown links to avoid nested anchors,
        // and discard images and raw HTML so article content cannot initiate network requests.
        allowedElements={['p', 'strong', 'em', 'del', 'br']}
        unwrapDisallowed
        skipHtml
        components={{ p: ({ children }) => <span>{children}</span> }}
      >
        {overview}
      </ReactMarkdown>
    </span>
  )
}
