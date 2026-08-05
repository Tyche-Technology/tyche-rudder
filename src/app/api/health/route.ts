import { withErrorEnvelope } from '@/lib/with-error-envelope'
import { isAuthSecretValid } from '@/lib/auth-secret'
import { ok, fail } from '../v1/respond'

// Also a config-validity check, not just liveness: the deploy pipeline's
// rollback polls this endpoint (deploy/docker-compose.prod.yml's
// healthcheck, .github/workflows/deploy.yml's wget loop) — it does not, and
// never did, depend on the container process exiting. See
// src/instrumentation.ts's register() comment for why that matters: Next
// 16's production server doesn't reliably crash on a bad BETTER_AUTH_SECRET,
// so this is what actually makes a misconfigured deploy get rolled back.
export const GET = withErrorEnvelope(async () => {
  if (!isAuthSecretValid(process.env.BETTER_AUTH_SECRET)) return fail('설정 오류', 503)
  return ok({ status: 'sailing' })
})
