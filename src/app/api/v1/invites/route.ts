import { getDb } from '@/db/client'
import { actorFromRequest } from '@/lib/api-auth'
import { createInvite } from '@/lib/invites'
import { inviteCreateSchema } from '@/lib/validation'
import { withErrorEnvelope } from '@/lib/with-error-envelope'
import { ok, fail, unauthorized, requireAdmin, readJson, BODY_TOO_LARGE, failParse, isUniqueViolation } from '../respond'

export const POST = withErrorEnvelope(async (req: Request) => {
  const db = getDb()
  const actor = await actorFromRequest(db, req)
  if (!actor) return unauthorized()
  const adminError = requireAdmin(actor)
  if (adminError) return adminError
  const raw = await readJson(req)
  if (raw === BODY_TOO_LARGE) return fail('요청 본문이 너무 큽니다', 413)
  const parsed = inviteCreateSchema.safeParse(raw)
  if (!parsed.success) return failParse(parsed.error)
  try {
    const { rawToken, userId, expiresAt } = await createInvite(db, { ...parsed.data, invitedBy: actor.id })
    // .origin strips a trailing slash (and any path/query) the same way
    // better-auth normalizes its own baseURL internally
    // (node_modules/better-auth/dist/context/create-context.mjs) — a
    // BETTER_AUTH_URL typo like "https://host/" must not produce
    // "https://host//invite/<token>", which Next's App Router 404s.
    const base = new URL(process.env.BETTER_AUTH_URL ?? new URL(req.url).origin).origin
    return ok({ inviteUrl: `${base}/invite/${rawToken}`, userId, expiresAt }, 201)
  } catch (e) {
    // A genuine race: two concurrent invites for the same brand-new email
    // both miss createInvite's existing-user lookup and both call
    // createUser; the loser hits better-auth's own unique constraint.
    if (isUniqueViolation(e)) return fail('이미 등록된 이메일입니다', 409)
    throw e
  }
})
