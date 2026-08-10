import { describe, it, expect } from 'vitest'
import { isDisallowedIp } from './ipGuard'

describe('isDisallowedIp', () => {
  it('rejects private, loopback, link-local, and reserved IPv4 ranges', () => {
    expect(isDisallowedIp('10.1.2.3', 4)).toBe(true)
    expect(isDisallowedIp('172.16.0.1', 4)).toBe(true)
    expect(isDisallowedIp('172.31.255.255', 4)).toBe(true)
    expect(isDisallowedIp('192.168.1.1', 4)).toBe(true)
    expect(isDisallowedIp('127.0.0.1', 4)).toBe(true)
    expect(isDisallowedIp('169.254.1.1', 4)).toBe(true)
    expect(isDisallowedIp('0.0.0.5', 4)).toBe(true)
  })

  it('allows public IPv4 addresses, including just outside the 172.16.0.0/12 range', () => {
    expect(isDisallowedIp('93.184.216.34', 4)).toBe(false)
    expect(isDisallowedIp('172.32.0.1', 4)).toBe(false)
    expect(isDisallowedIp('172.15.255.255', 4)).toBe(false)
  })

  it('rejects the remaining IANA special-purpose IPv4 ranges beyond the original six', () => {
    expect(isDisallowedIp('100.64.0.1', 4)).toBe(true) // shared address space (CGNAT)
    expect(isDisallowedIp('100.127.255.255', 4)).toBe(true) // top of 100.64.0.0/10
    expect(isDisallowedIp('192.0.0.1', 4)).toBe(true) // IETF protocol assignments
    expect(isDisallowedIp('192.0.2.1', 4)).toBe(true) // documentation (TEST-NET-1)
    expect(isDisallowedIp('192.88.99.1', 4)).toBe(true) // 6to4 relay anycast
    expect(isDisallowedIp('198.18.0.1', 4)).toBe(true) // benchmarking
    expect(isDisallowedIp('198.51.100.1', 4)).toBe(true) // documentation (TEST-NET-2)
    expect(isDisallowedIp('203.0.113.1', 4)).toBe(true) // documentation (TEST-NET-3)
    expect(isDisallowedIp('240.0.0.1', 4)).toBe(true) // reserved for future use
    expect(isDisallowedIp('255.255.255.255', 4)).toBe(true) // limited broadcast
  })

  it('still allows public IPv4 addresses just outside the newly added ranges', () => {
    expect(isDisallowedIp('100.63.255.255', 4)).toBe(false) // just below 100.64.0.0/10
    expect(isDisallowedIp('100.128.0.0', 4)).toBe(false) // just above 100.64.0.0/10
    expect(isDisallowedIp('8.8.8.8', 4)).toBe(false)
  })

  it('rejects loopback, unspecified, unique-local, link-local, and IPv4-mapped private IPv6 addresses', () => {
    expect(isDisallowedIp('::1', 6)).toBe(true)
    expect(isDisallowedIp('::', 6)).toBe(true)
    expect(isDisallowedIp('fd12:3456:789a::1', 6)).toBe(true)
    expect(isDisallowedIp('fe80::1', 6)).toBe(true)
    expect(isDisallowedIp('::ffff:127.0.0.1', 6)).toBe(true)
  })

  it('rejects the canonical hexadecimal form of IPv4-mapped private addresses (as WHATWG URL serializes bracketed IPv6 literals)', () => {
    expect(isDisallowedIp('::ffff:7f00:1', 6)).toBe(true) // 127.0.0.1
    expect(isDisallowedIp('::ffff:a00:1', 6)).toBe(true) // 10.0.0.1
  })

  it('allows public IPv6 addresses, including the hex-mapped form of a public IPv4 address', () => {
    expect(isDisallowedIp('2606:2800:220:1:248:1893:25c8:1946', 6)).toBe(false)
    expect(isDisallowedIp('::ffff:5db8:d822', 6)).toBe(false) // 93.184.216.34
  })

  it('rejects NAT64, discard-only, documentation, and 6to4 IPv6 special-purpose ranges', () => {
    expect(isDisallowedIp('64:ff9b::1', 6)).toBe(true) // NAT64
    expect(isDisallowedIp('64:ff9b:1::1', 6)).toBe(true) // NAT64 (local use)
    expect(isDisallowedIp('100::1', 6)).toBe(true) // discard-only
    expect(isDisallowedIp('2001:db8::1', 6)).toBe(true) // documentation
    expect(isDisallowedIp('2002:c000:0201::1', 6)).toBe(true) // 6to4
  })
})
