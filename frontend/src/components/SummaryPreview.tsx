import { textLanguage } from '../textLanguage'

interface SummaryPreviewProps {
  shortSummary?: string
  isSummarizing?: boolean
}

export default function SummaryPreview({ shortSummary, isSummarizing }: SummaryPreviewProps) {
  const text = shortSummary?.trim()
  if (!text) {
    return (
      <span className="mt-1 block text-sm text-gray-400">
        {isSummarizing
          ? 'Your summary will appear here.'
          : 'Open article to generate a short summary.'}
      </span>
    )
  }

  return (
    <span lang={textLanguage(text)} className="mt-1 block truncate text-sm leading-5 text-gray-600">
      {text}
    </span>
  )
}
