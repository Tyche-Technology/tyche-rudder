import { getDb } from '@/db/client'
import { actorFromRequest } from '@/lib/api-auth'
import { withErrorEnvelope } from '@/lib/with-error-envelope'
import { patchIssueSchema } from '@/lib/validation'
import { getIssueDetail, updateIssue } from '@/domain/issues'
import {
  ok, fail, failParse, unauthorized, forbidden, idFromParams, failDomain,
  productExists, userExists, milestoneExists, readJson, BODY_TOO_LARGE,
} from '../../respond'

type Ctx = { params: Promise<{ id: string }> }

export const GET = withErrorEnvelope(async (req: Request, ctx: Ctx) => {
  const db = getDb()
  const actor = await actorFromRequest(db, req)
  if (!actor) return unauthorized()
  const id = await idFromParams(ctx.params)
  if (!id) return fail('이슈를 찾을 수 없습니다', 404)
  const detail = await getIssueDetail(db, id)
  return detail ? ok(detail) : fail('이슈를 찾을 수 없습니다', 404)
})

export const PATCH = withErrorEnvelope(async (req: Request, ctx: Ctx) => {
  const db = getDb()
  const actor = await actorFromRequest(db, req)
  if (!actor) return unauthorized()
  if (actor.type === 'agent') return forbidden()
  const id = await idFromParams(ctx.params)
  if (!id) return fail('이슈를 찾을 수 없습니다', 404)
  const raw = await readJson(req)
  if (raw === BODY_TOO_LARGE) return fail('요청 본문이 너무 큽니다', 413)
  const parsed = patchIssueSchema.safeParse(raw)
  if (!parsed.success) return failParse(parsed.error)
  if (actor.role !== 'admin') {
    const detail = await getIssueDetail(db, id)
    if (!detail) return fail('이슈를 찾을 수 없습니다', 404)
    const requestedFields = Object.keys(parsed.data)
    const allowed = requestedFields.every((f) => f === 'title' || f === 'description' || f === 'expectedVersion')
    if (detail.issue.requesterId !== actor.id || !allowed) return forbidden()
  }
  // Existence checks, not FK-violation translation — see the comment on
  // productExists in respond.ts for why a pre-check is sufficient here.
  if (parsed.data.productId != null && !(await productExists(db, parsed.data.productId))) {
    return fail(`제품을 찾을 수 없습니다: ${parsed.data.productId}`, 422)
  }
  if (parsed.data.assigneeId != null && !(await userExists(db, parsed.data.assigneeId))) {
    return fail(`담당자를 찾을 수 없습니다: ${parsed.data.assigneeId}`, 422)
  }
  if (parsed.data.milestoneId != null && !(await milestoneExists(db, parsed.data.milestoneId))) {
    return fail(`마일스톤을 찾을 수 없습니다: ${parsed.data.milestoneId}`, 422)
  }
  const { expectedVersion, ...patch } = parsed.data
  const result = await updateIssue(db, actor, id, patch, expectedVersion)
  return result.ok ? ok(result.issue) : failDomain(result)
})
