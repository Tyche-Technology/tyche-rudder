import { asc } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { milestones } from '@/db/schema'
import { actorFromRequest } from '@/lib/api-auth'
import { withErrorEnvelope } from '@/lib/with-error-envelope'
import { createMilestoneSchema } from '@/lib/validation'
import { createMilestone } from '@/domain/catalog'
import type { UserActor } from '@/domain/actor'
import { ok, fail, failParse, unauthorized, requireAdmin, failDomain, readJson, BODY_TOO_LARGE } from '../respond'

export const GET = withErrorEnvelope(async (req: Request) => {
  const db = getDb()
  if (!(await actorFromRequest(db, req))) return unauthorized()
  return ok(await db.select().from(milestones).orderBy(asc(milestones.name)))
})

export const POST = withErrorEnvelope(async (req: Request) => {
  const db = getDb()
  const actor = await actorFromRequest(db, req)
  if (!actor) return unauthorized()
  const adminError = requireAdmin(actor)
  if (adminError) return adminError
  const raw = await readJson(req)
  if (raw === BODY_TOO_LARGE) return fail('요청 본문이 너무 큽니다', 413)
  const parsed = createMilestoneSchema.safeParse(raw)
  // Was a custom message ('마일스톤 이름을 입력해주세요') — now the generic error, with
  // the field-level detail carried in `issues` instead. Task 16 renders that
  // entry next to the input.
  if (!parsed.success) return failParse(parsed.error)
  // requireAdmin already confirmed actor.type === 'user' && role === 'admin'.
  const result = await createMilestone(db, actor as UserActor, parsed.data)
  return result.ok ? ok(result.milestone, 201) : failDomain(result)
})
