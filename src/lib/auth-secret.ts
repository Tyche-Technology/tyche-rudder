// The value .env.example ships. A deployment that never changed it is
// unauthenticated, not "weakly configured" — refuse it outright.
export const PLACEHOLDER_SECRET = 'change-me-32-chars-minimum-secret!!'

// 32 chars matches better-auth's own minimum-entropy expectation and the
// old iron-session floor. Shared by getAuth(), instrumentation.ts's boot
// check, and /api/health (deploy rollback polls health — see that route).
export function isAuthSecretValid(secret: string | undefined): boolean {
  return !!secret && secret !== PLACEHOLDER_SECRET && secret.length >= 32
}
