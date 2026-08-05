import { describe, it, expect, beforeAll, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb } from '../helpers/db'
import { getAuth } from '@/lib/better-auth'
import { invites, users, apiTokens } from '@/db/schema'
import { hashToken } from '@/lib/api-auth'
import { setPasswordDirect } from '@/lib/invites'
import * as invitesLib from '@/lib/invites'
import type { Db } from '@/db/client'
import { POST as createRoute } from '@/app/api/v1/invites/route'
import { POST as acceptRoute } from '@/app/api/v1/invites/accept/route'
import { GET as statusRoute } from '@/app/api/v1/invites/[token]/route'
import { POST as consumeRoute } from '@/app/api/v1/invites/consume/route'

type SignInEmailResult = Awaited<ReturnType<ReturnType<typeof getAuth>['api']['signInEmail']>>

let db: Db
let adminCookie: string

async function loginAs(email: string, password: string): Promise<string> {
  const { headers } = await getAuth().api.signInEmail({ returnHeaders: true, body: { email, password } })
  return headers.get('set-cookie')!
}

// origin defaults to the request's own origin (matches actorFromRequest's
// BETTER_AUTH_URL-unset fallback) so every existing call keeps passing the
// now-fail-closed guard without having to thread an Origin through each one;
// tests that need a mismatched Origin pass it explicitly.
function mkReq(body: unknown, cookie?: string, bearer?: string, origin = 'http://x') {
  return new Request('http://x/api/v1/invites', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      origin,
    },
    body: JSON.stringify(body),
  })
}

beforeAll(async () => {
  db = await createTestDb()
  await getAuth().api.createUser({ body: { email: 'captain@test.local', password: 'captain-pw-123', name: '선장', role: 'admin' } })
  await getAuth().api.createUser({ body: { email: 'deckhand@test.local', password: 'deckhand-pw-123', name: '갑판원', role: 'user' } })
  await db.insert(apiTokens).values({ name: '에이전트', tokenHash: hashToken('rud_invite_test_token') })
  adminCookie = await loginAs('captain@test.local', 'captain-pw-123')
})

describe('POST /api/v1/invites', () => {
  it('201s for an admin: creates the user (role applied) and returns a one-time link', async () => {
    const res = await createRoute(mkReq({ email: 'new@test.local', name: '신입', role: 'user' }, adminCookie))
    expect(res.status).toBe(201)
    const { data } = await res.json()
    expect(data.inviteUrl).toMatch(/\/invite\/[0-9a-f]{64}$/)
    const [user] = await db.select().from(users).where(eq(users.email, 'new@test.local'))
    expect(user.role).toBe('user')
    expect(data.userId).toBe(user.id)
    // raw token never stored
    const token = data.inviteUrl.split('/').pop()!
    const [inv] = await db.select().from(invites).where(eq(invites.userId, user.id))
    expect(inv.tokenHash).toBe(hashToken(token))
    expect(inv.tokenHash).not.toBe(token)
  })

  it('re-issue for an existing email: no duplicate user, old unused invite replaced', async () => {
    const first = await createRoute(mkReq({ email: 'again@test.local', name: '재발급' }, adminCookie))
    const second = await createRoute(mkReq({ email: 'again@test.local', name: '재발급' }, adminCookie))
    expect(second.status).toBe(201)
    const rows = await db.select().from(users).where(eq(users.email, 'again@test.local'))
    expect(rows).toHaveLength(1)
    const invRows = await db.select().from(invites).where(eq(invites.userId, rows[0].id))
    expect(invRows).toHaveLength(1) // old unused invite deleted
    const firstToken = (await first.json()).data.inviteUrl.split('/').pop()!
    expect(invRows[0].tokenHash).not.toBe(hashToken(firstToken))
  })

  it('re-issue is case-insensitive: differently-cased emails resolve to the same user', async () => {
    // starts mixed-case, re-issued lowercase
    await createRoute(mkReq({ email: 'Mixed@Test.local', name: '대소문자' }, adminCookie))
    const res1 = await createRoute(mkReq({ email: 'mixed@test.local', name: '대소문자' }, adminCookie))
    expect(res1.status).toBe(201)
    const rows1 = await db.select().from(users).where(eq(users.email, 'mixed@test.local'))
    expect(rows1).toHaveLength(1)
    const inv1 = await db.select().from(invites).where(eq(invites.userId, rows1[0].id))
    expect(inv1).toHaveLength(1)

    // starts lowercase, re-issued mixed-case (the reverse)
    await createRoute(mkReq({ email: 'reverse@test.local', name: '역순' }, adminCookie))
    const res2 = await createRoute(mkReq({ email: 'Reverse@Test.local', name: '역순' }, adminCookie))
    expect(res2.status).toBe(201)
    const rows2 = await db.select().from(users).where(eq(users.email, 'reverse@test.local'))
    expect(rows2).toHaveLength(1)
    const inv2 = await db.select().from(invites).where(eq(invites.userId, rows2[0].id))
    expect(inv2).toHaveLength(1)
  })

  it('409s a duplicate-email race instead of a generic 500', async () => {
    const spy = vi.spyOn(getAuth().api, 'createUser')
      .mockRejectedValueOnce(Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }))
    const res = await createRoute(mkReq({ email: 'brand-new@test.local', name: '신규' }, adminCookie))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.ok).toBe(false)
    spy.mockRestore()
  })

  it('403s a non-admin user and an agent token; 401s anonymous', async () => {
    const userCookie = await loginAs('deckhand@test.local', 'deckhand-pw-123')
    expect((await createRoute(mkReq({ email: 'x@test.local', name: 'x' }, userCookie))).status).toBe(403)
    expect((await createRoute(mkReq({ email: 'x@test.local', name: 'x' }, undefined, 'rud_invite_test_token'))).status).toBe(403)
    expect((await createRoute(mkReq({ email: 'x@test.local', name: 'x' }))).status).toBe(401)
  })

  it('400s invalid email', async () => {
    expect((await createRoute(mkReq({ email: 'not-an-email', name: 'x' }, adminCookie))).status).toBe(400)
  })

  it('normalizes a trailing slash in BETTER_AUTH_URL so the invite link has a single slash', async () => {
    process.env.BETTER_AUTH_URL = 'https://trailing.example.com/'
    try {
      const req = mkReq({ email: 'trailing-slash@test.local', name: '슬래시' }, adminCookie, undefined, 'https://trailing.example.com')
      const res = await createRoute(req)
      const { data } = await res.json()
      expect(data.inviteUrl).toMatch(/^https:\/\/trailing\.example\.com\/invite\/[0-9a-f]{64}$/)
    } finally {
      delete process.env.BETTER_AUTH_URL
    }
  })
})

function mkAccept(body: unknown, origin: string | null = 'http://x', contentType = 'application/json') {
  return new Request('http://x/api/v1/invites/accept', {
    method: 'POST',
    headers: { 'content-type': contentType, ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  })
}

async function makeInvite(email: string, name = '초대자') {
  const res = await createRoute(mkReq({ email, name }, adminCookie))
  const { data } = await res.json()
  return { token: data.inviteUrl.split('/').pop() as string, userId: data.userId as number }
}

describe('GET /api/v1/invites/[token]', () => {
  it('200s pending with invitee identity; 404s unknown', async () => {
    const { token } = await makeInvite('status@test.local', '상태조회')
    const res = await statusRoute(mkReq({}, undefined), { params: Promise.resolve({ token }) })
    const { data } = await res.json()
    expect(data).toEqual({ email: 'status@test.local', name: '상태조회', status: 'pending' })
    const miss = await statusRoute(mkReq({}, undefined), { params: Promise.resolve({ token: 'f'.repeat(64) }) })
    expect(miss.status).toBe(404)
  })
})

describe('POST /api/v1/invites/accept', () => {
  it('rejects cross-origin and non-JSON session-swap requests before consuming the invite', async () => {
    const crossOrigin = await makeInvite('cross-origin-accept@test.local')
    expect((await acceptRoute(mkAccept(
      { token: crossOrigin.token, password: 'fresh-anchor-99' },
      'https://evil.example.com',
    ))).status).toBe(403)

    const wrongType = await makeInvite('wrong-type-accept@test.local')
    expect((await acceptRoute(mkAccept(
      { token: wrongType.token, password: 'fresh-anchor-99' },
      'http://x',
      'text/plain',
    ))).status).toBe(415)

    const rows = await db.select().from(invites).where(eq(invites.userId, crossOrigin.userId))
    expect(rows[0].usedAt).toBeNull()
  })

  it('sets the password, signs in (set-cookie), marks the invite used', async () => {
    const { token, userId } = await makeInvite('accept@test.local')
    const res = await acceptRoute(mkAccept({ token, password: 'fresh-anchor-99' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toContain('better-auth')
    const { data } = await res.json()
    expect(data.id).toBe(userId)
    // the new password now works via normal sign-in
    const { headers } = await getAuth().api.signInEmail({
      returnHeaders: true, body: { email: 'accept@test.local', password: 'fresh-anchor-99' },
    })
    expect(headers.get('set-cookie')).toBeTruthy()
  })

  it('is single-use (second accept 410) and rejects expired invites (410) and unknown tokens (404)', async () => {
    const { token } = await makeInvite('once@test.local')
    await acceptRoute(mkAccept({ token, password: 'first-time-pw-1' }))
    expect((await acceptRoute(mkAccept({ token, password: 'second-try-pw-2' }))).status).toBe(410)
    const { token: expTok } = await makeInvite('late@test.local')
    await db.update(invites).set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invites.tokenHash, hashToken(expTok)))
    expect((await acceptRoute(mkAccept({ token: expTok, password: 'too-late-pw-33' }))).status).toBe(410)
    expect((await acceptRoute(mkAccept({ token: 'a'.repeat(64), password: 'whatever-pw-44' }))).status).toBe(404)
  })

  it('rolls back the claim when setPasswordDirect fails, so the invite stays usable for a real retry', async () => {
    const { token } = await makeInvite('txn-rollback@test.local')
    const spy = vi.spyOn(invitesLib, 'setPasswordDirect').mockRejectedValueOnce(new Error('boom'))
    const res = await acceptRoute(mkAccept({ token, password: 'first-attempt-pw1' }))
    spy.mockRestore()
    expect(res.status).toBe(500)
    const [inv] = await db.select().from(invites).where(eq(invites.tokenHash, hashToken(token)))
    expect(inv.usedAt).toBeNull() // the failed write rolled the claim back too
    // proof, not inference: a genuine second accept on the same token succeeds
    const retry = await acceptRoute(mkAccept({ token, password: 'second-attempt-pw2' })) // gitleaks:allow
    expect(retry.status).toBe(200)
  })

  it('when signInEmail fails after the password is already set, tells the invitee to log in normally and logs the failure', async () => {
    const { token, userId } = await makeInvite('signin-fail@test.local')
    const signInSpy = vi.spyOn(getAuth().api, 'signInEmail').mockRejectedValueOnce(new Error('boom'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await acceptRoute(mkAccept({ token, password: 'signin-fail-pw1' }))
    signInSpy.mockRestore()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toContain('로그인')
    expect(errorSpy).toHaveBeenCalledWith(
      'invite_accept_signin_failed',
      expect.objectContaining({ userId, inviteId: expect.any(Number), errorType: 'Error' }),
    )
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('boom')
    errorSpy.mockRestore()
    // the invite is spent and the password IS set — a normal sign-in works
    const real = await getAuth().api.signInEmail({
      returnHeaders: true, body: { email: 'signin-fail@test.local', password: 'signin-fail-pw1' },
    })
    expect(real.headers.get('set-cookie')).toBeTruthy()
  })

  it('forwards every Set-Cookie header intact when better-auth emits more than one', async () => {
    const { token } = await makeInvite('multi-cookie@test.local')
    const fakeHeaders = new Headers()
    fakeHeaders.append('set-cookie', 'better-auth.session_token=abc; Path=/; HttpOnly; Expires=Wed, 21 Oct 2026 07:28:00 GMT')
    fakeHeaders.append('set-cookie', 'better-auth.dont_remember=1; Path=/; HttpOnly; Expires=Wed, 21 Oct 2026 07:28:00 GMT')
    const signInSpy = vi.spyOn(getAuth().api, 'signInEmail')
      .mockResolvedValueOnce({ headers: fakeHeaders } as unknown as SignInEmailResult)
    const res = await acceptRoute(mkAccept({ token, password: 'multi-cookie-pw1' }))
    signInSpy.mockRestore()
    const cookies = res.headers.getSetCookie()
    expect(cookies).toHaveLength(2)
    expect(cookies[0]).toContain('better-auth.session_token=abc')
    expect(cookies[1]).toContain('better-auth.dont_remember=1')
    // proves no comma-join corruption: neither cookie's string contains the other's name
    expect(cookies[0]).not.toContain('dont_remember')
    expect(cookies[1]).not.toContain('session_token')
  })
})

describe('POST /api/v1/invites/consume', () => {
  it('marks used for the invite owner session; 403s another user; 401s anonymous', async () => {
    const { token } = await makeInvite('google-path@test.local')
    // simulate "signed in via Google": set a real password server-side, sign in
    const [u] = await db.select().from(users).where(eq(users.email, 'google-path@test.local'))
    await setPasswordDirect(db, u.id, 'linked-via-g-55')
    const cookie = await loginAs('google-path@test.local', 'linked-via-g-55')
    const other = await loginAs('deckhand@test.local', 'deckhand-pw-123')
    expect((await consumeRoute(mkReq({ token }, other))).status).toBe(403)
    expect((await consumeRoute(mkReq({ token }, cookie))).status).toBe(200)
    const [inv] = await db.select().from(invites).where(eq(invites.tokenHash, hashToken(token)))
    expect(inv.usedAt).not.toBeNull()
    expect((await consumeRoute(mkReq({ token }))).status).toBe(401)
  })

  it('401s a banned user even with a live session and their own invite token', async () => {
    const { token } = await makeInvite('banned-consume@test.local')
    const [u] = await db.select().from(users).where(eq(users.email, 'banned-consume@test.local'))
    await setPasswordDirect(db, u.id, 'banned-consume-pw1')
    const cookie = await loginAs('banned-consume@test.local', 'banned-consume-pw1')
    await db.update(users).set({ banned: true }).where(eq(users.id, u.id))
    expect((await consumeRoute(mkReq({ token }, cookie))).status).toBe(401)
  })

  it('401s a mismatched-Origin request even with a live session and their own invite token', async () => {
    const { token } = await makeInvite('origin-consume@test.local')
    const [u] = await db.select().from(users).where(eq(users.email, 'origin-consume@test.local'))
    await setPasswordDirect(db, u.id, 'origin-consume-pw1')
    const cookie = await loginAs('origin-consume@test.local', 'origin-consume-pw1')
    expect((await consumeRoute(mkReq({ token }, cookie, undefined, 'https://evil.example.com'))).status).toBe(401)
  })

  it('410s an expired invite even for the owner\'s own live session, and does not mark it used', async () => {
    // accept/route.ts's claimInvite already rejects an expired token (410,
    // see the accept describe block above); consume must enforce the exact
    // same rule, or a signed-in owner of an expired invite gets silently let
    // in via Google while the page's own UI is telling them the link is dead.
    const { token } = await makeInvite('expired-consume@test.local')
    const [u] = await db.select().from(users).where(eq(users.email, 'expired-consume@test.local'))
    await setPasswordDirect(db, u.id, 'expired-consume-pw1')
    const cookie = await loginAs('expired-consume@test.local', 'expired-consume-pw1')
    await db.update(invites).set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invites.tokenHash, hashToken(token)))
    const res = await consumeRoute(mkReq({ token }, cookie))
    expect(res.status).toBe(410)
    const [inv] = await db.select().from(invites).where(eq(invites.tokenHash, hashToken(token)))
    expect(inv.usedAt).toBeNull()
  })
})
