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

export async function fetchAllowedUrl(
  url: string,
  signal: AbortSignal,
  headers?: Record<string, string>
): Promise<AllowedResponse | null> {
  let currentUrl = url
  const originalOrigin = new URL(url).origin

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = new URL(currentUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    if (await isDisallowedHost(parsed.hostname, signal)) return null

    const sendHeaders = headers && parsed.origin === originalOrigin
    const response = await fetch(currentUrl, {
      redirect: 'manual',
      signal,
      ...(sendHeaders ? { headers } : {}),
    })

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
