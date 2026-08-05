import { getDb } from '@/db/client'
import { actorFromRequest } from '@/lib/api-auth'
import { withErrorEnvelope } from '@/lib/with-error-envelope'
import { reorderSchema } from '@/lib/validation'
import { reorderIssue } from '@/domain/ordering'
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
  const parsed = reorderSchema.safeParse(raw)
  // Was a custom message ('afterId 또는 beforeId가 필요합니다') — now failParse,
  // whose refine-error still arrives as an issue entry (see validation.ts's
  // reorderSchema.refine), just carried in `issues` instead of `error`.
  if (!parsed.success) return failParse(parsed.error)
  const { expectedVersion, ...target } = parsed.data
  const result = await reorderIssue(db, actor, id, target, expectedVersion)
  return result.ok ? ok(result.issue) : failDomain(result)
})
