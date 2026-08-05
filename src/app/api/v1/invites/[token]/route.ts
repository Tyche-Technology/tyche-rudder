import { getDb } from '@/db/client'
import { getInviteStatus } from '@/lib/invites'
import { inviteToken } from '@/lib/validation'
import { withErrorEnvelope } from '@/lib/with-error-envelope'
import { ok, fail } from '../../respond'

type Ctx = { params: Promise<{ token: string }> }

export const GET = withErrorEnvelope(async (_req: Request, ctx: Ctx) => {
  const { token } = await ctx.params
  if (!inviteToken.safeParse(token).success) return fail('유효하지 않은 초대장입니다', 404)
  const status = await getInviteStatus(getDb(), token)
  if (!status) return fail('유효하지 않은 초대장입니다', 404)
  return ok(status)
})
