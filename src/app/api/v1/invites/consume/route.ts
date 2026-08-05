import { eq, and } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { invites } from '@/db/schema'
import { actorFromRequest, hashToken } from '@/lib/api-auth'
import { isInviteLive, inviteLiveWhere } from '@/lib/invites'
import { inviteConsumeSchema } from '@/lib/validation'
import { withErrorEnvelope } from '@/lib/with-error-envelope'
import { ok, fail, forbidden, unauthorized, readJson, BODY_TOO_LARGE } from '../../respond'

// Google-path bookkeeping: the invited user signed in via Google (account
// linking) — burn the invite so a later leak of the link can't set a
// password on this account. Routed through actorFromRequest (not a direct
// getAuth().api.getSession() call) so this state-changing, cookie-authed
// route gets the trusted-origin guard and the banned check the same way
// every other authenticated route does — it's the one route that used to
// bypass both.
export const POST = withErrorEnvelope(async (req: Request) => {
  const db = getDb()
  const actor = await actorFromRequest(db, req)
  if (!actor) return unauthorized()
  const raw = await readJson(req)
  if (raw === BODY_TOO_LARGE) return fail('요청 본문이 너무 큽니다', 413)
  const parsed = inviteConsumeSchema.safeParse(raw)
  if (!parsed.success) return fail('입력값이 올바르지 않습니다', 400)
  const [invite] = await db.select().from(invites).where(eq(invites.tokenHash, hashToken(parsed.data.token)))
  if (!invite) return fail('유효하지 않은 초대장입니다', 404)
  if (actor.type !== 'user' || invite.userId !== actor.id) return forbidden()
  // Same expiry+single-use rule accept/claimInvite enforces (invites.ts) —
  // this path previously checked neither, so an expired invite stayed
  // silently consumable via Google while the page's own UI called it dead.
  if (!isInviteLive(invite)) return fail('만료되었거나 이미 사용된 초대장입니다', 410)
  await db.update(invites).set({ usedAt: new Date() })
    .where(and(eq(invites.id, invite.id), inviteLiveWhere()))
  return ok(null)
})
