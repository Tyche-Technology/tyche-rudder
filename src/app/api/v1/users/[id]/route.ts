import { eq } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { users } from '@/db/schema'
import { actorFromRequest } from '@/lib/api-auth'
import { updateSlackUserIdSchema } from '@/lib/validation'
import { withErrorEnvelope } from '@/lib/with-error-envelope'
import { ok, fail, unauthorized, idFromParams, readJson, BODY_TOO_LARGE, requireAdmin } from '../../respond'

type Ctx = { params: Promise<{ id: string }> }

export const PATCH = withErrorEnvelope(async (req: Request, ctx: Ctx) => {
  const db = getDb()
  const actor = await actorFromRequest(db, req)
  if (!actor) return unauthorized()
  const denied = requireAdmin(actor)
  if (denied) return denied
  const id = await idFromParams(ctx.params)
  if (!id) return fail('사용자를 찾을 수 없습니다', 404)
  const raw = await readJson(req)
  if (raw === BODY_TOO_LARGE) return fail('요청 본문이 너무 큽니다', 413)
  const parsed = updateSlackUserIdSchema.safeParse(raw)
  if (!parsed.success) return fail('슬랙 사용자 ID 형식이 올바르지 않습니다', 400)
  const [user] = await db.update(users).set({ slackUserId: parsed.data.slackUserId })
    .where(eq(users.id, id)).returning({ id: users.id, slackUserId: users.slackUserId })
  if (!user) return fail('사용자를 찾을 수 없습니다', 404)
  return ok(user)
})
