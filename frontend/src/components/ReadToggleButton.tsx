import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleCheck, faSpinner } from '@fortawesome/free-solid-svg-icons'

interface ReadToggleButtonProps {
  label: string
  isRead: boolean
  onToggle: (isRead: boolean) => void
  isPending?: boolean
  variant?: 'icon' | 'labeled'
}

export default function ReadToggleButton({
  label,
  isRead,
  onToggle,
  isPending,
  variant = 'icon',
}: ReadToggleButtonProps) {
  const action = isRead ? 'unread' : 'read'

  return (
    <button
      type="button"
      onClick={() => onToggle(!isRead)}
      disabled={isPending}
      aria-label={`Mark ${label} as ${action}`}
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
