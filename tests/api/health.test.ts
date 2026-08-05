import { describe, it, expect, afterEach } from 'vitest'
import { GET } from '@/app/api/health/route'

const ORIGINAL = process.env.BETTER_AUTH_SECRET

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.BETTER_AUTH_SECRET
  else process.env.BETTER_AUTH_SECRET = ORIGINAL
})

describe('GET /api/health', () => {
  it('returns ok with a valid BETTER_AUTH_SECRET', async () => {
    process.env.BETTER_AUTH_SECRET = 'x'.repeat(32)
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, data: { status: 'sailing' } })
  })

  it('503s when BETTER_AUTH_SECRET is missing', async () => {
    delete process.env.BETTER_AUTH_SECRET
    const res = await GET()
    expect(res.status).toBe(503)
  })

  it('503s when BETTER_AUTH_SECRET is the shipped placeholder', async () => {
    process.env.BETTER_AUTH_SECRET = 'change-me-32-chars-minimum-secret!!'
    const res = await GET()
    expect(res.status).toBe(503)
  })

  it('503s when BETTER_AUTH_SECRET is under 32 chars', async () => {
    process.env.BETTER_AUTH_SECRET = 'too-short'
    const res = await GET()
    expect(res.status).toBe(503)
  })
})
