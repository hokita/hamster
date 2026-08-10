const IPV4_RANGES: [string, number][] = [
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

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0
}

function isDisallowedIpv4(ip: string): boolean {
  const ipInt = ipv4ToInt(ip)
  return IPV4_RANGES.some(([base, bits]) => {
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

const IPV6_RANGES: [string, number][] = [
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

function isDisallowedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase()
  const mappedDotted = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mappedDotted) return isDisallowedIpv4(mappedDotted[1])
  // WHATWG URL serializes bracketed IPv4-mapped IPv6 literals in this canonical hex
  // form (e.g. "::ffff:7f00:1" for 127.0.0.1), not the dotted-decimal form above.
  const mappedHex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (mappedHex) return isDisallowedIpv4(hexGroupsToIpv4(mappedHex[1], mappedHex[2]))

  const ipInt = ipv6ToBigInt(normalized)
  return IPV6_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0n : (~0n << BigInt(128 - bits)) & ((1n << 128n) - 1n)
    return (ipInt & mask) === (ipv6ToBigInt(base) & mask)
  })
}

export function isDisallowedIp(address: string, family: number): boolean {
  return family === 4 ? isDisallowedIpv4(address) : isDisallowedIpv6(address)
}
