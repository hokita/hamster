import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { isDisallowedIp } from './ipGuard'

const MAX_REDIRECTS = 3

export function withSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

export async function isDisallowedHost(hostname: string, signal: AbortSignal): Promise<boolean> {
  // URL.hostname brackets IPv6 literals (e.g. "[::1]"); dns.lookup() rejects that form,
  // so literal IPs are checked directly instead of going through DNS at all.
  const literal =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  const literalFamily = isIP(literal)
  if (literalFamily) return isDisallowedIp(literal, literalFamily)

  try {
    const { address, family } = await withSignal(lookup(hostname), signal)
    return isDisallowedIp(address, family)
  } catch {
    return true
  }
}

export interface AllowedResponse {
  response: Response
  finalUrl: string
}

// Follows redirects manually so every hop's host goes through the SSRF guard — `redirect: 'follow'`
// would let the runtime chase a redirect into a private address behind our back. Returns null for
// any outcome that means "there is nothing safe to read here": a non-http(s) protocol, a disallowed
// host, an exhausted redirect budget, or a redirect with no destination.
export async function fetchAllowedUrl(
  url: string,
  signal: AbortSignal
): Promise<AllowedResponse | null> {
  let currentUrl = url

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = new URL(currentUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    if (await isDisallowedHost(parsed.hostname, signal)) return null

    const response = await fetch(currentUrl, { redirect: 'manual', signal })

    if (response.status >= 300 && response.status < 400) {
      if (hop === MAX_REDIRECTS) return null
      const location = response.headers.get('location')
      if (!location) return null
      currentUrl = new URL(location, currentUrl).toString()
      continue
    }

    return { response, finalUrl: currentUrl }
  }

  return null
}
