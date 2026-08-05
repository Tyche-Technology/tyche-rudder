import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { createTestDb } from '../helpers/db'
import { withErrorEnvelope } from '@/lib/with-error-envelope'

let originalSecret: string | undefined

beforeAll(async () => {
  await createTestDb() // also sets BETTER_AUTH_SECRET if unset
  originalSecret = process.env.BETTER_AUTH_SECRET
})

afterEach(() => {
  if (originalSecret === undefined) delete process.env.BETTER_AUTH_SECRET
  else process.env.BETTER_AUTH_SECRET = originalSecret
  vi.resetModules()
})

async function expectEnvelope500(res: Response) {
  expect(res.status).toBe(500)
  expect(await res.json()).toEqual({ ok: false, error: '서버 오류가 발생했습니다' })
}

// Any /api/v1/* route works for these — GET /api/v1/users is the simplest
// (no body, no admin check) and goes through actorFromRequest -> getAuth()
// like every other authenticated route.
describe('routes fail closed with the JSON envelope on auth errors', () => {
  it('does not write error messages or query parameters to logs', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const handler = withErrorEnvelope(async () => {
      throw Object.assign(new Error('password=do-not-log'), {
        query: 'insert into users values ($1)',
        parameters: ['do-not-log'],
      })
    })

    await expectEnvelope500(await handler())
    expect(errorSpy).toHaveBeenCalledWith('request_failed', { errorType: 'Error' })
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('do-not-log')
    errorSpy.mockRestore()
  })

  it('returns the envelope, not a thrown error, when BETTER_AUTH_SECRET is missing', async () => {
    // getAuth() caches its instance at module scope, so a fresh module
    // registry (not just deleting the env var) is required to force it to
    // rebuild and see the missing secret.
    delete process.env.BETTER_AUTH_SECRET
    vi.resetModules()
    const { GET } = await import('@/app/api/v1/users/route')
    await expectEnvelope500(await GET(new Request('http://x/api/v1/users')))
  })

  it('401s (not 500) on a garbage session cookie', async () => {
    vi.resetModules()
    const { GET } = await import('@/app/api/v1/users/route')
    const res = await GET(new Request('http://x/api/v1/users', {
      headers: { cookie: 'better-auth.session_token=garbage' },
    }))
    expect(res.status).toBe(401)
  })
})
