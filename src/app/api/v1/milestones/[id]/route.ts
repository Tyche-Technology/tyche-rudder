import { getDb } from '@/db/client'
import { actorFromRequest } from '@/lib/api-auth'
import { withErrorEnvelope } from '@/lib/with-error-envelope'
import { patchMilestoneSchema } from '@/lib/validation'
import { updateMilestone } from '@/domain/catalog'
import type { UserActor } from '@/domain/actor'
import { ok, fail, failParse, unauthorized, requireAdmin, idFromParams, failDomain, readJson, BODY_TOO_LARGE } from '../../respond'

type Ctx = { params: Promise<{ id: string }> }

export const PATCH = withErrorEnvelope(async (req: Request, ctx: Ctx) => {
  const db = getDb()
  const actor = await actorFromRequest(db, req)
  if (!actor) return unauthorized()
  const adminError = requireAdmin(actor)
  if (adminError) return adminError
  const id = await idFromParams(ctx.params)
  if (!id) return fail('마일스톤을 찾을 수 없습니다', 404)
  const raw = await readJson(req)
  if (raw === BODY_TOO_LARGE) return fail('요청 본문이 너무 큽니다', 413)
  const parsed = patchMilestoneSchema.safeParse(raw)
  if (!parsed.success) return failParse(parsed.error)
  const { expectedVersion, ...patch } = parsed.data
  // requireAdmin already confirmed actor.type === 'user' && role === 'admin'.
  const result = await updateMilestone(db, actor as UserActor, id, patch, expectedVersion)
  return result.ok ? ok(result.milestone) : failDomain(result)
})
