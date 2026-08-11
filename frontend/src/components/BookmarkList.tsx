import { useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faLink, faArrowUpRightFromSquare } from '@fortawesome/free-solid-svg-icons'
import type { Bookmark } from '../api'
import { formatRelativeTime } from '../relativeTime'

interface BookmarkListProps {
  bookmarks: Bookmark[]
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

// Mirrors the private/loopback/link-local IP-literal check in backend/src/services/ipGuard.ts.
// Duplicated here (not imported) because frontend and backend are separate packages with no
// shared module, and this check is small enough not to warrant one. Kept intentionally narrower
// than the backend's: only the ranges called out for this guard, not the full SSRF range list
// (e.g. documentation/benchmarking ranges are irrelevant to "don't auto-load an image").
const IPV4_PRIVATE_RANGES: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
]

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0
}

function isIpv4Literal(host: string): boolean {
  const parts = host.split('.')
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function isPrivateIpv4(host: string): boolean {
  const ipInt = ipv4ToInt(host)
  return IPV4_PRIVATE_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
    return (ipInt & mask) === (ipv4ToInt(base) & mask)
  })
}

// host here is the bracket-stripped IPv6 literal, e.g. "::1" or "fe80::1".
function isPrivateIpv6(host: string): boolean {
  const normalized = host.toLowerCase()
  if (normalized === '::1' || normalized === '::') return true
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true // fc00::/7 unique local
  if (normalized.startsWith('fe')) {
    const third = normalized[2]
    if (third === '8' || third === '9' || third === 'a' || third === 'b') return true // fe80::/10 link-local
  }
  return false
}

// Host-literal only: a hostname that merely *resolves* to a private IP (e.g. a LAN mDNS name
// like "router.local") can't be caught here — the frontend has no DNS resolution available.
// That residual gap is accepted; the backend's ipGuard still protects the metadata fetch itself.
function isPrivateOrLocalHost(hostname: string): boolean {
  if (hostname === 'localhost') return true

  const literal =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname

  if (isIpv4Literal(literal)) return isPrivateIpv4(literal)
  if (literal.includes(':')) return isPrivateIpv6(literal)

  return false
}

function originFaviconOf(url: string): string | null {
  try {
    const parsed = new URL(url)
    // Only derive a fallback favicon when the backend never got a chance to guard this host
    // (no stored faviconUrl). If the bookmark's own hostname is a private/loopback/link-local
    // literal, deriving one here would make the browser contact it automatically on every list
    // render, bypassing the backend's ipGuard for URLs it never even saw.
    if (isPrivateOrLocalHost(parsed.hostname)) return null
    return new URL('/favicon.ico', url).toString()
  } catch {
    return null
  }
}

export default function BookmarkList({ bookmarks }: BookmarkListProps) {
  const items = Array.isArray(bookmarks) ? bookmarks : []
  const [failedIcons, setFailedIcons] = useState<ReadonlySet<string>>(new Set())

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-gray-500">
        <FontAwesomeIcon icon={faLink} size="lg" aria-hidden="true" />
        <p className="m-0 text-sm">No bookmarks yet — paste a URL above to add one.</p>
      </div>
    )
  }

  return (
    <ul className="flex flex-col p-4">
      {items.map((bookmark) => {
        const hostname = hostnameOf(bookmark.url)
        const iconSrc = failedIcons.has(bookmark.id)
          ? null
          : (bookmark.faviconUrl ?? originFaviconOf(bookmark.url))
        return (
          <li key={bookmark.id} className="group border-b border-gray-100 last:border-b-0">
            <a
              href={bookmark.url}
              target="_blank"
              rel="noreferrer"
              aria-labelledby={`bookmark-title-${bookmark.id} bookmark-meta-${bookmark.id}`}
              className="flex items-center gap-3 py-2.5 px-1 rounded-md hover:bg-gray-50"
            >
              <span className="flex items-center justify-center w-7 h-7 rounded-md bg-gray-100 text-gray-400 flex-shrink-0 overflow-hidden">
                {iconSrc ? (
                  <img
                    src={iconSrc}
                    alt=""
                    aria-hidden="true"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="w-4 h-4 object-contain"
                    onError={() => setFailedIcons((previous) => new Set(previous).add(bookmark.id))}
                  />
                ) : (
                  <FontAwesomeIcon icon={faLink} size="xs" aria-hidden="true" />
                )}
              </span>
              <span className="flex-1 min-w-0">
                <span
                  className="block font-medium text-gray-900 truncate"
                  id={`bookmark-title-${bookmark.id}`}
                >
                  {bookmark.title}
                </span>
                <span className="block text-xs text-gray-500" id={`bookmark-meta-${bookmark.id}`}>
                  {hostname ? `${hostname} · ` : ''}
                  {formatRelativeTime(bookmark.createdAt)}
                </span>
              </span>
              <FontAwesomeIcon
                icon={faArrowUpRightFromSquare}
                aria-hidden="true"
                className="text-gray-300 opacity-0 group-hover:opacity-100 flex-shrink-0"
              />
            </a>
          </li>
        )
      })}
    </ul>
  )
}
