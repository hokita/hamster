const IPV4_RANGES: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['240.0.0.0', 4],
  ['255.255.255.255', 32],
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
  ['::1', 128],
  ['::', 128],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
]

function isDisallowedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase()
  const mappedDotted = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mappedDotted) return isDisallowedIpv4(mappedDotted[1])
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
