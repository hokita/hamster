const IPV4_RANGES: [string, number][] = [
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['0.0.0.0', 8],
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

function isDisallowedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase()
  if (normalized === '::1') return true
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isDisallowedIpv4(mapped[1])
  const firstGroup = parseInt(normalized.split(':')[0] || '0', 16)
  if ((firstGroup & 0xfe00) === 0xfc00) return true // fc00::/7 (unique local)
  if ((firstGroup & 0xffc0) === 0xfe80) return true // fe80::/10 (link-local)
  return false
}

export function isDisallowedIp(address: string, family: number): boolean {
  return family === 4 ? isDisallowedIpv4(address) : isDisallowedIpv6(address)
}
