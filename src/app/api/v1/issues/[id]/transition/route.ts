import { getDb } from '@/db/client'
import { actorFromRequest } from '@/lib/api-auth'
import { withErrorEnvelope } from '@/lib/with-error-envelope'
import { transitionSchema } from '@/lib/validation'
import { transitionIssue } from '@/domain/issues'
import { notifyStatusChange } from '@/lib/slack'
import { ok, fail, failParse, unauthorized, requireAdmin, idFromParams, failDomain, readJson, BODY_TOO_LARGE } from '../../../respond'

export const POST = withErrorEnvelope(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const db = getDb()
  const actor = await actorFromRequest(db, req)
  if (!actor) return unauthorized()
  const adminError = requireAdmin(actor)
  if (adminError) return adminError
  const id = await idFromParams(ctx.params)
  if (!id) return fail('이슈를 찾을 수 없습니다', 404)
  const raw = await readJson(req)
  if (raw === BODY_TOO_LARGE) return fail('요청 본문이 너무 큽니다', 413)
  const parsed = transitionSchema.safeParse(raw)
  if (!parsed.success) return failParse(parsed.error)
  const { expectedVersion, ...input } = parsed.data
  const result = await transitionIssue(db, actor, id, input, expectedVersion)
  if (!result.ok) return failDomain(result)
  notifyStatusChange(db, result.issue, result.from) // fire-and-forget — never blocks the response
  return ok(result.issue)
})
