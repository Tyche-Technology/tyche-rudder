import { withErrorEnvelope } from '@/lib/with-error-envelope'
import { isAuthSecretValid } from '@/lib/auth-secret'
import { ok, fail } from '../v1/respond'

// This is a config-validity check, not just liveness. Next 16's production
// server does not reliably crash when register() rejects, so an orchestrator
// must be able to observe a bad BETTER_AUTH_SECRET through the health surface.
export const GET = withErrorEnvelope(async () => {
  if (!isAuthSecretValid(process.env.BETTER_AUTH_SECRET)) return fail('설정 오류', 503)
  return ok({ status: 'sailing' })
})
