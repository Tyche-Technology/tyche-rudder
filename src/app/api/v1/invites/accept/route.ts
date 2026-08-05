import { getDb } from '@/db/client'
import { getAuth } from '@/lib/better-auth'
import { isTrustedOrigin } from '@/lib/api-auth'
import { errorType } from '@/lib/error-summary'
import { claimInvite, setPasswordDirect } from '@/lib/invites'
import { inviteAcceptSchema } from '@/lib/validation'
import { withErrorEnvelope } from '@/lib/with-error-envelope'
import { ok, fail, forbidden, readJson, BODY_TOO_LARGE } from '../../respond'

// Pre-auth route (like the old login): opaque 400, no field-level issues.
export const POST = withErrorEnvelope(async (req: Request) => {
  if (!isTrustedOrigin(req)) return forbidden()
  if (req.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    return fail('application/json 요청이 필요합니다', 415)
  }
  const raw = await readJson(req)
  if (raw === BODY_TOO_LARGE) return fail('요청 본문이 너무 큽니다', 413)
  const parsed = inviteAcceptSchema.safeParse(raw)
  if (!parsed.success) return fail('입력값이 올바르지 않습니다', 400)
  const db = getDb()
  // claimInvite + setPasswordDirect share one transaction: if the password
  // write fails, the claim rolls back with it, so the invite stays usable
  // for a legitimate retry instead of being burned with no usable password
  // on either side. The banned/no-email checks still let the claim commit
  // on their own (matches the pre-existing "claim burns, admin re-issues"
  // behavior for those domain rejections) — only setPasswordDirect's own
  // failure is meant to roll back.
  const claimed = await db.transaction(async (tx) => {
    const result = await claimInvite(tx, parsed.data.token)
    if (result === 'not-found' || result === 'gone' || result.user.banned || !result.user.email) return result
    await setPasswordDirect(tx, result.user.id, parsed.data.password)
    return result
  })
  if (claimed === 'not-found') return fail('유효하지 않은 초대장입니다', 404)
  if (claimed === 'gone') return fail('만료되었거나 이미 사용된 초대장입니다', 410)
  const { user, invite } = claimed
  if (user.banned) return fail('비활성화된 계정입니다', 403)
  if (!user.email) return fail('계정에 이메일이 설정되어 있지 않습니다', 500)
  // The claim and password write are already committed here — signInEmail
  // runs on better-auth's own connection and can't join that transaction.
  // If it throws, the account isn't bricked (the password IS set, a normal
  // login works), but the invite link is spent either way, so a generic 500
  // (which the accept page would read as "retry this link") would send the
  // invitee somewhere that can't help them. Tell them to sign in normally
  // instead, and log the failure since nothing else makes this observable.
  try {
    const { headers } = await getAuth().api.signInEmail({
      returnHeaders: true, body: { email: user.email, password: parsed.data.password },
    })
    const res = ok({ id: user.id, email: user.email, name: user.name, role: user.role })
    headers.getSetCookie().forEach((c) => { res.headers.append('set-cookie', c) })
    return res
  } catch (error) {
    console.error('invite_accept_signin_failed', { userId: user.id, inviteId: invite.id, errorType: errorType(error) })
    return fail('비밀번호가 설정되었습니다. 로그인 페이지에서 다시 로그인해주세요.', 200)
  }
})
