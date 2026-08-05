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

  // This is the mechanism the deploy pipeline actually rolls back on — it
  // polls this exact endpoint (deploy/docker-compose.prod.yml's healthcheck,
  // .github/workflows/deploy.yml's wget loop), not process exit. Next 16's
  // production server (next start / standalone server.js) doesn't reliably
  // crash on register()'s throw (see instrumentation.ts), so this is what
  // actually stops a bad-secret deploy from being reported healthy.
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
