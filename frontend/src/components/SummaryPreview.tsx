import ReactMarkdown from 'react-markdown'

interface SummaryPreviewProps {
  summary?: string
  id: string
}

export default function SummaryPreview({ summary, id }: SummaryPreviewProps) {
  // Current summaries start with an overview; older ones may be plain text. Skip an
  // optional Markdown heading so the preview describes the article rather than a section.
  const overview = summary
    ?.trim()
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/^\s*#{1,6}\s+.*(?:\n|$)/gm, '').trim())
    .find(Boolean)

  if (!overview) return null

  return (
    <div id={id} className="mt-1 line-clamp-2 text-sm leading-5 text-gray-500 [&_p]:m-0">
      <ReactMarkdown allowedElements={['p', 'strong', 'em', 'code']} unwrapDisallowed skipHtml>
        {overview}
      </ReactMarkdown>
    </div>
  )
}
