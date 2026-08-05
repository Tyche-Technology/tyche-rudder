import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { apiTokens, users } from '@/db/schema'
import type { Db } from '@/db/client'
import type { Actor } from '@/domain/actor'
import { getAuth } from './better-auth'

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

// Defense against a hostile *same-site* origin (e.g. a sibling subdomain
// sharing our cookie jar under SameSite=Lax) making a state-changing request
// with our cookie attached. Classic cross-site POSTs are already blocked by
// SameSite=Lax withholding the cookie entirely, so this only ever matters
// once a request already carries it.
//
// Only cookie-bearing, state-changing (non-GET/HEAD/OPTIONS) requests are
// checked — a Bearer-token agent request carries no ambient credential to
// steal, and a GET can't mutate anything, so neither is this guard's
// business. Fail-closed: a request with no Origin header is rejected the
// same as a mismatched one. The only clients that carry cookies here are
// browsers, and browsers always attach Origin to state-changing requests —
// agent callers use Bearer tokens and are exempt from this guard entirely,
// so there is no legitimate caller this rejects. If that assumption is ever
// wrong, the failure mode is a visible 401, not a silent hole. Trust root
// mirrors src/app/api/v1/invites/route.ts's own BETTER_AUTH_URL-or-request-
// origin fallback, not a new config surface.
export function isTrustedOrigin(req: Request): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return false
  const trusted = process.env.BETTER_AUTH_URL ?? new URL(req.url).origin
  try {
    return new URL(origin).origin === new URL(trusted).origin
  } catch {
    return false // an Origin header that isn't even a parseable URL is never legitimate
  }
}

function isTrustedRequestOrigin(req: Request): boolean {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return true
  if (!req.headers.get('cookie')) return true // no ambient credential to protect
  return isTrustedOrigin(req)
}

export async function actorFromRequest(db: Db, req: Request): Promise<Actor | null> {
  const header = req.headers.get('authorization')
  if (header && header.slice(0, 7).toLowerCase() === 'bearer ') {
    const [token] = await db.select().from(apiTokens)
      .where(eq(apiTokens.tokenHash, hashToken(header.slice(7))))
    // revokedAt, not row deletion: comments/issue_events/attachments reference
    // api_tokens ON DELETE restrict, so the first thing an agent writes pins
    // its token row forever. Checked before lastUsedAt is touched — a revoked
    // token was never "used", it was refused.
    if (!token || token.revokedAt) return null
    await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, token.id)).catch(() => null)
    return { type: 'agent', id: token.id }
  }
  if (!isTrustedRequestOrigin(req)) return null
  // Role/banned come from the DB via better-auth's DB-backed session (no
  // cookieCache) — a demoted or banned user loses authority immediately.
  // getAuth() throws on a missing/placeholder secret → withErrorEnvelope 500
  // (server fault); a garbage cookie just yields a null session → 401.
  const session = await getAuth().api.getSession({ headers: req.headers })
  if (!session || session.user.banned) return null
  return { type: 'user', id: Number(session.user.id), role: session.user.role === 'admin' ? 'admin' : 'user' }
}
