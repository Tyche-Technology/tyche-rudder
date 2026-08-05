import { describe, it, expect, beforeAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb } from '../helpers/db'
import { createSessionUser } from '../helpers/auth'
import { apiTokens, users } from '@/db/schema'
import { actorFromRequest, hashToken } from '@/lib/api-auth'
import type { Db } from '@/db/client'

let db: Db

beforeAll(async () => {
  db = await createTestDb()
  await db.insert(apiTokens).values({ name: '도선사-테스트', tokenHash: hashToken('rud_testtoken') })
})

describe('actorFromRequest', () => {
  it('resolves a valid bearer token to an agent actor', async () => {
    const req = new Request('http://x', { headers: { authorization: 'Bearer rud_testtoken' } })
    const actor = await actorFromRequest(db, req)
    expect(actor?.type).toBe('agent')
  })
  it('is case-insensitive on the Bearer scheme', async () => {
    const req = new Request('http://x', { headers: { authorization: 'bearer rud_testtoken' } })
    const actor = await actorFromRequest(db, req)
    expect(actor?.type).toBe('agent')
  })
  // A token row can never be deleted once its agent has written anything
  // (comments/issue_events/attachments reference it ON DELETE restrict), so
  // revocation is a flag and this check is the only thing that enforces it.
  it('refuses a revoked token, and does not record the attempt as a use', async () => {
    const hash = hashToken('rud_revoked')
    await db.insert(apiTokens).values({ name: '취소될-토큰', tokenHash: hash })
    const req = () => new Request('http://x', { headers: { authorization: 'Bearer rud_revoked' } })

    // Walk the operator's real sequence: a working token, then revoked.
    expect((await actorFromRequest(db, req()))?.type).toBe('agent')
    const [used] = await db.select().from(apiTokens).where(eq(apiTokens.tokenHash, hash))
    expect(used.lastUsedAt).not.toBeNull()

    await db.update(apiTokens).set({ revokedAt: new Date() }).where(eq(apiTokens.tokenHash, hash))
    expect(await actorFromRequest(db, req())).toBeNull()

    // Pins the ordering the code claims: refused, not "used". Without this,
    // moving the lastUsedAt update above the revocation check stays green.
    const [after] = await db.select().from(apiTokens).where(eq(apiTokens.tokenHash, hash))
    expect(after.lastUsedAt).toEqual(used.lastUsedAt)
  })

  it('returns null for invalid token and empty session', async () => {
    const bad = new Request('http://x', { headers: { authorization: 'Bearer rud_wrong' } })
    expect(await actorFromRequest(db, bad)).toBeNull()
    expect(await actorFromRequest(db, new Request('http://x'))).toBeNull()
  })

  it('resolves a real session cookie to a user actor using the DB role', async () => {
    const { user, cookie } = await createSessionUser(db, { role: 'admin' })
    const actor = await actorFromRequest(db, new Request('http://x', { headers: { cookie } }))
    expect(actor).toEqual({ type: 'user', id: user.id, role: 'admin' })
  })

  it('reflects a role change made after the session was issued (no cookieCache)', async () => {
    const { user, cookie } = await createSessionUser(db, { role: 'user' })
    await db.update(users).set({ role: 'admin' }).where(eq(users.id, user.id))
    const actor = await actorFromRequest(db, new Request('http://x', { headers: { cookie } }))
    expect(actor).toEqual({ type: 'user', id: user.id, role: 'admin' })
  })

  it('refuses a banned user even with an otherwise-valid session', async () => {
    const { user, cookie } = await createSessionUser(db)
    await db.update(users).set({ banned: true }).where(eq(users.id, user.id))
    expect(await actorFromRequest(db, new Request('http://x', { headers: { cookie } }))).toBeNull()
  })

  it('returns null once the sessioned user (and their cascaded session row) has been deleted', async () => {
    const { user, cookie } = await createSessionUser(db)
    await db.delete(users).where(eq(users.id, user.id))
    expect(await actorFromRequest(db, new Request('http://x', { headers: { cookie } }))).toBeNull()
  })

  it('resolves null when there is no session cookie (401 path)', async () => {
    expect(await actorFromRequest(db, new Request('http://x'))).toBeNull()
  })

  it('resolves null (not a throw) for a garbage session cookie (401 path, not 500)', async () => {
    const req = new Request('http://x', { headers: { cookie: 'better-auth.session_token=garbage' } })
    expect(await actorFromRequest(db, req)).toBeNull()
  })

  // getAuth() throwing on a missing/placeholder secret propagates through
  // actorFromRequest untouched (no try/catch here to swallow it) — that's
  // asserted end-to-end at the route/envelope layer instead
  // (tests/api/auth-envelope.test.ts), which can rebuild getAuth() with a
  // broken secret via vi.resetModules(). getAuth() is already cached with a
  // valid secret by the time this file's tests run, so there is nothing
  // fresh to prove at this layer.

  describe('trusted-origin guard on cookie-authenticated, state-changing requests', () => {
    it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('rejects a mismatched Origin on a %s', async (method) => {
      const { cookie } = await createSessionUser(db)
      const req = new Request('http://x/foo', { method, headers: { cookie, origin: 'https://evil.example.com' } })
      expect(await actorFromRequest(db, req)).toBeNull()
    })

    it('allows an Origin that matches the request origin (BETTER_AUTH_URL unset -> falls back to req.url)', async () => {
      const { user, cookie } = await createSessionUser(db)
      const req = new Request('http://x/foo', { method: 'POST', headers: { cookie, origin: 'http://x' } })
      expect(await actorFromRequest(db, req)).toEqual({ type: 'user', id: user.id, role: user.role })
    })

    it('does not guard GET requests even with a mismatched Origin', async () => {
      const { user, cookie } = await createSessionUser(db)
      const req = new Request('http://x', { headers: { cookie, origin: 'https://evil.example.com' } })
      expect(await actorFromRequest(db, req)).toEqual({ type: 'user', id: user.id, role: user.role })
    })

    it('rejects a cookie-authenticated POST that carries no Origin header at all (fail-closed)', async () => {
      // Real browsers attach Origin to every same-origin state-changing fetch,
      // so a missing header on a cookie-bearing mutation is never a real
      // browser — but rather than trust that inference, the guard fails
      // closed: reject and let the caller prove it's legitimate with a
      // matching Origin, the same as a mismatched one.
      const { cookie } = await createSessionUser(db)
      const req = new Request('http://x', { method: 'POST', headers: { cookie } })
      expect(await actorFromRequest(db, req)).toBeNull()
    })

    it('does not affect a Bearer-token agent request even with a mismatched Origin', async () => {
      const req = new Request('http://x', {
        method: 'POST',
        headers: { authorization: 'Bearer rud_testtoken', origin: 'https://evil.example.com' },
      })
      const actor = await actorFromRequest(db, req)
      expect(actor?.type).toBe('agent')
    })
  })
})
