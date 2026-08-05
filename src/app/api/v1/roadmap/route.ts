import { getDb } from '@/db/client'
import { actorFromRequest } from '@/lib/api-auth'
import { withErrorEnvelope } from '@/lib/with-error-envelope'
import { getRoadmap } from '@/domain/catalog'
import { ok, unauthorized } from '../respond'

export const GET = withErrorEnvelope(async (req: Request) => {
  const db = getDb()
  if (!(await actorFromRequest(db, req))) return unauthorized()
  return ok(await getRoadmap(db))
})
