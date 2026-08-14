import { useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faTrashCan, faSpinner } from '@fortawesome/free-solid-svg-icons'

interface DeleteBookmarkButtonProps {
  // Identifies the bookmark in this control's accessible names, and nothing else. A list of rows
  // would otherwise offer several buttons called "Delete", indistinguishable to a screen reader
  // and to a test querying by role. Callers pass a descriptor that is unique on the page — a title
  // alone is not, since two bookmarks can share one — so both build it from title and hostname.
  label: string
  onDelete: () => void
  isDeleting?: boolean
  // 'icon' is the compact trash glyph used in a list row; 'labeled' adds the visible word for the
  // bookmark's own page, where there is room and nothing nearby to infer the meaning from.
  variant?: 'icon' | 'labeled'
}

// Deleting is the one irreversible thing this app does — there is no undo and no trash — so it
// asks first. The confirmation is inline rather than window.confirm(): a native dialog blocks the
// page, cannot be styled to match, and (in the list) loses track of which row it belongs to.
export default function DeleteBookmarkButton({
  label,
  onDelete,
  isDeleting,
  variant = 'icon',
}: DeleteBookmarkButtonProps) {
  const [isConfirming, setIsConfirming] = useState(false)

  if (isDeleting) {
    return (
      <span
        role="status"
        aria-label={`Deleting ${label}`}
        className="flex-shrink-0 p-2 text-gray-400"
      >
        <FontAwesomeIcon icon={faSpinner} spin aria-hidden="true" />
      </span>
    )
  }

  if (!isConfirming) {
    return (
      <button
        type="button"
        onClick={() => setIsConfirming(true)}
        aria-label={`Delete ${label}`}
        className={
          variant === 'labeled'
            ? 'inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-red-50 hover:border-red-200 hover:text-red-700 cursor-pointer'
            : 'flex-shrink-0 p-2 text-gray-300 hover:text-red-600 rounded-md hover:bg-red-50 cursor-pointer'
        }
      >
        <FontAwesomeIcon icon={faTrashCan} aria-hidden="true" />
        {variant === 'labeled' && 'Delete'}
      </button>
    )
  }

  return (
    <span className="flex flex-shrink-0 items-center gap-1.5">
      <span aria-hidden="true" className="text-xs text-gray-500">
        Delete?
      </span>
      <button
        type="button"
        // Reset before handing off: the row (or page) usually disappears on success, but when the
        // request fails the control belongs back in its resting state, under the error the caller
        // renders — not still asking a question the user has already answered.
        onClick={() => {
          setIsConfirming(false)
          onDelete()
        }}
        aria-label={`Confirm deleting ${label}`}
        className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 cursor-pointer"
      >
        Delete
      </button>
      <button
        type="button"
        onClick={() => setIsConfirming(false)}
        aria-label={`Cancel deleting ${label}`}
        className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 cursor-pointer"
      >
        Cancel
      </button>
    </span>
  )
}
