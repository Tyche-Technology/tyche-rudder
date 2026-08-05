# Rudder Auth Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the IT-Portal-backed iron-session auth with better-auth: admin-invite-only registration (copy-link), Google login, and email+password login.

**Architecture:** better-auth (drizzle adapter, serial integer ids) owns users/sessions/accounts; a small app-owned `invites` table + three routes implement copy-link invites; `actorFromRequest`'s session branch swaps to `auth.api.getSession` while the agent Bearer-token branch is untouched. Old auth (IT Portal, iron-session, portalId) is torn down last so every task stays green.

**Tech Stack:** Next.js 16 app router, better-auth (latest 1.6.x), drizzle-orm + postgres-js (PGlite in tests), vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-04-auth-redesign-design.md`

## Global Constraints

- User ids stay **serial integers** (`advanced.database.generateId: 'serial'`) — existing integer FKs must not change.
- Public sign-up is impossible: `emailAndPassword.disableSignUp: true`, google `disableImplicitSignUp: true`. Users exist only via invite (`auth.api.createUser`) or the seed-admin script.
- All `/api/v1/*` responses keep the `{ ok: true, data }` / `{ ok: false, error }` envelope with Korean error messages.
- Role must be DB-fresh per request: session `cookieCache` stays disabled; never trust a role read from a cookie.
- Do NOT use the `nextCookies()` better-auth plugin — our routes forward `set-cookie` manually (`returnHeaders: true`) so they stay testable in vitest outside Next's request pipeline.
- New env: `BETTER_AUTH_SECRET` (≥32 chars, placeholder refused), `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (optional — google provider is conditionally configured). Removed at teardown: `SESSION_SECRET`, `IT_PORTAL_LOGIN_URL`.
- Tests: `npm test` (vitest, excludes e2e). Single file: `npx vitest run tests/api/foo.test.ts`. Commit after every green task.
- UI copy is Korean; follow PRD §7 nautical tone (product terms stay standard where usability wins).
- Mid-branch (T6–T7) the deployed-UI/e2e flow is intentionally broken (old login deleted before new UI lands); e2e is repaired in T11. Do not merge before T11.

---

### Task 1: better-auth dependency + additive schema + migration

**Files:**
- Modify: `package.json` (add better-auth)
- Modify: `src/db/schema.ts`
- Create: `drizzle/0007_*.sql` (via `npm run db:generate`)
- Modify: `tests/helpers/db.ts`
- Test: `tests/domain/schema-auth.test.ts` (new)

**Interfaces:**
- Produces: drizzle tables `session`, `account`, `verification`, `invites`; `users` gains `email` (unique, nullable until T10), `emailVerified`, `image`, `updatedAt`, `banned`, `banReason`, `banExpires`. `portalId`/`passwordHash` REMAIN until Task 10.
- Produces: `seedUser(db, overrides)` now also fills `email` (`u-<rand>@test.local`).

- [ ] **Step 1: Install better-auth**

```bash
npm install better-auth
```

- [ ] **Step 2: Write the failing test**

`tests/domain/schema-auth.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { createTestDb, seedUser } from '../helpers/db'
import { invites, session, account, verification } from '@/db/schema'
import type { Db } from '@/db/client'

let db: Db

beforeAll(async () => { db = await createTestDb() })

describe('auth schema (additive)', () => {
  it('users carries email + better-auth columns; seedUser fills email', async () => {
    const user = await seedUser(db)
    expect(user.email).toMatch(/@test\.local$/)
    expect(user.emailVerified).toBe(false)
    expect(user.banned).toBe(false)
  })

  it('invites roundtrip with FK to users', async () => {
    const admin = await seedUser(db, { role: 'admin' })
    const invitee = await seedUser(db)
    const [row] = await db.insert(invites).values({
      tokenHash: 'a'.repeat(64), userId: invitee.id, invitedBy: admin.id,
      expiresAt: new Date(Date.now() + 7 * 86400_000),
    }).returning()
    expect(row.usedAt).toBeNull()
  })

  it('session/account/verification tables exist with integer user FKs', async () => {
    const user = await seedUser(db)
    const [s] = await db.insert(session).values({
      token: 't-1', userId: user.id, expiresAt: new Date(Date.now() + 86400_000),
    }).returning()
    expect(s.userId).toBe(user.id)
    const [a] = await db.insert(account).values({
      accountId: String(user.id), providerId: 'credential', userId: user.id,
    }).returning()
    expect(a.providerId).toBe('credential')
    const [v] = await db.insert(verification).values({
      identifier: 'x', value: 'y', expiresAt: new Date(Date.now() + 3600_000),
    }).returning()
    expect(v.identifier).toBe('x')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/domain/schema-auth.test.ts`
Expected: FAIL — `invites`/`session` etc. not exported from `@/db/schema`.

- [ ] **Step 4: Extend `src/db/schema.ts` (additive only)**

Add to the existing `users` table (keep `portalId`, `passwordHash`, `role` enum, `slackUserId`, `createdAt` untouched):

```ts
  email: text('email').unique(), // NOT NULL deferred to Task 10 (portalId still live)
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  banned: boolean('banned').notNull().default(false),
  banReason: text('ban_reason'),
  banExpires: timestamp('ban_expires'),
```

New tables (better-auth default model names — singular; column names camelCase→snake_case like the rest of the schema):

```ts
export const session = pgTable('session', {
  id: serial('id').primaryKey(),
  token: text('token').notNull().unique(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  impersonatedBy: text('impersonated_by'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const account = pgTable('account', {
  id: serial('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const verification = pgTable('verification', {
  id: serial('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const invites = pgTable('invites', {
  id: serial('id').primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  invitedBy: integer('invited_by').notNull().references(() => users.id),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})
```

In `tests/helpers/db.ts`, extend `seedUser`'s defaults:

```ts
.values({
  portalId: `user-${Math.random().toString(36).slice(2, 8)}`,
  email: `u-${Math.random().toString(36).slice(2, 8)}@test.local`,
  name: '테스트 유저',
  ...overrides,
})
```

- [ ] **Step 5: Generate the migration**

Run: `npm run db:generate`
Expected: new `drizzle/0007_*.sql` containing `ALTER TABLE "users" ADD COLUMN "email"...` and 4 `CREATE TABLE`s. Inspect it — no DROPs, no changes to existing columns.

- [ ] **Step 6: Run tests to verify green**

Run: `npx vitest run tests/domain/schema-auth.test.ts && npm test`
Expected: new file PASS; full suite PASS (additive change breaks nothing).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/db/schema.ts drizzle tests
git commit -m "feat: additive auth schema — email on users, session/account/verification/invites tables"
```

---

### Task 2: better-auth server instance + handler mount + secret module

**Files:**
- Create: `src/lib/auth-secret.ts`
- Create: `src/lib/better-auth.ts`
- Create: `src/app/api/auth/[...all]/route.ts`
- Modify: `tests/helpers/db.ts` (test secret env), `.env.example`
- Test: `tests/api/better-auth.test.ts` (new)

**Interfaces:**
- Consumes: Task 1 tables.
- Produces: `getAuth(): ReturnType<typeof betterAuth>` (lazy singleton; throws `'BETTER_AUTH_SECRET not configured'` on missing/placeholder/short secret). `isAuthSecretValid(secret: string | undefined): boolean` and `PLACEHOLDER_SECRET` from `auth-secret.ts` (same semantics `session.ts` had). Later tasks call `getAuth().api.createUser / setUserPassword / signInEmail / getSession`.

- [ ] **Step 1: Write the failing test**

`tests/api/better-auth.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { createTestDb } from '../helpers/db'
import { getAuth } from '@/lib/better-auth'

beforeAll(async () => { await createTestDb() })

describe('better-auth instance', () => {
  it('creates a user server-side, signs in, and reads the session back', async () => {
    const created = await getAuth().api.createUser({
      body: { email: 'crew@test.local', password: 'anchor-pw-123', name: '갑판원', role: 'user' }, // gitleaks:allow
    })
    expect(Number(created.user.id)).toBeGreaterThan(0)

    const { headers } = await getAuth().api.signInEmail({
      returnHeaders: true,
      body: { email: 'crew@test.local', password: 'anchor-pw-123' }, // gitleaks:allow
    })
    const cookie = headers.get('set-cookie')
    expect(cookie).toBeTruthy()

    const session = await getAuth().api.getSession({
      headers: new Headers({ cookie: cookie! }),
    })
    expect(session?.user.email).toBe('crew@test.local')
    expect(session?.user.role).toBe('user')
  })

  it('rejects a wrong password', async () => {
    await expect(getAuth().api.signInEmail({
      body: { email: 'crew@test.local', password: 'wrong-password' },
    })).rejects.toThrowError()
  })

  it('public email sign-up is disabled', async () => {
    await expect(getAuth().api.signUpEmail({
      body: { email: 'stowaway@test.local', password: 'sneaky-pw-123', name: '밀항자' }, // gitleaks:allow
    })).rejects.toThrowError()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/better-auth.test.ts`
Expected: FAIL — `@/lib/better-auth` does not exist.

- [ ] **Step 3: Implement**

`src/lib/auth-secret.ts` (ports `session.ts`'s check verbatim, new env name):

```ts
// The value .env.example ships. A deployment that never changed it is
// unauthenticated, not "weakly configured" — refuse it outright.
export const PLACEHOLDER_SECRET = 'change-me-32-chars-minimum-secret!!'

// 32 chars matches better-auth's own minimum-entropy expectation and the
// old iron-session floor. Shared by getAuth(), instrumentation.ts's boot
// check, and /api/health (deploy rollback polls health — see that route).
export function isAuthSecretValid(secret: string | undefined): boolean {
  return !!secret && secret !== PLACEHOLDER_SECRET && secret.length >= 32
}
```

`src/lib/better-auth.ts`:

```ts
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin } from 'better-auth/plugins'
import { getDb } from '@/db/client'
import { isAuthSecretValid } from './auth-secret'

let cached: ReturnType<typeof betterAuth> | null = null

// Lazy for the same reason getDb() is: tests inject a PGlite Db before the
// first call. vitest isolates module state per test file, so each file gets
// a fresh instance over its own test db.
export function getAuth() {
  if (cached) return cached
  const secret = process.env.BETTER_AUTH_SECRET
  if (!isAuthSecretValid(secret)) throw new Error('BETTER_AUTH_SECRET not configured')
  const google = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? {
        socialProviders: {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            // An uninvited Google account must never mint a user — invited
            // users already exist (created at invite time), so sign-in only
            // ever links/opens sessions for them.
            disableImplicitSignUp: true,
          },
        },
      }
    : {}
  cached = betterAuth({
    secret,
    baseURL: process.env.BETTER_AUTH_URL,
    database: drizzleAdapter(getDb(), { provider: 'pg' }),
    // Serial integer ids — every existing FK (issues.assignee_id, …) stays.
    advanced: { database: { generateId: 'serial' } },
    emailAndPassword: { enabled: true, disableSignUp: true },
    ...google,
    // Google verifies emails, so linking to the invited (pre-created) user
    // by email match is safe; this is the whole Google-path gate.
    account: { accountLinking: { enabled: true, trustedProviders: ['google'] } },
    user: {
      modelName: 'users',
      additionalFields: { slackUserId: { type: 'string', required: false } },
    },
    // No cookieCache: role/banned must be DB-fresh per request (api-auth invariant).
    // Rate limiting: better-auth's built-in limiter is enabled by default in
    // production for its own endpoints (sign-in etc.) — no config needed.
    // Our invite-accept route's defense is the 256-bit token, not a limiter.
    plugins: [admin()],
  })
  return cached
}
```

`src/app/api/auth/[...all]/route.ts`:

```ts
import { getAuth } from '@/lib/better-auth'

// Lazy per-request lookup (not toNextJsHandler at module scope) so importing
// the route in tests/builds doesn't construct the auth instance eagerly.
const handler = (req: Request) => getAuth().handler(req)
export { handler as GET, handler as POST }
```

`tests/helpers/db.ts` — first line of `createTestDb()`:

```ts
process.env.BETTER_AUTH_SECRET ||= 'vitest-only-secret-0123456789abcdef!!'
```

`.env.example` — add (keep existing keys for now):

```
BETTER_AUTH_SECRET=change-me-32-chars-minimum-secret!!
BETTER_AUTH_URL=http://localhost:3000
# Google OAuth (optional in dev — login page's Google button errors politely without it)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

- [ ] **Step 4: Verify hand-written schema against the CLI's expectation**

Run: `npx @better-auth/cli generate --config src/lib/better-auth.ts --output /tmp/ba-schema.ts -y || true` then diff mentally against `src/db/schema.ts`.
Expected: same tables/columns (names may be camelCase in CLI output — our snake_case column names with matching drizzle property names are what the adapter uses). Reconcile any column the CLI expects that Task 1 missed (add + regenerate migration in this task if so).

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/api/better-auth.test.ts && npm test`
Expected: PASS. Note: if `createUser` requires a `password` in the installed version, this test passes one — that is also what Task 3's invite flow does (random unusable password), so no divergence.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth-secret.ts src/lib/better-auth.ts 'src/app/api/auth/[...all]' tests .env.example
git commit -m "feat: better-auth instance (drizzle, serial ids, admin plugin) + handler mount"
```

---

### Task 3: invite creation — domain + POST /api/v1/invites

**Files:**
- Create: `src/lib/invites.ts`
- Create: `src/app/api/v1/invites/route.ts`
- Modify: `src/lib/validation.ts`
- Test: `tests/api/invites.test.ts` (new)

**Interfaces:**
- Consumes: `getAuth()` (Task 2), `hashToken(raw)` from `@/lib/api-auth`, `actorFromRequest`, `ok/fail/forbidden/unauthorized/readJson/BODY_TOO_LARGE` from respond.ts.
- Produces: `createInvite(db, input: { email: string; name: string; role: 'admin' | 'user'; invitedBy: number }): Promise<{ rawToken: string; userId: number; expiresAt: Date }>` — creates the user if new (random unusable password), invalidates that user's unused invites if re-issuing. `INVITE_TTL_MS = 7 * 86400_000`. Route `POST /api/v1/invites` → `{ ok: true, data: { inviteUrl, userId, expiresAt } }`.
- Produces: `inviteCreateSchema` in validation.ts: `{ email: z.email().max(254), name: z.string().min(1).max(100), role: z.enum(['admin', 'user']).default('user') }`.

- [ ] **Step 1: Write the failing test**

`tests/api/invites.test.ts` (create-route half; accept tests arrive in Task 4):

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb } from '../helpers/db'
import { getAuth } from '@/lib/better-auth'
import { invites, users, apiTokens } from '@/db/schema'
import { hashToken } from '@/lib/api-auth'
import type { Db } from '@/db/client'
import { POST as createRoute } from '@/app/api/v1/invites/route'

let db: Db
let adminCookie: string

async function loginAs(email: string, password: string): Promise<string> {
  const { headers } = await getAuth().api.signInEmail({ returnHeaders: true, body: { email, password } })
  return headers.get('set-cookie')!
}

function mkReq(body: unknown, cookie?: string, bearer?: string) {
  return new Request('http://x/api/v1/invites', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

beforeAll(async () => {
  db = await createTestDb()
  await getAuth().api.createUser({ body: { email: 'captain@test.local', password: 'captain-pw-123', name: '선장', role: 'admin' } })
  await getAuth().api.createUser({ body: { email: 'deckhand@test.local', password: 'deckhand-pw-123', name: '갑판원', role: 'user' } })
  await db.insert(apiTokens).values({ name: '에이전트', tokenHash: hashToken('rud_invite_test_token') })
  adminCookie = await loginAs('captain@test.local', 'captain-pw-123')
})

describe('POST /api/v1/invites', () => {
  it('201s for an admin: creates the user (role applied) and returns a one-time link', async () => {
    const res = await createRoute(mkReq({ email: 'new@test.local', name: '신입', role: 'user' }, adminCookie))
    expect(res.status).toBe(201)
    const { data } = await res.json()
    expect(data.inviteUrl).toMatch(/\/invite\/[0-9a-f]{64}$/)
    const [user] = await db.select().from(users).where(eq(users.email, 'new@test.local'))
    expect(user.role).toBe('user')
    expect(data.userId).toBe(user.id)
    // raw token never stored
    const token = data.inviteUrl.split('/').pop()!
    const [inv] = await db.select().from(invites).where(eq(invites.userId, user.id))
    expect(inv.tokenHash).toBe(hashToken(token))
    expect(inv.tokenHash).not.toBe(token)
  })

  it('re-issue for an existing email: no duplicate user, old unused invite replaced', async () => {
    const first = await createRoute(mkReq({ email: 'again@test.local', name: '재발급' }, adminCookie))
    const second = await createRoute(mkReq({ email: 'again@test.local', name: '재발급' }, adminCookie))
    expect(second.status).toBe(201)
    const rows = await db.select().from(users).where(eq(users.email, 'again@test.local'))
    expect(rows).toHaveLength(1)
    const invRows = await db.select().from(invites).where(eq(invites.userId, rows[0].id))
    expect(invRows).toHaveLength(1) // old unused invite deleted
    const firstToken = (await first.json()).data.inviteUrl.split('/').pop()!
    expect(invRows[0].tokenHash).not.toBe(hashToken(firstToken))
  })

  it('403s a non-admin user and an agent token; 401s anonymous', async () => {
    const userCookie = await loginAs('deckhand@test.local', 'deckhand-pw-123')
    expect((await createRoute(mkReq({ email: 'x@test.local', name: 'x' }, userCookie))).status).toBe(403)
    expect((await createRoute(mkReq({ email: 'x@test.local', name: 'x' }, undefined, 'rud_invite_test_token'))).status).toBe(403)
    expect((await createRoute(mkReq({ email: 'x@test.local', name: 'x' }))).status).toBe(401)
  })

  it('400s invalid email', async () => {
    expect((await createRoute(mkReq({ email: 'not-an-email', name: 'x' }, adminCookie))).status).toBe(400)
  })
})
```

NOTE: this test authenticates the admin with a REAL better-auth session cookie — but `actorFromRequest` still reads iron-session until Task 6. To keep this task green before the cutover, the invites route must resolve the actor via better-auth directly (see Step 3) instead of `actorFromRequest`; Task 6 swaps it back to `actorFromRequest` (one-line change there, covered by this same test).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/invites.test.ts`
Expected: FAIL — route module missing.

- [ ] **Step 3: Implement**

`src/lib/invites.ts`:

```ts
import { randomBytes } from 'node:crypto'
import { eq, isNull, and } from 'drizzle-orm'
import { invites, users } from '@/db/schema'
import { hashToken } from '@/lib/api-auth'
import { getAuth } from '@/lib/better-auth'
import type { Db } from '@/db/client'

export const INVITE_TTL_MS = 7 * 86400_000

// Invite = the user record exists from this moment. New users get a random
// password nobody knows (better-auth requires one; it is unusable until the
// invitee sets a real one via the accept flow — which doubles as the reset
// mechanism). Re-issuing for an existing email replaces that user's unused
// invites and never duplicates the user.
export async function createInvite(
  db: Db,
  input: { email: string; name: string; role: 'admin' | 'user'; invitedBy: number },
): Promise<{ rawToken: string; userId: number; expiresAt: Date }> {
  const [existing] = await db.select().from(users).where(eq(users.email, input.email))
  let userId: number
  if (existing) {
    userId = existing.id
    await db.delete(invites).where(and(eq(invites.userId, userId), isNull(invites.usedAt)))
  } else {
    const created = await getAuth().api.createUser({
      body: { email: input.email, name: input.name, password: randomBytes(32).toString('hex'), role: input.role },
    })
    userId = Number(created.user.id)
  }
  const rawToken = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS)
  await db.insert(invites).values({ tokenHash: hashToken(rawToken), userId, invitedBy: input.invitedBy, expiresAt })
  return { rawToken, userId, expiresAt }
}
```

`src/lib/validation.ts` — add:

```ts
export const inviteCreateSchema = z.object({
  email: z.email().max(254),
  name: z.string().min(1).max(100),
  role: z.enum(['admin', 'user']).default('user'),
})
```

`src/app/api/v1/invites/route.ts`:

```ts
import { getDb } from '@/db/client'
import { getAuth } from '@/lib/better-auth'
import { createInvite } from '@/lib/invites'
import { inviteCreateSchema } from '@/lib/validation'
import { withErrorEnvelope } from '@/lib/with-error-envelope'
import { ok, fail, forbidden, unauthorized, readJson, BODY_TOO_LARGE, failParse } from '../respond'

// Until Task 6 rewires actorFromRequest onto better-auth, resolve the admin
// directly from the better-auth session here. Task 6 swaps this block for
// actorFromRequest + role check (same observable behavior, one seam).
async function adminIdFrom(req: Request): Promise<number | 'anonymous' | 'not-admin'> {
  if (req.headers.get('authorization')) return 'not-admin' // agents cannot invite
  const session = await getAuth().api.getSession({ headers: req.headers })
  if (!session) return 'anonymous'
  if (session.user.role !== 'admin' || session.user.banned) return 'not-admin'
  return Number(session.user.id)
}

export const POST = withErrorEnvelope(async (req: Request) => {
  const adminId = await adminIdFrom(req)
  if (adminId === 'anonymous') return unauthorized()
  if (adminId === 'not-admin') return forbidden()
  const raw = await readJson(req)
  if (raw === BODY_TOO_LARGE) return fail('요청 본문이 너무 큽니다', 413)
  const parsed = inviteCreateSchema.safeParse(raw)
  if (!parsed.success) return failParse(parsed.error)
  const { rawToken, userId, expiresAt } = await createInvite(getDb(), { ...parsed.data, invitedBy: adminId })
  const base = process.env.BETTER_AUTH_URL ?? new URL(req.url).origin
  return ok({ inviteUrl: `${base}/invite/${rawToken}`, userId, expiresAt }, 201)
})
```

(If `failParse` has a different name/shape in respond.ts, match the existing helper the other authenticated routes use.)

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/api/invites.test.ts && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/invites.ts src/lib/validation.ts src/app/api/v1/invites tests/api/invites.test.ts
git commit -m "feat: admin invite creation with one-time copy link"
```

---

### Task 4: invite accept (password path), status GET, consume (google path)

**Files:**
- Create: `src/app/api/v1/invites/accept/route.ts`
- Create: `src/app/api/v1/invites/[token]/route.ts` (GET status)
- Create: `src/app/api/v1/invites/consume/route.ts`
- Modify: `src/lib/invites.ts`, `src/lib/validation.ts`
- Test: `tests/api/invites.test.ts` (extend)

**Interfaces:**
- Consumes: Task 3's `createInvite`, `getAuth()`.
- Produces:
  - `claimInvite(db, rawToken): Promise<{ invite, user } | 'not-found' | 'gone'>` in invites.ts — atomic single-use claim (`UPDATE … SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING`).
  - `getInviteStatus(db, rawToken): Promise<{ email: string; name: string; status: 'pending' | 'used' | 'expired' } | null>`.
  - `POST /api/v1/invites/accept` `{ token, password }` → 200 `{ id, email, name, role }` + `set-cookie`; 404 unknown, 410 used/expired, 403 banned.
  - `GET /api/v1/invites/<token>` → 200 `{ email, name, status }`; 404 unknown.
  - `POST /api/v1/invites/consume` `{ token }` (session required, self only) → 200 `{ ok: true, data: null }`.
  - `inviteAcceptSchema = { token: z.string().regex(/^[0-9a-f]{64}$/), password: z.string().min(8).max(128) }`, `inviteConsumeSchema = { token: same regex }`.

- [ ] **Step 1: Write the failing tests** (append to `tests/api/invites.test.ts`)

```ts
import { POST as acceptRoute } from '@/app/api/v1/invites/accept/route'
import { GET as statusRoute } from '@/app/api/v1/invites/[token]/route'
import { POST as consumeRoute } from '@/app/api/v1/invites/consume/route'

function mkAccept(body: unknown) {
  return new Request('http://x/api/v1/invites/accept', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
}

async function makeInvite(email: string, name = '초대자') {
  const res = await createRoute(mkReq({ email, name }, adminCookie))
  const { data } = await res.json()
  return { token: data.inviteUrl.split('/').pop() as string, userId: data.userId as number }
}

describe('GET /api/v1/invites/[token]', () => {
  it('200s pending with invitee identity; 404s unknown', async () => {
    const { token } = await makeInvite('status@test.local', '상태조회')
    const res = await statusRoute(mkReq({}, undefined), { params: Promise.resolve({ token }) })
    const { data } = await res.json()
    expect(data).toEqual({ email: 'status@test.local', name: '상태조회', status: 'pending' })
    const miss = await statusRoute(mkReq({}, undefined), { params: Promise.resolve({ token: 'f'.repeat(64) }) })
    expect(miss.status).toBe(404)
  })
})

describe('POST /api/v1/invites/accept', () => {
  it('sets the password, signs in (set-cookie), marks the invite used', async () => {
    const { token, userId } = await makeInvite('accept@test.local')
    const res = await acceptRoute(mkAccept({ token, password: 'fresh-anchor-99' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toContain('better-auth')
    const { data } = await res.json()
    expect(data.id).toBe(userId)
    // the new password now works via normal sign-in
    const { headers } = await getAuth().api.signInEmail({
      returnHeaders: true, body: { email: 'accept@test.local', password: 'fresh-anchor-99' },
    })
    expect(headers.get('set-cookie')).toBeTruthy()
  })

  it('is single-use (second accept 410) and rejects expired invites (410) and unknown tokens (404)', async () => {
    const { token } = await makeInvite('once@test.local')
    await acceptRoute(mkAccept({ token, password: 'first-time-pw-1' }))
    expect((await acceptRoute(mkAccept({ token, password: 'second-try-pw-2' }))).status).toBe(410)
    const { token: expTok, userId } = await makeInvite('late@test.local')
    await db.update(invites).set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invites.tokenHash, hashToken(expTok)))
    expect((await acceptRoute(mkAccept({ token: expTok, password: 'too-late-pw-33' }))).status).toBe(410)
    expect((await acceptRoute(mkAccept({ token: 'a'.repeat(64), password: 'whatever-pw-44' }))).status).toBe(404)
  })
})

describe('POST /api/v1/invites/consume', () => {
  it('marks used for the invite owner session; 403s another user; 401s anonymous', async () => {
    const { token } = await makeInvite('google-path@test.local')
    // simulate "signed in via Google": set a real password server-side, sign in
    const [u] = await db.select().from(users).where(eq(users.email, 'google-path@test.local'))
    await getAuth().api.setUserPassword({ body: { userId: String(u.id), newPassword: 'linked-via-g-55' } })
    const cookie = await loginAs('google-path@test.local', 'linked-via-g-55')
    const other = await loginAs('deckhand@test.local', 'deckhand-pw-123')
    expect((await consumeRoute(mkReq({ token }, other))).status).toBe(403)
    expect((await consumeRoute(mkReq({ token }, cookie))).status).toBe(200)
    const [inv] = await db.select().from(invites).where(eq(invites.tokenHash, hashToken(token)))
    expect(inv.usedAt).not.toBeNull()
    expect((await consumeRoute(mkReq({ token }))).status).toBe(401)
  })
})
```

- [ ] **Step 2: Run to verify failures**

Run: `npx vitest run tests/api/invites.test.ts`
Expected: new describes FAIL (modules missing); Task 3 describes still PASS.

- [ ] **Step 3: Implement**

Add to `src/lib/invites.ts`:

```ts
export async function getInviteStatus(db: Db, rawToken: string) {
  const [row] = await db.select({
    email: users.email, name: users.name, usedAt: invites.usedAt, expiresAt: invites.expiresAt,
  }).from(invites).innerJoin(users, eq(users.id, invites.userId))
    .where(eq(invites.tokenHash, hashToken(rawToken)))
  if (!row) return null
  const status = row.usedAt ? 'used' as const : row.expiresAt < new Date() ? 'expired' as const : 'pending' as const
  return { email: row.email ?? '', name: row.name, status }
}

// Atomic claim: the UPDATE's WHERE is the whole race guard — two concurrent
// accepts can't both see used_at IS NULL. A claim that later fails (e.g.
// banned) burns the token; the admin re-issues. Cheaper than a transaction
// and fails closed.
export async function claimInvite(db: Db, rawToken: string) {
  const [invite] = await db.update(invites).set({ usedAt: new Date() })
    .where(and(eq(invites.tokenHash, hashToken(rawToken)), isNull(invites.usedAt), gt(invites.expiresAt, new Date())))
    .returning()
  if (invite) {
    const [user] = await db.select().from(users).where(eq(users.id, invite.userId))
    return { invite, user }
  }
  const [exists] = await db.select({ id: invites.id }).from(invites).where(eq(invites.tokenHash, hashToken(rawToken)))
  return exists ? 'gone' as const : 'not-found' as const
}
```

(add `gt` to the drizzle-orm import.)

`src/lib/validation.ts` — add:

```ts
const inviteToken = z.string().regex(/^[0-9a-f]{64}$/)
export const inviteAcceptSchema = z.object({ token: inviteToken, password: z.string().min(8).max(128) })
export const inviteConsumeSchema = z.object({ token: inviteToken })
```

`src/app/api/v1/invites/accept/route.ts`:

```ts
import { getDb } from '@/db/client'
import { getAuth } from '@/lib/better-auth'
import { claimInvite } from '@/lib/invites'
import { inviteAcceptSchema } from '@/lib/validation'
import { withErrorEnvelope } from '@/lib/with-error-envelope'
import { ok, fail, readJson, BODY_TOO_LARGE } from '../../respond'

// Pre-auth route (like the old login): opaque 400, no field-level issues.
export const POST = withErrorEnvelope(async (req: Request) => {
  const raw = await readJson(req)
  if (raw === BODY_TOO_LARGE) return fail('요청 본문이 너무 큽니다', 413)
  const parsed = inviteAcceptSchema.safeParse(raw)
  if (!parsed.success) return fail('입력값이 올바르지 않습니다', 400)
  const db = getDb()
  const claimed = await claimInvite(db, parsed.data.token)
  if (claimed === 'not-found') return fail('유효하지 않은 초대장입니다', 404)
  if (claimed === 'gone') return fail('만료되었거나 이미 사용된 초대장입니다', 410)
  const { user } = claimed
  if (user.banned) return fail('비활성화된 계정입니다', 403)
  await getAuth().api.setUserPassword({ body: { userId: String(user.id), newPassword: parsed.data.password } })
  const { headers } = await getAuth().api.signInEmail({
    returnHeaders: true, body: { email: user.email!, password: parsed.data.password },
  })
  const res = ok({ id: user.id, email: user.email, name: user.name, role: user.role })
  const setCookie = headers.get('set-cookie')
  if (setCookie) res.headers.set('set-cookie', setCookie)
  return res
})
```

`src/app/api/v1/invites/[token]/route.ts`:

```ts
import { getDb } from '@/db/client'
import { getInviteStatus } from '@/lib/invites'
import { withErrorEnvelope } from '@/lib/with-error-envelope'
import { ok, fail } from '../../respond'

export const GET = withErrorEnvelope(async (_req: Request, ctx: { params: Promise<{ token: string }> }) => {
  const { token } = await ctx.params
  if (!/^[0-9a-f]{64}$/.test(token)) return fail('유효하지 않은 초대장입니다', 404)
  const status = await getInviteStatus(getDb(), token)
  if (!status) return fail('유효하지 않은 초대장입니다', 404)
  return ok(status)
})
```

(match `withErrorEnvelope`'s existing signature for routes with params — check how `issues/[id]/route.ts` threads `ctx`.)

`src/app/api/v1/invites/consume/route.ts`:

```ts
import { eq, and, isNull } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { getAuth } from '@/lib/better-auth'
import { invites } from '@/db/schema'
import { hashToken } from '@/lib/api-auth'
import { inviteConsumeSchema } from '@/lib/validation'
import { withErrorEnvelope } from '@/lib/with-error-envelope'
import { ok, fail, forbidden, unauthorized, readJson, BODY_TOO_LARGE } from '../../respond'

// Google-path bookkeeping: the invited user signed in via Google (account
// linking) — burn the invite so a later leak of the link can't set a
// password on this account.
export const POST = withErrorEnvelope(async (req: Request) => {
  const session = await getAuth().api.getSession({ headers: req.headers })
  if (!session) return unauthorized()
  const raw = await readJson(req)
  if (raw === BODY_TOO_LARGE) return fail('요청 본문이 너무 큽니다', 413)
  const parsed = inviteConsumeSchema.safeParse(raw)
  if (!parsed.success) return fail('입력값이 올바르지 않습니다', 400)
  const db = getDb()
  const [invite] = await db.select().from(invites).where(eq(invites.tokenHash, hashToken(parsed.data.token)))
  if (!invite) return fail('유효하지 않은 초대장입니다', 404)
  if (invite.userId !== Number(session.user.id)) return forbidden()
  await db.update(invites).set({ usedAt: new Date() })
    .where(and(eq(invites.id, invite.id), isNull(invites.usedAt)))
  return ok(null)
})
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/api/invites.test.ts && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/invites.ts src/lib/validation.ts src/app/api/v1/invites tests/api/invites.test.ts
git commit -m "feat: invite accept (password path), status lookup, google-path consume"
```

---

### Task 5: seed-admin script; retire seed.ts

**Files:**
- Create: `scripts/seed-admin.ts`
- Delete: `scripts/seed.ts`
- Modify: `package.json` (replace `"seed"` script with `"seed:admin": "tsx scripts/seed-admin.ts"`)
- Test: `tests/api/seed-admin.test.ts` (new)

**Interfaces:**
- Consumes: `getAuth()`, `getDb()`.
- Produces: `seedAdmin(): Promise<{ id: number } | 'already-seeded'>` exported from the script; CLI runs it when executed directly. Reads `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` (≥8 chars), `SEED_ADMIN_NAME`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { createTestDb, seedUser } from '../helpers/db'
import { seedAdmin } from '../../scripts/seed-admin'
import type { Db } from '@/db/client'

let db: Db
beforeAll(async () => {
  db = await createTestDb()
  process.env.SEED_ADMIN_EMAIL = 'first@test.local'
  process.env.SEED_ADMIN_PASSWORD = 'harbor-master-1'
  process.env.SEED_ADMIN_NAME = '항만장'
})

describe('seedAdmin', () => {
  it('creates the first admin once, then refuses', async () => {
    const first = await seedAdmin()
    expect(first).toHaveProperty('id')
    expect(await seedAdmin()).toBe('already-seeded')
  })
})
```

(For the refusal-when-any-user-exists case: PGlite state persists per file — the second call sees the first admin. A separate `it` seeding a plain user first would need its own test db/file; the guard is "any user exists", which the second call already proves.)

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/api/seed-admin.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `scripts/seed-admin.ts`**

```ts
import { getDb } from '@/db/client'
import { getAuth } from '@/lib/better-auth'
import { users } from '@/db/schema'

// One-shot bootstrap: creates the very first admin. Everything after this
// goes through invites. Refuses if ANY user exists (idempotent-safe).
export async function seedAdmin(): Promise<{ id: number } | 'already-seeded'> {
  const email = process.env.SEED_ADMIN_EMAIL
  const password = process.env.SEED_ADMIN_PASSWORD
  const name = process.env.SEED_ADMIN_NAME
  if (!email || !password || password.length < 8 || !name) {
    throw new Error('SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD(≥8) / SEED_ADMIN_NAME required')
  }
  const [existing] = await getDb().select({ id: users.id }).from(users).limit(1)
  if (existing) return 'already-seeded'
  const created = await getAuth().api.createUser({ body: { email, password, name, role: 'admin' } })
  return { id: Number(created.user.id) }
}

const isDirectRun = process.argv[1]?.endsWith('seed-admin.ts')
if (isDirectRun) {
  seedAdmin().then((r) => {
    console.log(r === 'already-seeded' ? '이미 유저가 있어 건너뜀' : `admin created: id=${r.id}`)
    process.exit(0)
  }).catch((e) => { console.error(e); process.exit(1) })
}
```

Delete `scripts/seed.ts`; update package.json scripts (`"seed"` → `"seed:admin"`). If anything imports `scripts/seed.ts` or `passwordExceedsBcryptLimit`'s seed usage, this task only removes the script — validation.ts cleanup happens in Task 6.

- [ ] **Step 4: Run** — `npx vitest run tests/api/seed-admin.test.ts && npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts package.json tests/api/seed-admin.test.ts
git rm scripts/seed.ts
git commit -m "feat: seed-admin bootstrap script; retire CSV seed"
```

---

### Task 6: session seam cutover — actorFromRequest, old auth routes deleted, users/issues contract updates

**Files:**
- Modify: `src/lib/api-auth.ts`
- Delete: `src/app/api/v1/auth/` (login/logout/me routes), `tests/api/auth-routes.test.ts`
- Modify: `src/app/api/v1/invites/route.ts` (swap `adminIdFrom` → `actorFromRequest` + role check)
- Modify: `src/app/api/v1/users/route.ts` (email + banned instead of portalId)
- Modify: `src/app/api/v1/issues/route.ts` + `src/lib/validation.ts` (`requesterPortalId` → `requesterEmail`)
- Create: `tests/helpers/auth.ts` (real-session helper)
- Modify: every test that mocks `@/lib/session` or seeds `portalId` expectations
- Rewrite: `tests/api/session-live.test.ts` → `tests/api/auth-live.test.ts`
- Modify: `tests/api/auth-envelope.test.ts`, `tests/api/users.test.ts`, `tests/api/issues.test.ts`, others per grep

**Interfaces:**
- Produces: `actorFromRequest` unchanged signature; session branch now better-auth. `tests/helpers/auth.ts` exports `createSessionUser(db, overrides?: { role?: 'admin' | 'user'; email?: string; name?: string }): Promise<{ user: User; cookie: string }>` — creates a real user via `getAuth().api.createUser` (random known password) and returns a live session cookie via `signInEmail`.
- Produces: `GET /api/v1/users` rows: `{ id, email, name, role }` for an authenticated human, plus `banned, slackUserId` when the actor is an admin or an agent (amended after review — an ordinary crew member must not enumerate suspension status or the Slack mapping; agents keep them to resolve a Slack id to `requesterEmail`).
- Produces: agent issue-create contract field `requesterEmail` (email of an existing user) replacing `requesterPortalId`.

- [ ] **Step 1: Write `tests/helpers/auth.ts`**

```ts
import { getAuth } from '@/lib/better-auth'
import type { Db } from '@/db/client'
import type { User } from '@/db/schema'
import { users } from '@/db/schema'
import { eq } from 'drizzle-orm'

let seq = 0
export async function createSessionUser(
  db: Db, overrides: { role?: 'admin' | 'user'; email?: string; name?: string } = {},
): Promise<{ user: User; cookie: string }> {
  const email = overrides.email ?? `session-u${++seq}-${Math.random().toString(36).slice(2, 8)}@test.local`
  const password = 'vitest-session-pw-1'
  await getAuth().api.createUser({
    body: { email, password, name: overrides.name ?? '테스트 유저', role: overrides.role ?? 'user' },
  })
  const { headers } = await getAuth().api.signInEmail({ returnHeaders: true, body: { email, password } })
  const [user] = await db.select().from(users).where(eq(users.email, email))
  return { user, cookie: headers.get('set-cookie')! }
}
```

- [ ] **Step 2: Rewrite `actorFromRequest`'s session branch (write the new expectation first where a test exists)**

`src/lib/api-auth.ts` — replace the iron-session block (imports of `getSession`, `isSessionConfigFault`, the try/catch, the users lookup) with:

```ts
  // Role/banned come from the DB via better-auth's DB-backed session (no
  // cookieCache) — a demoted or banned user loses authority immediately.
  // getAuth() throws on a missing/placeholder secret → withErrorEnvelope 500
  // (server fault); a garbage cookie just yields a null session → 401.
  const session = await getAuth().api.getSession({ headers: req.headers })
  if (!session || session.user.banned) return null
  return { type: 'user', id: Number(session.user.id), role: session.user.role === 'admin' ? 'admin' : 'user' }
```

Delete `isSessionConfigFault`. Swap invites route's `adminIdFrom` for `actorFromRequest` + `actor.type === 'user' && actor.role === 'admin'` (agents/others → `forbidden()`, anonymous → `unauthorized()`).

- [ ] **Step 3: Delete old auth surface**

```bash
git rm -r src/app/api/v1/auth tests/api/auth-routes.test.ts
```

Remove `loginSchema` and `passwordExceedsBcryptLimit` from `src/lib/validation.ts` (bcryptjs import goes with it).

- [ ] **Step 4: users + issues contract updates**

`users/route.ts` select becomes `{ id, email, name, role, banned, slackUserId }` (comment stays: never `select()` — password hashes now live in `account`, but the rule stands). `validation.ts`: `requesterPortalId` → `requesterEmail: z.email().max(254).optional()`. `issues/route.ts` agent branch: lookup `eq(users.email, requesterEmail)`, messages `'에이전트 등록에는 requesterEmail이 필요합니다'` / `` `요청자 계정을 찾을 수 없습니다: ${requesterEmail}` ``.

- [ ] **Step 5: Sweep the test suite off the iron-session mock**

Run: `grep -rln "vi.mock('@/lib/session'\|portalId" tests/` — for each file: drop the `@/lib/session` mock and `sessionState`; obtain identity via `createSessionUser(db, …)` and pass `headers: { cookie }` in requests (files already build headers via their `mkReq`-style helpers). Replace `portalId` expectations with `email`. `auth-envelope.test.ts`: the "config fault → 500" case now unsets/placeholders `BETTER_AUTH_SECRET` (fresh module registry via `vi.resetModules()` + dynamic import, since `getAuth` caches); the "garbage cookie → 401" case sends `cookie: 'better-auth.session_token=garbage'`.

- [ ] **Step 6: Rewrite the live test as `tests/api/auth-live.test.ts`**

Keep the docker-Postgres + real `next dev` harness from `session-live.test.ts` verbatim (ports, waitFor, tsconfig dance). New flow, env now includes `BETTER_AUTH_SECRET` + `SEED_ADMIN_*`:

1. run migrations, run `npx tsx scripts/seed-admin.ts`
2. `POST /api/auth/sign-in/email` `{ email, password }` → capture `set-cookie`
3. `GET /api/v1/users` with cookie → 200, envelope shape, admin row has `email`
4. `POST /api/v1/invites` (admin cookie) → 201, extract token from `inviteUrl`
5. `POST /api/v1/invites/accept` `{ token, password: 'live-invitee-pw-9' }` → 200 + its own `set-cookie`
6. `GET /api/v1/users` with the invitee cookie → 200 (invited user is a working session)
7. `POST /api/auth/sign-out` with invitee cookie → subsequent `GET /api/v1/users` → 401

This is the spec §7 Postgres-backed integration test for invite + login.

- [ ] **Step 7: Run everything**

Run: `npm test`
Expected: PASS (auth-live included if Docker present — same conditions the old session-live had). Also `npm run build` — expect compile success (login page still references the deleted route only via URL string, which compiles; UI cutover is next task).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: cut actorFromRequest over to better-auth; retire portal login routes; requesterEmail contract"
```

---

### Task 7: UI cutover — auth client, login page, shell

**Files:**
- Create: `src/lib/auth-client.ts`
- Rewrite: `src/app/login/page.tsx`
- Modify: `src/ui/shell.tsx`, `src/ui/types.ts` (ApiUser)
- Test: `tests/ui/shell.test.tsx` (update), `tests/ui/login-page.test.tsx` (new)

**Interfaces:**
- Produces: `authClient` from `src/lib/auth-client.ts`:

```ts
import { createAuthClient } from 'better-auth/react'
import { adminClient } from 'better-auth/client/plugins'
export const authClient = createAuthClient({ plugins: [adminClient()] })
```

- Produces: `ApiUser = { id: number; email: string; name: string; role: 'admin' | 'user'; banned?: boolean; slackUserId?: string | null }` (matches Task 6's users route — the last two are optional because that route omits them for non-admin humans).

- [ ] **Step 1: Write failing UI tests**

`tests/ui/login-page.test.tsx` — follow the existing tests/ui patterns (testing-library + jsdom, mock `authClient`):

```tsx
vi.mock('@/lib/auth-client', () => ({
  authClient: {
    signIn: { email: vi.fn(), social: vi.fn() },
  },
}))
```

Assert: renders email+password fields and a 구글 button; submitting calls `authClient.signIn.email` with `{ email, password }` (mock rejects → shows `아이디 또는 비밀번호가 올바르지 않습니다`-style generic error; mock resolves → navigates to `/inbox` — follow how existing tests assert navigation); clicking the Google button calls `signIn.social` with `{ provider: 'google', callbackURL: '/inbox', errorCallbackURL: '/login?error=google' }`.

Update `tests/ui/shell.test.tsx`: identity now comes from `authClient.useSession()` (mock it returning `{ data: { user }, isPending: false }`), logout button calls `authClient.signOut` and keeps the stay-on-failure behavior (signOut mock rejects → no navigation, retry visible).

- [ ] **Step 2: Run to verify failures** — `npx vitest run tests/ui/login-page.test.tsx tests/ui/shell.test.tsx` → FAIL.

- [ ] **Step 3: Implement**

`login/page.tsx` (keep RudderMark, panel layout, 순항 준비 heading):
- email input (`type="email"`, autoComplete `username`), password input (autoComplete `current-password`).
- submit → `authClient.signIn.email({ email, password })`; on error show generic `'이메일 또는 비밀번호가 올바르지 않습니다'`; on success `window.location.assign('/inbox')` (full navigation — Shell's session state must remount, same reasoning as the old logout comment).
- Google button (`btn` style, above form with an `또는` divider) → `authClient.signIn.social({ provider: 'google', callbackURL: '/inbox', errorCallbackURL: '/login?error=google' })`.
- On mount, if `new URLSearchParams(location.search).get('error') === 'google'` show `'구글 로그인에 실패했습니다. 초대된 계정인지 확인해 주세요.'` (covers uninvited-account rejection round trip).

`shell.tsx`:
- `const { data: sessionData, isPending } = authClient.useSession()`; while `isPending` return null; if no session → `window.location.assign('/login')`, return null (replaces the useApi 401 path).
- Build the `me: ApiUser` the rest of Shell consumes from `sessionData.user` (`{ id: Number(user.id), email: user.email, name: user.name, role: user.role, … }`).
- LogoutButton: `authClient.signOut()` in try/catch, keep the do-NOT-leave-on-failure comment and behavior, on success `window.location.assign('/login')`.
- `types.ts`: ApiUser as in Interfaces; fix all compile fallout in UI components referencing `portalId` (grep `src/ui src/app` for `portalId`).

- [ ] **Step 4: Run** — `npx vitest run tests/ui && npm test && npm run build` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: login/shell on better-auth client — google + email/password"
```

---

### Task 8: invite accept page — /invite/[token]

**Files:**
- Create: `src/app/invite/[token]/page.tsx`
- Test: `tests/ui/invite-page.test.tsx` (new)

**Interfaces:**
- Consumes: `GET /api/v1/invites/<token>` (status), `POST /api/v1/invites/accept`, `POST /api/v1/invites/consume`, `authClient.signIn.social`, `authClient.useSession`, `api`/`useApi` from `@/ui/api`.

- [ ] **Step 1: Write failing UI test** — states: `pending` renders greeting (`{name}님, Rudder에 오신 것을 환영합니다` + email), Google button, password form (min 8, 비밀번호 설정 submit); `used`/`expired` render the guidance message (`관리자에게 새 초대 링크를 요청해 주세요`) and NO form; unknown token (404) renders the invalid message. Submitting the password form POSTs `/api/v1/invites/accept` with `{ token, password }` and navigates to `/inbox` on 200. With an active session whose email equals the invite email, the page POSTs `/api/v1/invites/consume` and navigates to `/inbox`.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** ('use client', no Shell — signed-out screen like login):
- Read token via `useParams()`; fetch status with the existing `useApi`-style fetch against `/api/v1/invites/${token}`.
- `authClient.useSession()`: if session present and matches invite email → `api('/api/v1/invites/consume', { method: 'POST', body: JSON.stringify({ token }) })` then `window.location.assign('/inbox')`.
- Google button → `authClient.signIn.social({ provider: 'google', callbackURL: `/invite/${token}`, errorCallbackURL: `/invite/${token}?error=google` })`; `?error=google` shows `'구글 로그인에 실패했습니다. 초대된 이메일({email})의 구글 계정으로 시도해 주세요.'`
- Password form: single password field, `minLength 8`, submit → accept POST → on 200 full navigation to `/inbox`; 410 → switch to the expired/used message; 403 banned → `'비활성화된 계정입니다'`.

- [ ] **Step 4: Run** — `npx vitest run tests/ui/invite-page.test.tsx && npm test && npm run build` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: invite accept page (google / set-password paths)"`

---

### Task 9: crew management page (admin)

**Files:**
- Create: `src/app/(app)/crew/page.tsx` (+ colocated components if the page tops ~400 lines, e.g. `invite-dialog.tsx`)
- Modify: `src/ui/shell.tsx` (nav item, admin-only)
- Test: `tests/ui/crew-page.test.tsx` (new)

**Interfaces:**
- Consumes: `GET /api/v1/users` (Task 6 shape), `POST /api/v1/invites`, `authClient.admin.setRole({ userId, role })`, `authClient.admin.banUser({ userId })`, `authClient.admin.unbanUser({ userId })`.

- [ ] **Step 1: Write failing UI test** — renders roster table (name, email, role, 상태, slackUserId) from mocked users API; 초대 form (email/name/role) POSTs `/api/v1/invites` and then shows the returned link with a 복사 button (`navigator.clipboard.writeText` called with the URL — mock clipboard); per-row 재발급 button POSTs the same endpoint with that user's email; role select calls `authClient.admin.setRole`; ban button asks for confirmation first (existing dialog/confirm pattern in the codebase — match `products-page`/`milestone-dialog` conventions), then calls `banUser`; non-admin session renders the empty-state (`권한이 없습니다`) and shell hides the nav item.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**
- Page title `선원 명부` (crew roster — PRD §7 tone; standard term `유저 관리` appears in the page subtitle so nobody guesses).
- Guard: `me.role !== 'admin'` → render the existing `.empty` pattern with `권한이 없습니다`.
- Invite success dialog: shows the one-time link, 복사 button, and the warning `이 링크는 다시 표시되지 않습니다 · 7일 후 만료`.
- 재발급 reuses the invite POST with the row's email/name/role.
- Ban confirm copy states the consequence: `세션이 즉시 종료되며 로그인할 수 없게 됩니다`.
- After any mutation, refetch the roster (follow the existing refetch pattern from products page).
- Nav: add `선원` item to the rail in shell.tsx, rendered only when `me.role === 'admin'` (match existing nav item structure in `nav.test.ts`).

- [ ] **Step 4: Run** — `npx vitest run tests/ui/crew-page.test.tsx tests/ui/nav.test.ts && npm test && npm run build` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: crew roster page — invites, roles, ban/unban"`

---

### Task 10: teardown — legacy auth code, schema drop, dependency removal

**Files:**
- Delete: `src/lib/auth.ts` (portal check), `src/lib/session.ts`, their tests (grep `verifyCredentials|checkItPortal|getSession` in tests/)
- Modify: `src/instrumentation.ts`, `src/app/api/health/route.ts`, `scripts/docker-entrypoint.sh`, `tests/api/health.test.ts`
- Modify: `src/db/schema.ts` + new migration `drizzle/0008_*`
- Modify: `package.json` (remove iron-session, bcryptjs, @types/bcryptjs), `tests/helpers/db.ts`

**Interfaces:**
- Consumes: `isAuthSecretValid`/`PLACEHOLDER_SECRET` from `src/lib/auth-secret.ts` (Task 2).
- Produces: final `users` schema: no `portalId`, no `passwordHash`, `email` NOT NULL.

- [ ] **Step 1: Failing test edits first** — update `tests/api/health.test.ts` to set/unset `BETTER_AUTH_SECRET` (not SESSION_SECRET) around the 503 case; add a schema test asserting `users.email` NOT NULL (insert without email rejects). Run → FAIL.

- [ ] **Step 2: Swap the boot/health checks**
- `instrumentation.ts`: import from `@/lib/auth-secret`, `BOOT_ERROR = 'BETTER_AUTH_SECRET missing or invalid (need ≥32 chars) — refusing to start'`, check `process.env.BETTER_AUTH_SECRET`. Keep both long-form comments (they describe Next 16 behavior, still true) — just re-point the names.
- `health/route.ts`: `isAuthSecretValid(process.env.BETTER_AUTH_SECRET)`.
- `docker-entrypoint.sh`: rename the env var check to `BETTER_AUTH_SECRET` (same placeholder literal, same ≥32 length check).

- [ ] **Step 3: Delete legacy modules & deps**

```bash
git rm src/lib/auth.ts src/lib/session.ts
npm uninstall iron-session bcryptjs @types/bcryptjs
```

Fix imports: `grep -rn "iron-session\|bcryptjs\|@/lib/session\|verifyCredentials\|TIMING_EQUALIZER" src tests scripts` — every hit must go (delete dead tests like the old auth unit tests; `create-token.ts` uses `hashToken` only, unaffected).

- [ ] **Step 4: Final schema migration** — remove `portalId`/`passwordHash` from schema.ts, change `email: text('email').notNull().unique()`, drop `portalId` from `seedUser`, run `npm run db:generate` → 0008 with `ALTER TABLE users DROP COLUMN portal_id, DROP COLUMN password_hash` + `SET NOT NULL`. Grep the last stragglers: `grep -rn portalId src tests scripts` → zero hits.

- [ ] **Step 5: Run** — `npm test && npm run build` → PASS. Also `npx vitest run tests/api/auth-live.test.ts` if Docker available.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "chore: tear down IT Portal + iron-session auth; drop portalId/passwordHash"`

---

### Task 11: e2e, deploy config, docs, final verification

**Files:**
- Modify: `tests/e2e/global-setup.ts`, `tests/e2e/helpers.ts`, `tests/e2e/*.spec.ts` (login flow)
- Modify: `deploy/docker-compose.prod.yml`, `.env.example`, `README.md`, any docs referencing `requesterPortalId`/`SESSION_SECRET`/`IT_PORTAL` (`grep -rn "portalId\|SESSION_SECRET\|IT_PORTAL" docs README.md deploy .github`)

**Interfaces:** none new — closure task.

- [ ] **Step 1: e2e login update** — global-setup/helpers: seed via `scripts/seed-admin.ts` (env `SEED_ADMIN_*`), log in through the real `/login` form with email+password (fill `이메일`, `비밀번호`, submit, expect `/inbox`). Add one spec: admin creates an invite in 선원 명부, copies the link, opens it in a fresh context, sets a password, lands in `/inbox`. Google-button e2e is NOT automated (external IdP) — see manual QA below.

- [ ] **Step 2: Run e2e** — `npm run test:e2e` → PASS.

- [ ] **Step 3: Deploy config**
- `deploy/docker-compose.prod.yml`: replace `SESSION_SECRET`/`IT_PORTAL_LOGIN_URL` env passthroughs with `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
- `.env.example`: remove `SESSION_SECRET` + `IT_PORTAL_LOGIN_URL` block.
- README: auth section → invite-based onboarding, seed-admin bootstrap, Google OAuth console redirect URI `(BETTER_AUTH_URL)/api/auth/callback/google`.
- Docs sweep for `requesterPortalId` → `requesterEmail` (agent/API docs — <slack-bot-repo>'s caller must be updated when this deploys; note it in the README's breaking-changes line).

- [ ] **Step 4: Full verification**

```bash
npm test && npm run build && npm run test:e2e && npm run coverage:gate
```

Expected: all green.

- [ ] **Step 5: Manual QA checklist (VM, real Google credentials — record results in the PR)**
- [ ] Google login with an invited account's email → lands in /inbox, `account` row `providerId='google'` created.
- [ ] Google login with an UNINVITED account → bounced to `/login?error=google`, no users row created.
- [ ] Invite link opened after Google-path activation → shows 사용됨 message.
- [ ] Banned user: existing session dies immediately; email login rejected; Google login rejected.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "chore: e2e + deploy config + docs for better-auth cutover"`

---

## Self-review notes (already applied)

- Spec §5's `GET /api/v1/users` change, §3 re-issue invalidation, §6 boot-check swap, §7 Postgres-backed integration test each map to Tasks 6, 3, 10, 6 respectively.
- Spec amendment (same date): agent contract `requesterPortalId` → `requesterEmail`; `scripts/seed.ts` retired — recorded in the spec's changelog section.
- Deliberate deviation from spec §1: the `nextCookies()` plugin is omitted — our two cookie-setting routes forward `set-cookie` explicitly so they stay vitest-testable; better-auth's own handler sets cookies on its Response without the plugin.
- Type note: better-auth types `user.id` as string even with `generateId: 'serial'` (values arrive numeric) — every consumer coerces with `Number(...)` at the boundary (api-auth, invites, shell).
