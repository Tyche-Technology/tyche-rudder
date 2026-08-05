import { getDb } from '@/db/client'
import { actorFromRequest } from '@/lib/api-auth'
import { withErrorEnvelope } from '@/lib/with-error-envelope'
import { commentSchema } from '@/lib/validation'
import { addComment } from '@/domain/collab'
import { ok, fail, failParse, unauthorized, forbidden, idFromParams, failDomain, readJson, BODY_TOO_LARGE } from '../../../respond'

export const POST = withErrorEnvelope(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const db = getDb()
  const actor = await actorFromRequest(db, req)
  if (!actor) return unauthorized()
  if (actor.type === 'agent') return forbidden() // 도선사 댓글은 spec §10 이후
  const id = await idFromParams(ctx.params)
  if (!id) return fail('이슈를 찾을 수 없습니다', 404)
  const raw = await readJson(req)
  if (raw === BODY_TOO_LARGE) return fail('요청 본문이 너무 큽니다', 413)
  const parsed = commentSchema.safeParse(raw)
  // Was a custom message ('댓글 내용을 입력해주세요') — now the generic error, with
  // the field-level detail carried in `issues` instead. Task 16 renders that
  // entry next to the input.
  if (!parsed.success) return failParse(parsed.error)
  const result = await addComment(db, actor, id, parsed.data.body)
  return result.ok ? ok(result.comment, 201) : failDomain(result)
})
