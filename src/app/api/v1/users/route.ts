import { asc } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { users } from '@/db/schema'
import { actorFromRequest } from '@/lib/api-auth'
import { withErrorEnvelope } from '@/lib/with-error-envelope'
import { ok, unauthorized } from '../respond'

export const GET = withErrorEnvelope(async (req: Request) => {
  const db = getDb()
  const actor = await actorFromRequest(db, req)
  if (!actor) return unauthorized()
  // The roster stays readable by everyone — assignee pickers on five screens
  // need it. But suspension status and the Slack mapping are not an ordinary
  // crew member's business. Agents count as privileged: a token is minted by
  // whoever has database write access (scripts/create-token inserts directly —
  // the app's admin role is not what gates it), and this endpoint is the only
  // way an agent can resolve a Slack user id to the requesterEmail that POST
  // /api/v1/issues demands, so gating them out here would break issue intake.
  // Note the consequence: a valid agent token is the one remaining key to the
  // full Slack mapping and every crew member's suspension status. Revoke a
  // leaked one with `npm run revoke-token <name>` — actorFromRequest refuses
  // a token whose revoked_at is set.
  const privileged = actor.type === 'agent' || actor.role === 'admin'
  // Explicit column select, never select() — password hashes now live in
  // account (better-auth), not here, but the discipline stands regardless.
  const base = { id: users.id, email: users.email, name: users.name, role: users.role }
  const rows = privileged
    ? await db.select({ ...base, banned: users.banned, slackUserId: users.slackUserId })
      .from(users).orderBy(asc(users.name))
    : await db.select(base).from(users).orderBy(asc(users.name))
  return ok(rows)
})
