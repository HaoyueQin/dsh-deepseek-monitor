import { describe, expect, it } from 'vitest'
import { readJsonBody } from '../src/wire.ts'
import { CAPTURE_SCRIPT } from '../src/client/capture-script.ts'

function reqWithChunks(chunks: Array<string | Uint8Array>): any {
  return {
    headers: {},
    [Symbol.asyncIterator]: async function* () {
      for (const chunk of chunks) yield chunk
    },
  }
}

describe('readJsonBody byte cap', () => {
  it('counts UTF-8 bytes, not UTF-16 units', async () => {
    // 30k CJK chars = ~30k UTF-16 units but ~90KB of UTF-8: the old .length
    // check let this slip past a 64KiB cap.
    const oversized = '你'.repeat(30_000)
    await expect(readJsonBody(reqWithChunks([oversized]))).rejects.toMatchObject({ status: 413 })
  })

  it('parses a normal body and passes an empty one through as undefined', async () => {
    expect(await readJsonBody(reqWithChunks(['{"force":', 'true}']))).toEqual({ force: true })
    expect(await readJsonBody(reqWithChunks([]))).toBeUndefined()
  })

  it('drains an oversized body to the end before answering 413', async () => {
    // The 413 decision must not abandon the stream: an interrupted read leaves
    // unparsed bytes in the socket that Node would treat as the next request.
    let consumed = 0
    const req = {
      headers: {},
      [Symbol.asyncIterator]: async function* () {
        for (let i = 0; i < 100; i++) { consumed++; yield '你'.repeat(1000) }
      },
    }
    await expect(readJsonBody(req as any)).rejects.toMatchObject({ status: 413 })
    expect(consumed).toBe(100)
  })

  it('rejects malformed JSON with 400', async () => {
    await expect(readJsonBody(reqWithChunks(['{oops']))).rejects.toMatchObject({ status: 400 })
  })

  it('reassembles a UTF-8 sequence split across chunk boundaries', async () => {
    // '你' = E4 BD A0; slice the byte array mid-codepoint. Per-chunk decoding
    // (the old behavior) replaced the split character with U+FFFD.
    const encoded = new TextEncoder().encode('{"你":"好"}')
    const cut = 4 // inside the first 你
    await expect(readJsonBody(reqWithChunks([
      encoded.slice(0, cut),
      encoded.slice(cut),
    ]))).resolves.toEqual({ 你: '好' })
  })
})

describe('capture script invariants', () => {
  it('installs once and reads Authorization headers locally', () => {
    expect(CAPTURE_SCRIPT).toContain('__dshCapInstalled')
    expect(CAPTURE_SCRIPT).toMatch(/authorization/i)
    expect(CAPTURE_SCRIPT).toContain('XMLHttpRequest')
  })

  it('never transmits anything anywhere', () => {
    // No outbound network call to an explicit URL (fetch/XHR/sendBeacon with
    // a literal http(s) target), and zero http(s) occurrences at all — the
    // script only MONKEY-PATCHES fetch; it never originates requests.
    expect(CAPTURE_SCRIPT).not.toMatch(/(?:fetch|sendBeacon|open)\s*\(\s*['"`]https?:/)
    expect(CAPTURE_SCRIPT.includes('http://')).toBe(false)
    expect(CAPTURE_SCRIPT.includes('https://')).toBe(false)
  })
})
