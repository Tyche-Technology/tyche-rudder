import { describe, it, expect, beforeAll, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb } from '../helpers/db'
import { getAuth } from '@/lib/better-auth'
import { users } from '@/db/schema'
import type { Db } from '@/db/client'

let db: Db

beforeAll(async () => {
  // Must be set before the first getAuth() call in this file — buildAuth()
  // only wires up socialProviders.google when both are present, and getAuth()
  // caches its instance for the file's lifetime.
  process.env.GOOGLE_CLIENT_ID ||= 'test-google-client-id'
  process.env.GOOGLE_CLIENT_SECRET ||= 'test-google-client-secret'
  db = await createTestDb()
})

describe('better-auth instance', () => {
  it('creates a user server-side, signs in, and reads the session back', async () => {
    const created = await getAuth().api.createUser({
      body: { email: 'crew@test.local', password: 'anchor-pw-123', name: '갑판원', role: 'user' }, // gitleaks:allow
    })
    expect(Number(created.user.id)).toBeGreaterThan(0)

    const { headers } = await getAuth().api.signInEmail({
      returnHeaders: true,
      body: { email: 'crew@test.local', password: 'anchor-pw-123' }, // gitleaks:allow
    })
    const cookie = headers.get('set-cookie')
    expect(cookie).toBeTruthy()

    const session = await getAuth().api.getSession({
      headers: new Headers({ cookie: cookie! }),
    })
    expect(session?.user.email).toBe('crew@test.local')
    expect(session?.user.role).toBe('user')
  })

  it('rejects a wrong password', async () => {
    await expect(getAuth().api.signInEmail({
      body: { email: 'crew@test.local', password: 'wrong-password' },
    })).rejects.toThrowError()
  })

  it('public email sign-up is disabled', async () => {
    await expect(getAuth().api.signUpEmail({
      body: { email: 'stowaway@test.local', password: 'sneaky-pw-123', name: '밀항자' }, // gitleaks:allow
    })).rejects.toThrowError()
  })

  it('does not expose account impersonation to product admins', async () => {
    await getAuth().api.createUser({
      body: { email: 'limited-admin@test.local', password: 'anchor-pw-123', name: '제한 관리자', role: 'admin' }, // gitleaks:allow
    })
    const { headers } = await getAuth().api.signInEmail({
      returnHeaders: true,
      body: { email: 'limited-admin@test.local', password: 'anchor-pw-123' }, // gitleaks:allow
    })
    const [target] = await db.select({ id: users.id }).from(users).where(eq(users.email, 'crew@test.local'))
    const res = await getAuth().handler(new Request('http://localhost:3000/api/auth/admin/impersonate-user', {
      method: 'POST',
      headers: {
        cookie: headers.get('set-cookie')!,
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ userId: String(target.id) }),
    }))

    expect(res.status).toBe(403)
    expect(res.headers.getSetCookie().some((cookie) => cookie.startsWith('better-auth.session_token='))).toBe(false)
  })

  // Regression coverage for the Critical signup bypass: better-auth's
  // `disableImplicitSignUp` is only a *default* — a caller can flip it back
  // with a client-supplied `requestSignUp: true`. Two independent flags close
  // the two independent code paths that read it; each test below removes one
  // flag, confirms the test fails for the right reason, then restores it
  // (see task-2-bypass-fix-report.md for the paired before/after output).
  it('Google id-token sign-in rejects requestSignUp: true without ever reaching Google', async () => {
    // A syntactically valid JWT *shape* (decodable header with kid+alg) but
    // no real signature — enough to prove where verifyIdToken stops.
    // disableIdTokenSignIn short-circuits before any network call
    // (google.mjs: `if (options.disableIdTokenSignIn) return false`), so the
    // fetch spy staying uncalled is the proof the flag fired, not just that
    // sign-in failed (an invalid token fails for other reasons too).
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('should not reach the network'))
    const fakeIdToken = [
      Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-kid' })).toString('base64url'),
      Buffer.from(JSON.stringify({ sub: 'attacker' })).toString('base64url'),
      'sig',
    ].join('.')

    try {
      await expect(getAuth().api.signInSocial({
        body: { provider: 'google', requestSignUp: true, idToken: { token: fakeIdToken } },
      })).rejects.toThrowError()
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('Google OAuth callback rejects requestSignUp: true for an uninvited account', async () => {
    // Drives the actual mounted callback route (same code path route.ts
    // hits), stubbing only the two calls that would otherwise reach Google
    // (code-for-token exchange, userinfo) on the live provider object
    // better-auth resolved from our config — i.e. exactly what
    // callback.mjs reads, not just our config literal.
    const ctx = await getAuth().$context
    const provider = ctx.socialProviders.find((p: { id: string }) => p.id === 'google')
    if (!provider) throw new Error('google provider not configured — check GOOGLE_CLIENT_ID/SECRET in beforeAll')

    const originalValidate = provider.validateAuthorizationCode
    const originalGetUserInfo = provider.getUserInfo
    provider.validateAuthorizationCode = vi.fn().mockResolvedValue({ accessToken: 'fake-access-token' })
    provider.getUserInfo = vi.fn().mockResolvedValue({
      user: { id: 'attacker-sub', email: 'uninvited@test.local', name: 'Uninvited', emailVerified: true },
    })

    try {
      const { headers: signInHeaders, response } = await getAuth().api.signInSocial({
        returnHeaders: true,
        body: { provider: 'google', requestSignUp: true, callbackURL: '/', disableRedirect: true },
      })
      if (!response.url) throw new Error('signInSocial redirect branch did not return an authorize url')
      const state = new URL(response.url).searchParams.get('state')!
      // storeStateStrategy defaults to "database" for a stateful config
      // (ours has `database:` set): parseState requires BOTH the DB
      // verification row AND this signed state cookie to match — the
      // signed cookie is the CSRF half of the check, so it must be forwarded.
      const stateCookie = signInHeaders.getSetCookie().map((c) => c.split(';')[0]).join('; ')

      const res = await getAuth().handler(new Request(
        `http://localhost:3000/api/auth/callback/google?code=dummy-code&state=${encodeURIComponent(state)}`,
        { headers: { cookie: stateCookie } },
      ))

      // parseState always emits a Set-Cookie clearing the spent state
      // cookie, win or lose — so "any set-cookie" isn't a signal. The
      // decisive checks: no *session* cookie, and no `users` row for the
      // uninvited email (belt-and-suspenders — a redirect assertion alone
      // wouldn't prove a user wasn't created anyway).
      const sessionCookie = res.headers.getSetCookie().find((c) => c.startsWith('better-auth.session_token='))
      expect(sessionCookie).toBeUndefined()
      const rows = await db.select().from(users).where(eq(users.email, 'uninvited@test.local'))
      expect(rows).toHaveLength(0)
    } finally {
      provider.validateAuthorizationCode = originalValidate
      provider.getUserInfo = originalGetUserInfo
    }
  })
})
