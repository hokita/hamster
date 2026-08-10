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
})
