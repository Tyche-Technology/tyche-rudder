import { asc } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { products } from '@/db/schema'
import { actorFromRequest } from '@/lib/api-auth'
import { withErrorEnvelope } from '@/lib/with-error-envelope'
import { createProductSchema } from '@/lib/validation'
import { createProduct } from '@/domain/catalog'
import type { UserActor } from '@/domain/actor'
import { ok, fail, failParse, unauthorized, requireAdmin, failDomain, readJson, BODY_TOO_LARGE } from '../respond'

export const GET = withErrorEnvelope(async (req: Request) => {
  const db = getDb()
  if (!(await actorFromRequest(db, req))) return unauthorized()
  return ok(await db.select().from(products).orderBy(asc(products.name)))
})

export const POST = withErrorEnvelope(async (req: Request) => {
  const db = getDb()
  const actor = await actorFromRequest(db, req)
  if (!actor) return unauthorized()
  const adminError = requireAdmin(actor)
  if (adminError) return adminError
  const raw = await readJson(req)
  if (raw === BODY_TOO_LARGE) return fail('요청 본문이 너무 큽니다', 413)
  const parsed = createProductSchema.safeParse(raw)
  // Was a custom message ('제품 이름을 입력해주세요') — now the generic error, with
  // the field-level detail carried in `issues` instead. Task 16 renders that
  // entry next to the input.
  if (!parsed.success) return failParse(parsed.error)
  // requireAdmin already confirmed actor.type === 'user' && role === 'admin'.
  const result = await createProduct(db, actor as UserActor, parsed.data.name)
  return result.ok ? ok(result.product, 201) : failDomain(result)
})
