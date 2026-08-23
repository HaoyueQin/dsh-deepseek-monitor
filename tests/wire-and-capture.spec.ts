import { describe, expect, it } from 'vitest'
import { readJsonBody } from '../src/wire.ts'
import { CAPTURE_SCRIPT } from '../src/client/capture-script.ts'

function reqWithChunks(chunks: string[]): any {
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

  it('rejects malformed JSON with 400', async () => {
    await expect(readJsonBody(reqWithChunks(['{oops']))).rejects.toMatchObject({ status: 400 })
  })
})

describe('capture script invariants', () => {
  it('installs once and reads Authorization headers locally', () => {
    expect(CAPTURE_SCRIPT).toContain('__dshCapInstalled')
    expect(CAPTURE_SCRIPT).toMatch(/authorization/i)
    expect(CAPTURE_SCRIPT).toContain('XMLHttpRequest')
  })

  it('never transmits anything anywhere', () => {
    const outboundUrl = new RegExp('fetch' + String.fromCharCode(92) + '(' + String.fromCharCode(92) + 's*' + String.fromCharCode(39) + '"' + String.fromCharCode(96) + ']' + 'https?://')
    expect(CAPTURE_SCRIPT).not.toMatch(outboundUrl)
    // The only allowed URL-ish token is none at all: zero http occurrences.
    expect(CAPTURE_SCRIPT.includes('http://')).toBe(false)
    expect(CAPTURE_SCRIPT.includes('https://')).toBe(false)
  })
})
