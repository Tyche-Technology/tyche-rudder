import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin } from 'better-auth/plugins'
import { defaultAc } from 'better-auth/plugins/admin/access'
import { getDb } from '@/db/client'
import { isAuthSecretValid } from './auth-secret'

const adminRole = defaultAc.newRole({ user: ['set-role', 'ban'], session: [] })
const userRole = defaultAc.newRole({ user: [], session: [] })

// buildAuth (not `betterAuth` itself) is what ReturnType below captures —
// `ReturnType<typeof betterAuth>` alone resolves to the generic default
// `Auth<BetterAuthOptions>`, which the admin plugin's actual (narrower)
// api/field types aren't assignable to or from. Naming the call site gives
// `cached` the real instantiated type instead.
function buildAuth() {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!isAuthSecretValid(secret)) throw new Error('BETTER_AUTH_SECRET not configured')
  const googleId = process.env.GOOGLE_CLIENT_ID
  const googleSecret = process.env.GOOGLE_CLIENT_SECRET
  return betterAuth({
    secret,
    baseURL: process.env.BETTER_AUTH_URL,
    database: drizzleAdapter(getDb(), { provider: 'pg' }),
    // Serial integer ids — every existing FK (issues.assignee_id, …) stays.
    advanced: { database: { generateId: 'serial' } },
    emailAndPassword: { enabled: true, disableSignUp: true },
    // Conditional value on a single always-present key (not a conditionally
    // spread fragment) — spreading a ternary-typed object distributes over
    // the union and TS infers the whole betterAuth() argument as a union,
    // which silently drops the admin plugin's api/field types.
    socialProviders: googleId && googleSecret
      ? {
          google: {
            clientId: googleId,
            clientSecret: googleSecret,
            // An uninvited Google account must never mint a user — invited
            // users already exist (created at invite time), so sign-in only
            // ever links/opens sessions for them. disableSignUp and
            // disableIdTokenSignIn are the two flags doing the actual work —
            // each closes one of the two reachable paths:
            // - disableSignUp is ORed in last (`callback.mjs`'s
            //   `disableImplicitSignUp && !requestSignUp || options.disableSignUp`),
            //   so `true` here can't be overridden by `requestSignUp` and
            //   unconditionally closes the OAuth-redirect callback branch.
            // - disableIdTokenSignIn closes the separate idToken branch,
            //   which `disableSignUp` cannot reach: that branch reads the
            //   top-level `provider.disableSignUp`, which better-auth never
            //   populates for built-in providers (only
            //   `disableImplicitSignUp` gets copied to the top level) — so
            //   without this flag the idToken branch stays open regardless
            //   of the other two.
            // disableImplicitSignUp is kept as defense in depth, not because
            // it does anything today: given disableSignUp: true, the OR
            // above short-circuits to `true` regardless of what
            // disableImplicitSignUp evaluates to, and the idToken branch
            // never reads it at all — it's inert under the currently
            // installed better-auth. It's the flag the redirect branch would
            // fall back to if a future version changes which key that OR
            // consults. On its own it would not be enough: a caller can
            // flip it back with `requestSignUp: true` in the request body
            // (better-auth reads that straight off the client, no auth
            // check) — which is the whole bug the other two flags close.
            disableImplicitSignUp: true,
            disableSignUp: true,
            disableIdTokenSignIn: true,
          },
        }
      : undefined,
    // Google verifies emails, so linking to the invited (pre-created) user
    // by email match is safe; this is the whole Google-path gate.
    account: { accountLinking: { enabled: true, trustedProviders: ['google'] } },
    user: {
      modelName: 'users',
      // input: false makes the self-service /update-user route reject this
      // field (schema.mjs:65 — any signed-in user can reach that route through
      // the catch-all handler). Only admins set the Slack↔Rudder identity
      // link, via admin/update-user, which skips parseUserInput entirely
      // (plugins/admin/routes.mjs:302) and is therefore unaffected. Output is
      // untouched — the session still carries slackUserId.
      additionalFields: { slackUserId: { type: 'string', required: false, input: false } },
    },
    // No cookieCache: role/banned must be DB-fresh per request (api-auth invariant).
    // Rate limiting: better-auth's built-in limiter is enabled by default in
    // production for its own endpoints — sign-in's own default rule is a
    // strict 3 requests/10s (node_modules/better-auth/dist/api/rate-limiter's
    // getDefaultSpecialRules), a real anti-brute-force control, not a bug.
    // Our invite-accept route's defense is the 256-bit token, not a limiter.
    // DISABLE_AUTH_RATE_LIMIT is a narrow, explicit, off-by-default escape
    // hatch for the e2e suite only (set in tests/e2e/helpers.ts's E2E_ENV):
    // the suite runs the real production server (`next start`) specifically
    // to exercise this exact code path, so gating on NODE_ENV would also
    // disable it for real prod. `undefined` (every environment except e2e,
    // including dev/vitest/a real deploy) falls through to better-auth's own
    // `?? isProduction` default unchanged — only the literal string 'true'
    // forces it off.
    rateLimit: { enabled: process.env.DISABLE_AUTH_RATE_LIMIT === 'true' ? false : undefined },
    plugins: [admin({ roles: { admin: adminRole, user: userRole } })],
  })
}

let cached: ReturnType<typeof buildAuth> | null = null

// Lazy for the same reason getDb() is: tests inject a PGlite Db before the
// first call. vitest isolates module state per test file, so each file gets
// a fresh instance over its own test db.
export function getAuth() {
  if (!cached) cached = buildAuth()
  return cached
}
