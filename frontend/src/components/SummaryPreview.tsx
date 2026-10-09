import ReactMarkdown from 'react-markdown'

interface SummaryPreviewProps {
  summary?: string
  isSummarizing?: boolean
}

export default function SummaryPreview({ summary, isSummarizing }: SummaryPreviewProps) {
  // Generated summaries start with an overview. Keep the preview to that paragraph so the
  // article's key points and takeaway remain on its detail page.
  const overview = summary?.trim().split(/\n\s*\n/)[0]

  if (!overview) {
    return (
      <span className="mt-1 block text-sm text-gray-400">
        {isSummarizing ? 'Your summary will appear here.' : 'Open article to generate a summary.'}
      </span>
    )
  }

  return (
    <span className="mt-1 block line-clamp-2 text-sm leading-5 text-gray-600">
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
