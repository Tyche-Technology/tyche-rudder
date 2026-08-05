import { getDb } from '@/db/client'
import { actorFromRequest } from '@/lib/api-auth'
import { withErrorEnvelope } from '@/lib/with-error-envelope'
import { relationSchema } from '@/lib/validation'
import { addRelation, removeRelation } from '@/domain/collab'
import {
  ok, fail, failParse, unauthorized, requireAdmin, idFromParams, idFromQuery, failDomain, readJson, BODY_TOO_LARGE,
} from '../../../respond'

type Ctx = { params: Promise<{ id: string }> }

export const POST = withErrorEnvelope(async (req: Request, ctx: Ctx) => {
  const db = getDb()
  const actor = await actorFromRequest(db, req)
  if (!actor) return unauthorized()
  const adminError = requireAdmin(actor)
  if (adminError) return adminError
  const id = await idFromParams(ctx.params)
  if (!id) return fail('이슈를 찾을 수 없습니다', 404)
  const raw = await readJson(req)
  if (raw === BODY_TOO_LARGE) return fail('요청 본문이 너무 큽니다', 413)
  const parsed = relationSchema.safeParse(raw)
  if (!parsed.success) return failParse(parsed.error)
  const result = await addRelation(db, actor, id, parsed.data.relatedIssueId, parsed.data.kind)
  return result.ok ? ok(null, 201) : failDomain(result)
})

export const DELETE = withErrorEnvelope(async (req: Request, ctx: Ctx) => {
  const db = getDb()
  const actor = await actorFromRequest(db, req)
  if (!actor) return unauthorized()
  const adminError = requireAdmin(actor)
  if (adminError) return adminError
  const id = await idFromParams(ctx.params)
  if (!id) return fail('이슈를 찾을 수 없습니다', 404)
  const relationId = idFromQuery(req.url, 'relationId')
  if (!relationId) return fail('relationId가 필요합니다', 400)
  // issueId is part of removeRelation's own WHERE clause (atomic), so a
  // relation that belongs to a different issue than :id simply isn't found.
  const result = await removeRelation(db, actor, id, relationId)
  return result.ok ? ok(null) : failDomain(result)
})
