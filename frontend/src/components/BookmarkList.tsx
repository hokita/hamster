import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faLink, faArrowUpRightFromSquare } from '@fortawesome/free-solid-svg-icons'
import type { Bookmark } from '../api'
import { formatRelativeTime } from '../relativeTime'
import { describeBookmark } from '../bookmarkLabel'
import DeleteBookmarkButton from './DeleteBookmarkButton'
import ReadToggleButton from './ReadToggleButton'

interface BookmarkListProps {
  bookmarks: Bookmark[]
  summarizingIds?: ReadonlySet<string>
  // Optional so a list can be rendered read-only; rows show no delete control without it.
  onDelete?: (id: string) => void
  deletingIds?: ReadonlySet<string>
  // Optional for the same reason; without it rows still show read state, just no way to change it.
  onToggleRead?: (id: string, isRead: boolean) => void
  readPendingIds?: ReadonlySet<string>
  // Replaces the "no bookmarks yet" copy when the list is empty because of a filter rather than
  // because nothing has been saved — "paste a URL above" is wrong advice in that case.
  emptyMessage?: string
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
// shared module, and this check is small enough not to warrant one. This mirrors the backend's
// range lists in full (nothing deliberately excluded): a narrower frontend copy is exactly what
// let an IPv4-mapped IPv6 literal (e.g. "::ffff:127.0.0.1") slip past this guard once before, and
// ranges like the documentation/benchmarking blocks cost nothing to include — worst case a
// bookmark on one of those addresses just shows the generic glyph instead of a real favicon,
// same as any other blocked host.
const IPV4_PRIVATE_RANGES: [string, number][] = [
  ['0.0.0.0', 8], // "This host on this network"
  ['10.0.0.0', 8], // Private-use
  ['100.64.0.0', 10], // Shared Address Space (carrier-grade NAT)
  ['127.0.0.0', 8], // Loopback
  ['169.254.0.0', 16], // Link-local
  ['172.16.0.0', 12], // Private-use
  ['192.0.0.0', 24], // IETF Protocol Assignments
  ['192.0.2.0', 24], // Documentation (TEST-NET-1)
  ['192.88.99.0', 24], // 6to4 Relay Anycast
  ['192.168.0.0', 16], // Private-use
  ['198.18.0.0', 15], // Benchmarking
  ['198.51.100.0', 24], // Documentation (TEST-NET-2)
  ['203.0.113.0', 24], // Documentation (TEST-NET-3)
  ['240.0.0.0', 4], // Reserved for future use
  ['255.255.255.255', 32], // Limited broadcast
]

const IPV6_PRIVATE_RANGES: [string, number][] = [
  ['::1', 128], // Loopback
  ['::', 128], // Unspecified
  ['64:ff9b::', 96], // NAT64
  ['64:ff9b:1::', 48], // NAT64 (local use)
  ['100::', 64], // Discard-only
  ['2001::', 23], // IETF Protocol Assignments (includes Teredo)
  ['2001:db8::', 32], // Documentation
  ['2002::', 16], // 6to4
  ['fc00::', 7], // Unique local
  ['fe80::', 10], // Link-local
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

function hexGroupsToIpv4(high: string, low: string): string {
  const h = parseInt(high, 16)
  const l = parseInt(low, 16)
  return [h >> 8, h & 0xff, l >> 8, l & 0xff].join('.')
}

function ipv6ToBigInt(ip: string): bigint {
  const [head, tail] = ip.includes('::') ? ip.split('::') : [ip, '']
  const headParts = head ? head.split(':') : []
  const tailParts = tail ? tail.split(':') : []
  const missing = 8 - headParts.length - tailParts.length
  const groups = [...headParts, ...Array(missing).fill('0'), ...tailParts]
  return groups.reduce((acc, group) => (acc << 16n) | BigInt(parseInt(group || '0', 16)), 0n)
}

// host here is the bracket-stripped IPv6 literal, e.g. "::1" or "fe80::1".
function isPrivateIpv6(host: string): boolean {
  const normalized = host.toLowerCase()

  // IPv4-mapped ("::ffff:a.b.c.d") and the deprecated IPv4-compatible ("::a.b.c.d") forms embed
  // a full IPv4 address in the low 32 bits. WHATWG URL normalization can serialize either as
  // dotted-decimal or as compressed hex pairs (e.g. "::ffff:127.0.0.1" vs "::ffff:7f00:1"), and
  // the "ffff:" marker is optional here so the deprecated compatible form ("::127.0.0.1" /
  // "::7f00:1") is caught the same way. Delegate to the IPv4 check so these get exactly the same
  // treatment as a bare IPv4-literal bookmark.
  const dotted = normalized.match(/^::(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (dotted && isIpv4Literal(dotted[1])) return isPrivateIpv4(dotted[1])

  const hex = normalized.match(/^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (hex) return isPrivateIpv4(hexGroupsToIpv4(hex[1], hex[2]))

  const ipInt = ipv6ToBigInt(normalized)
  return IPV6_PRIVATE_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0n : (~0n << BigInt(128 - bits)) & ((1n << 128n) - 1n)
    return (ipInt & mask) === (ipv6ToBigInt(base) & mask)
  })
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

export default function BookmarkList({
  bookmarks,
  summarizingIds,
  onDelete,
  deletingIds,
  onToggleRead,
  readPendingIds,
  emptyMessage,
}: BookmarkListProps) {
  const items = Array.isArray(bookmarks) ? bookmarks : []
  const [failedIcons, setFailedIcons] = useState<ReadonlySet<string>>(new Set())

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-gray-500">
        <FontAwesomeIcon icon={faLink} size="lg" aria-hidden="true" />
        <p className="m-0 text-sm">
          {emptyMessage ?? 'No bookmarks yet — paste a URL above to add one.'}
        </p>
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
            <div className="flex items-center">
              <Link
                to={`/bookmarks/${bookmark.id}`}
                aria-labelledby={`bookmark-title-${bookmark.id} bookmark-meta-${bookmark.id}`}
                className="flex flex-1 min-w-0 items-center gap-3 py-2.5 px-1 rounded-md hover:bg-gray-50"
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
                      onError={() =>
                        setFailedIcons((previous) => new Set(previous).add(bookmark.id))
                      }
                    />
                  ) : (
                    <FontAwesomeIcon icon={faLink} size="xs" aria-hidden="true" />
                  )}
                </span>
                <span className="flex-1 min-w-0">
                  <span
                    // A read bookmark recedes: normal weight and a lighter grey, so a glance down
                    // the list picks out what is still waiting to be read. Nothing is hidden —
                    // the row stays fully legible and clickable.
                    className={`block truncate ${
                      bookmark.isRead ? 'font-normal text-gray-500' : 'font-medium text-gray-900'
                    }`}
                    id={`bookmark-title-${bookmark.id}`}
                  >
                    {bookmark.title}
                  </span>
                  <span className="block text-xs text-gray-500" id={`bookmark-meta-${bookmark.id}`}>
                    {hostname ? `${hostname} · ` : ''}
                    <span>
                      {summarizingIds?.has(bookmark.id)
                        ? 'Summarizing…'
                        : formatRelativeTime(bookmark.createdAt)}
                    </span>
                    {/* Spelled out in the meta line rather than left to the dimmed title alone:
                        colour and weight say nothing to a screen reader, and this line is part of
                        the row link's accessible name (see aria-labelledby above). */}
                    {bookmark.isRead && <span> · Read</span>}
                  </span>
                  {bookmark.labels && bookmark.labels.length > 0 && (
                    <span data-testid="bookmark-labels" className="mt-1 flex flex-wrap gap-1">
                      {bookmark.labels.map((label) => (
                        <span
                          key={label}
                          className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] leading-4 text-gray-500"
                        >
                          {label}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              </Link>
              {onToggleRead && (
                <ReadToggleButton
                  // Same descriptor the delete control uses, so "which bookmark is this button
                  // for" is answered the same way for every control in the row.
                  label={describeBookmark(bookmark)}
                  isRead={bookmark.isRead}
                  isPending={readPendingIds?.has(bookmark.id)}
                  onToggle={(isRead) => onToggleRead(bookmark.id, isRead)}
                />
              )}
              {/* Sibling of the Link, never nested inside it: nested anchors are invalid HTML.
                  Its accessible name uses the hostname rather than the title so it stays
                  distinguishable from the row link in queries and for screen readers. */}
              <a
                href={bookmark.url}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open ${hostname ?? bookmark.url} in a new tab`}
                className="flex-shrink-0 p-2 text-gray-300 hover:text-gray-600 rounded-md hover:bg-gray-50"
              >
                <FontAwesomeIcon icon={faArrowUpRightFromSquare} aria-hidden="true" />
              </a>
              {onDelete && (
                <DeleteBookmarkButton
                  // Of every control in this row, the delete button is the one where acting on
                  // the wrong bookmark cannot be undone — so its name says which bookmark it is
                  // for in as much detail as a reader can use. See describeBookmark.
                  label={describeBookmark(bookmark)}
                  isDeleting={deletingIds?.has(bookmark.id)}
                  onDelete={() => onDelete(bookmark.id)}
                />
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
