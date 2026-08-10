export function formatRelativeTime(createdAt: string, now: Date = new Date()): string {
  const created = new Date(createdAt)
  const diffSec = Math.floor((now.getTime() - created.getTime()) / 1000)

  if (diffSec < 60) return 'just now'

  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`

  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}h ago`

  const diffDay = Math.floor(diffHour / 24)
  if (diffDay < 7) return `${diffDay}d ago`

  const sameYear = created.getFullYear() === now.getFullYear()
  const options: Intl.DateTimeFormatOptions = sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' }
  return new Intl.DateTimeFormat('en-US', options).format(created)
}
