import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleCheck, faSpinner } from '@fortawesome/free-solid-svg-icons'

interface ReadToggleButtonProps {
  // Identifies the bookmark in this control's accessible name, same convention (and same
  // describeBookmark descriptor) as DeleteBookmarkButton: a list of rows would otherwise offer
  // several buttons called "Mark as read", indistinguishable to a screen reader and in tests.
  label: string
  isRead: boolean
  // Receives the state to move to, not a bare "it was clicked", so the caller stores what the
  // user asked for rather than re-deriving it from state that may have moved on.
  onToggle: (isRead: boolean) => void
  isPending?: boolean
  // 'icon' is the compact glyph for a list row; 'labeled' adds the visible wording for the
  // bookmark's own page, where there is room and no neighbouring row to infer the meaning from.
  variant?: 'icon' | 'labeled'
}

// Unlike deleting, marking read is reversible in one click, so there is nothing to confirm.
export default function ReadToggleButton({
  label,
  isRead,
  onToggle,
  isPending,
  variant = 'icon',
}: ReadToggleButtonProps) {
  // The button always names the action it performs, which is the opposite of the current state.
  const action = isRead ? 'unread' : 'read'

  return (
    // Kept as a button while a request is in flight — disabled, with the icon spinning — rather
    // than swapped for a status element the way the delete control is. Deleting takes its whole
    // row with it, but this row stays, and replacing the focused element would drop keyboard
    // focus to the document mid-interaction. Disabling still rules out a second click landing a
    // write that contradicts the first.
    <button
      type="button"
      onClick={() => onToggle(!isRead)}
      disabled={isPending}
      aria-label={`Mark ${label} as ${action}`}
      // Only where the wording isn't already on screen; a tooltip repeating the visible label is
      // noise.
      title={variant === 'icon' ? `Mark as ${action}` : undefined}
      className={
        variant === 'labeled'
          ? `inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
              isRead
                ? 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
                : 'border-gray-300 text-gray-600 hover:bg-gray-50 hover:text-gray-800'
            }`
          : `flex-shrink-0 p-2 rounded-md disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
              isRead
                ? 'text-amber-700 hover:bg-amber-50'
                : 'text-gray-300 hover:text-gray-600 hover:bg-gray-50'
            }`
      }
    >
      <FontAwesomeIcon
        icon={isPending ? faSpinner : faCircleCheck}
        spin={isPending}
        aria-hidden="true"
      />
      {variant === 'labeled' && `Mark as ${action}`}
    </button>
  )
}
