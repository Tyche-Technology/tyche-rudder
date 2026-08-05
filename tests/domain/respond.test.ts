import { describe, it, expect } from 'vitest'
import { failParse, isUniqueViolation, readJson, readCappedFormData, BODY_TOO_LARGE } from '@/app/api/v1/respond'
import { commentSchema } from '@/lib/validation'

describe('failParse', () => {
  it('maps each zod issue to {path, message} and keeps the generic Korean error/400 status', async () => {
    const result = commentSchema.safeParse({})
    if (result.success) throw new Error('expected failure')
    const res = failParse(result.error)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toEqual({
      ok: false,
      error: '입력값이 올바르지 않습니다',
      issues: [{ path: 'body', message: expect.any(String) }],
    })
  })
})

describe('isUniqueViolation', () => {
  it('is true only for a 23505-coded error', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true)
  })
  it('is false for a differently-coded error', () => {
    expect(isUniqueViolation({ code: '23502' })).toBe(false)
  })
  it('is false for non-object values', () => {
    expect(isUniqueViolation(null)).toBe(false)
    expect(isUniqueViolation('nope')).toBe(false)
    expect(isUniqueViolation(undefined)).toBe(false)
  })
})

describe('readJson', () => {
  it('parses a normal JSON body', async () => {
    const req = new Request('http://x/y', { method: 'POST', body: JSON.stringify({ a: 1 }) })
    expect(await readJson(req)).toEqual({ a: 1 })
  })

  it('returns null for malformed JSON', async () => {
    const req = new Request('http://x/y', { method: 'POST', body: '{not json' })
    expect(await readJson(req)).toBeNull()
  })

  it('rejects on a lying content-length header before the body would even need to be read', async () => {
    const req = new Request('http://x/y', {
      method: 'POST',
      headers: { 'content-length': '2000000' },
      body: JSON.stringify({ a: 1 }), // real body is tiny — only the header is oversized
    })
    expect(await readJson(req)).toBe(BODY_TOO_LARGE)
  })

  it('rejects an oversized body with no content-length header, and stops reading the source early', async () => {
    // A plain in-memory string body can't distinguish "capped mid-stream"
    // from "fully buffered, then rejected" — both look identical from the
    // outside. This drives an adversarial ReadableStream instead (no
    // content-length, as chunked transfer encoding would produce) and
    // proves the source itself gets cut off, not just that a 413 comes back.
    const chunk = new Uint8Array(64 * 1024).fill(97) // 64KB
    let pulls = 0
    let sent = 0
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++
        if (sent >= 100) { controller.close(); return } // 100 x 64KB = 6.4MB if fully drained
        sent++
        controller.enqueue(chunk)
      },
    })
    const req = new Request('http://x/y', { method: 'POST', body: source, duplex: 'half' } as RequestInit)
    expect(await readJson(req)).toBe(BODY_TOO_LARGE)
    // The 1MB cap trips around chunk 17 — well short of all 100 pulls.
    expect(pulls).toBeLessThan(30)
  })
})

describe('readCappedFormData', () => {
  it('parses a form under the cap', async () => {
    const form = new FormData()
    form.set('file', new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' }))
    const req = new Request('http://x/y', { method: 'POST', body: form })
    const result = await readCappedFormData(req, 1_000_000)
    expect(result).toBeInstanceOf(FormData)
    expect((result as FormData).get('file')).toBeInstanceOf(File)
  })

  it('rejects an oversized multipart body without content-length, and stops reading the source early', async () => {
    const boundary = '----respondtest'
    const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`
    const tail = `\r\n--${boundary}--\r\n`
    const enc = new TextEncoder()
    const chunk = new Uint8Array(1024).fill(97)
    let pulls = 0
    // head, then 500 x 1KB chunks (~500KB total if fully drained), then the
    // closing boundary. The cap below is 100 bytes, so a correct
    // implementation must cancel this stream long before all 500 chunks go by.
    let stage: 'head' | 'chunks' | 'tail' | 'done' = 'head'
    let sent = 0
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++
        if (stage === 'head') { controller.enqueue(enc.encode(head)); stage = 'chunks'; return }
        if (stage === 'chunks') {
          if (sent >= 500) { stage = 'tail'; return }
          sent++
          controller.enqueue(chunk)
          return
        }
        if (stage === 'tail') { controller.enqueue(enc.encode(tail)); stage = 'done'; return }
        controller.close()
      },
    })
    const req = new Request('http://x/y', {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body: source,
      duplex: 'half',
    } as RequestInit)
    const result = await readCappedFormData(req, 100)
    expect(result).toBe(BODY_TOO_LARGE)
    // The real proof this bounds memory: the source stream got canceled long
    // before all 500 chunks were pulled, so the whole body was never buffered.
    expect(pulls).toBeLessThan(50)
  })
})
