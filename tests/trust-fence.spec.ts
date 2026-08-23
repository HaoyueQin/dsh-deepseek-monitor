import { describe, expect, it } from 'vitest'
import { createTrustFence, isLoopbackHostname } from '../src/trust-fence.ts'

type Headers = Record<string, string | string[] | undefined>
const request = (headers: Headers) => ({
  url: '/dsm/api/status',
  method: 'GET',
  headers,
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  [Symbol.asyncIterator]: async function* () {},
})

describe('isLoopbackHostname', () => {
  it('accepts localhost, bracketed IPv6 loopback and all 127/8 addresses', () => {
    expect(isLoopbackHostname('localhost')).toBe(true)
    expect(isLoopbackHostname('[::1]')).toBe(true)
    expect(isLoopbackHostname('127.0.0.1')).toBe(true)
    expect(isLoopbackHostname('127.255.0.7')).toBe(true)
  })
  it('rejects lookalikes', () => {
    expect(isLoopbackHostname('localhost.evil.test')).toBe(false)
    expect(isLoopbackHostname('2130706433')).toBe(false)
    expect(isLoopbackHostname('128.0.0.1')).toBe(false)
  })
})

describe('createTrustFence().isTrusted', () => {
  it('passes loopback Host with no Origin', () => {
    const fence = createTrustFence(() => [])
    expect(fence.isTrusted(request({ host: 'localhost:3080' }))).toBe(true)
    expect(fence.isTrusted(request({ host: '127.0.0.1:3080' }))).toBe(true)
  })

  it('refuses non-loopback hosts without trustedHosts', () => {
    const fence = createTrustFence(() => [])
    expect(fence.isTrusted(request({ host: 'attacker.example:80' }))).toBe(false)
  })

  it('port-less trusted entries match ANY port; port entries match exactly', () => {
    const fence = createTrustFence(() => ['192.168.1.20'])
    expect(fence.isTrusted(request({ host: '192.168.1.20:49152' }))).toBe(true)
    expect(fence.isTrusted(request({ host: '192.168.1.21:49152' }))).toBe(false)
    const exact = createTrustFence(() => ['192.168.1.20:3000'])
    expect(exact.isTrusted(request({ host: '192.168.1.20:3000' }))).toBe(true)
    expect(exact.isTrusted(request({ host: '192.168.1.20:49152' }))).toBe(false)
  })

  it('refuses cross-site fetch-metadata even from our own authority', () => {
    const fence = createTrustFence(() => [])
    expect(fence.isTrusted(request({ host: 'localhost:3080', 'sec-fetch-site': 'cross-site' }))).toBe(false)
  })

  it('origin must equal the Host authority exactly', () => {
    const fence = createTrustFence(() => [])
    expect(fence.isTrusted(request({ host: 'localhost:3080', origin: 'http://localhost:3080' }))).toBe(true)
    expect(fence.isTrusted(request({ host: 'localhost:3080', origin: 'http://localhost:9999' }))).toBe(false)
    expect(fence.isTrusted(request({ host: 'localhost:3080', origin: 'null' }))).toBe(false)
    expect(fence.isTrusted(request({ host: 'localhost:3080', origin: 'http://evil.example' }))).toBe(false)
  })

  it('missing or unparsable Host is refused outright', () => {
    const fence = createTrustFence(() => [])
    expect(fence.isTrusted(request({}))).toBe(false)
    expect(fence.isTrusted(request({ host: 'not a host' }))).toBe(false)
  })
})
