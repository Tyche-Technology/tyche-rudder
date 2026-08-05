import { eq } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { users } from '@/db/schema'
import { actorFromRequest } from '@/lib/api-auth'
import { withErrorEnvelope } from '@/lib/with-error-envelope'
import { createIssueSchema, listIssuesSchema } from '@/lib/validation'
import { createIssue, listIssues } from '@/domain/issues'
import { notifyNewIssue } from '@/lib/slack'
import { ok, fail, failParse, unauthorized, productExists, readJson, BODY_TOO_LARGE } from '../respond'

export const GET = withErrorEnvelope(async (req: Request) => {
  const db = getDb()
  const actor = await actorFromRequest(db, req)
  if (!actor) return unauthorized()
  const raw = Object.fromEntries(new URL(req.url).searchParams)
  const parsed = listIssuesSchema.safeParse(raw)
  if (!parsed.success) return fail('검색 조건이 올바르지 않습니다', 400)
  const { requester, ...filter } = parsed.data
  const requesterId = requester === 'me' && actor.type === 'user' ? actor.id : undefined
  return ok(await listIssues(db, { ...filter, requesterId }))
})

export const POST = withErrorEnvelope(async (req: Request) => {
  const db = getDb()
  const actor = await actorFromRequest(db, req)
  if (!actor) return unauthorized()
  const raw = await readJson(req)
  if (raw === BODY_TOO_LARGE) return fail('요청 본문이 너무 큽니다', 413)
  const parsed = createIssueSchema.safeParse(raw)
  if (!parsed.success) return failParse(parsed.error)
  const { requesterEmail, ...input } = parsed.data
  if (!(await productExists(db, input.productId))) {
    return fail(`제품을 찾을 수 없습니다: ${input.productId}`, 422)
  }
  let requesterId: number
  if (actor.type === 'agent') {
    if (!requesterEmail) return fail('에이전트 등록에는 requesterEmail이 필요합니다', 400)
    // Only the id escapes, so select only the id — same column discipline the
    // users route states, and this was the last place a user row was loaded
    // wholesale into a request handler.
    const [requester] = await db.select({ id: users.id }).from(users).where(eq(users.email, requesterEmail))
    if (!requester) return fail(`요청자 계정을 찾을 수 없습니다: ${requesterEmail}`, 422)
    requesterId = requester.id
  } else {
    requesterId = actor.id
  }
  const issue = await createIssue(db, actor, { ...input, requesterId })
  notifyNewIssue(issue) // fire-and-forget — never blocks the response (annotate, don't block)
  return ok(issue, 201)
})
