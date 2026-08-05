# Rudder Auth Redesign — better-auth, Invites, Google Login: Design

Date: 2026-08-04
Status: Draft (pending PO approval)
Owner: Hansol Kim (Product Owner)
Parent: `2026-07-30-issue-tracker-design.md` (PRD)

Rudder's authentication currently delegates to the IT Portal
(`IT_PORTAL_LOGIN_URL` credential check with a local bcrypt fallback,
`src/lib/auth.ts`) over an iron-session cookie. This redesign removes the
IT Portal dependency entirely and rebuilds auth on **better-auth**:
admin-invite-only registration, Google login, and email+password login.

PO decisions (interview 2026-08-04):

- Scope is **Rudder's own auth** — not a shared Tyche SSO service.
- **Blank slate**: no registered users exist, so there is no data
  migration and no re-invite wave. `portalId` disappears.
- Invites are delivered by **copy-link** (admin copies the invite URL and
  sends it over Slack or any channel). No email-sending infrastructure.
- Library: **better-auth** (PO choice over extending the hand-rolled
  stack; accepts replacing iron-session with better-auth sessions).

## 1. Architecture

better-auth becomes the single owner of authentication. Removed outright:
`checkItPortal`, `verifyCredentials`, `IT_PORTAL_LOGIN_URL`, the
iron-session `rudder_session` cookie, and `src/lib/session.ts`.

better-auth server config lives in `src/lib/auth.ts` (replacing the
current file), with its HTTP handler mounted at
`src/app/api/auth/[...all]/route.ts`:

- `database: drizzleAdapter(db, { provider: 'pg' })`
- `advanced.database.generateId: 'serial'` — user ids stay
  auto-increment integers, so every existing integer FK
  (`issues.assigneeId`, `comments.authorId`, `issueEvents`, …) is
  untouched.
- `emailAndPassword: { enabled: true, disableSignUp: true }` — public
  sign-up is blocked; users exist only via admin invite.
- `socialProviders.google: { clientId, clientSecret, disableImplicitSignUp: true }`
  — a Google sign-in never creates a user; it can only attach to an
  already-invited user (email match, §3).
- `plugins: [admin()]` — roles (`admin`/`user`), ban/unban for
  offboarding, server-side `auth.api.createUser`.
- `user.modelName: 'users'` + `additionalFields: { slackUserId }` — the
  existing table name and the Slack mapping survive.
- Session cookie cache stays **disabled** so role/ban state is read fresh
  from the DB on every request (preserves the current api-auth
  invariant: a demoted or banned user loses authority immediately).

New environment variables: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Removed: `SESSION_SECRET`,
`IT_PORTAL_LOGIN_URL`. The boot/health secret checks in
`instrumentation.ts` and `/api/health` switch from `SESSION_SECRET` to
`BETTER_AUTH_SECRET` with the same placeholder-refusal semantics.

## 2. Database schema

`users` is reshaped (schema migration only — table is empty):

- Dropped: `portalId`, `passwordHash` (hashes move to better-auth's
  `account` table).
- Added: `email` (unique, not null), `emailVerified`, `image`,
  `updatedAt`, and admin-plugin fields `role`, `banned`, `banReason`,
  `banExpires`. `role` keeps the same value set (`admin`/`user`, default
  `user`); the column type may become `text` if the better-auth adapter
  requires it — the pg enum is not load-bearing anywhere else.
- Kept: `id` (serial PK), `name`, `slackUserId`, `createdAt`.

New better-auth tables, generated with `npx @better-auth/cli generate`
(drizzle adapter) and folded into our drizzle schema + one migration:

- `session` — DB-backed sessions (token, userId, expiresAt, ip, UA).
- `account` — provider links: the `credential` row holds the password
  hash; a `google` row holds the Google account link.
- `verification` — better-auth's internal token store.

New app-owned table `invites`:

| column | type | notes |
|--------|------|-------|
| id | serial PK | |
| tokenHash | text unique | sha256 of the raw token (same pattern as `apiTokens`) |
| userId | integer FK → users.id | the pre-created invitee |
| invitedBy | integer FK → users.id | admin who created it |
| expiresAt | timestamp | creation + 7 days |
| usedAt | timestamp nullable | single-use marker |
| createdAt | timestamp | |

`apiTokens` (agent `rud_*` bearer tokens) is unchanged.

## 3. Invite flow (copy-link)

**Create (admin):** admin enters email/name/role in the user-management
UI → `POST /api/v1/invites` (admin-only) →

1. `auth.api.createUser({ email, name, role })` — the user record exists
   from this moment, with **no password** (better-auth supports
   password-less creation; such an account cannot log in by password
   until one is set).
2. Insert an `invites` row (random 32-byte token, sha256-stored, 7-day
   expiry) and return the raw link `/invite/<token>` once. The admin
   copies it and delivers it out-of-band.

**Accept (invitee)** — `/invite/<token>` page offers two paths:

- **Continue with Google**: standard better-auth Google sign-in. The
  user already exists with the invited email, and Google is an
  email-verified provider, so better-auth's account linking attaches the
  Google account and opens a session. No new user can be created here
  (`disableImplicitSignUp`). When the `/invite/<token>` page loads with
  an active session belonging to the invited user, it marks the invite
  used (the token is informational on this path — the email match is the
  gate). Requires the Google account email to equal the invited email; a
  mismatched Google account gets a clear error and no session.
- **Set a password**: `POST /api/v1/invites/accept` with token +
  password → validate token (unused, unexpired, sha256 match) → set the
  password server-side via the admin plugin's set-user-password API →
  mark invite used → sign the user in (session created) in the same
  request.

Expired or used token → Korean error message; admin can re-issue a new
invite link for the same user (old invites for that user are invalidated
on re-issue). Because the user record already exists, re-issuing never
duplicates users.

**Security posture:** the invite token gates only the password path. The
Google path is gated by email match against an invited (pre-created)
user — an uninvited Google account can never mint a user. Public
email+password sign-up is disabled globally.

## 4. Login page & session surface

`/login` is rewritten with the better-auth React client
(`createAuthClient`): a "구글로 로그인" button and an email+password
form. Banned users and unknown emails get the same generic failure
message on the password path (no user enumeration); the Google path may
say "초대되지 않은 계정" since Google identity is verified.

The bespoke `/api/v1/auth/login`, `/api/v1/auth/logout`, and
`/api/v1/auth/me` routes are deleted. UI code that used them switches to
better-auth's client (`signIn.email`, `signIn.social`, `signOut`,
`useSession` / `auth.api.getSession`). Everything under better-auth's
own `/api/auth/*` handler replaces them.

## 5. Integration with existing code

`src/lib/api-auth.ts` / `actorFromRequest`:

- Bearer `rud_*` agent-token branch: **unchanged**.
- Session branch: iron-session `getSession()` is replaced by
  `auth.api.getSession({ headers: req.headers })`; the resulting
  `session.user` (id, role, banned) forms the `user` Actor. Because
  sessions are DB-backed with no cookie cache, role freshness semantics
  are identical to today's "role from DB, never from cookie" rule. A
  banned user's sessions are revoked by the admin plugin at ban time.

`Actor` type, `withErrorEnvelope`, all authorization checks, and every
non-auth API route are untouched.

**User management UI (admin-only page):** list users (existing
`GET /api/v1/users` gains `email`, drops `portalId`), create invite
(+copy link), re-issue invite, change role, ban/unban. Server endpoints
back these with the admin plugin APIs plus the two invite routes.

**First-admin bootstrap:** `scripts/seed-admin.ts` reads
`SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`/`SEED_ADMIN_NAME` and calls
`auth.api.createUser(role: 'admin')` — run once per environment; refuses
to run if any user already exists.

## 6. Error handling & security

- Invite accept failures (expired / used / bad token / email mismatch)
  return the existing `fail()` envelope with Korean messages and correct
  status codes (400/401/409/410 as applicable).
- Password policy: better-auth defaults (min 8, max 128).
- Offboarding: `banUser` revokes sessions immediately — the "disabled
  account must not retain access" property that previously depended on
  the IT Portal's disabled check is now enforced locally.
- Secrets via env only; `BETTER_AUTH_SECRET` gets the same
  placeholder-refusal boot check `SESSION_SECRET` had.
- Rate limiting: better-auth's built-in rate limiter enabled for auth
  endpoints (defaults; login/invite-accept are the sensitive routes).

## 7. Testing

- Delete portal/`verifyCredentials` unit tests and iron-session tests.
- Unit + API tests: invite create/re-issue/accept (expiry, reuse, email
  mismatch, admin-only), seed script guard, users listing shape.
- Session/actor tests: `actorFromRequest` with a real better-auth
  session; agent-token branch regression.
- Per the PGlite caveat (tests on PGlite are not proof of production
  behavior), the invite + login happy paths get Postgres-backed
  integration tests, matching the existing live-test pattern.
- Google OAuth: not E2E'd against real Google; tested to the boundary —
  account-linking behavior is asserted with a stubbed provider response,
  and `disableImplicitSignUp` rejection is covered.

## 8. Amendments (2026-08-04, planning stage)

- **Agent issue-intake contract changes**: `POST /api/v1/issues`'s
  agent-only `requesterPortalId` field becomes `requesterEmail` (portalId
  no longer exists).
- **`scripts/seed.ts` (CSV user seeder) is retired** — users now enter via
  invites; only `scripts/seed-admin.ts` (first-admin bootstrap) remains.
- **`nextCookies()` plugin is not used**: the two app routes that set
  session cookies (invite accept) forward `set-cookie` from
  `returnHeaders: true` explicitly, keeping them testable outside Next's
  request pipeline. better-auth's own handler needs no plugin for this.
- **Google account-linking test**: asserted via config pin + live manual
  QA checklist (real IdP on the VM) instead of a stubbed-provider unit
  test — better-auth's internals make a faithful stub costlier than the
  assurance it buys at this scale.

## 9. Out of scope

- Email sending (invites are copy-link; add a sender later if needed).
- Self-service password reset — an admin re-issues an invite link
  instead (the accept flow's set-password path doubles as reset).
- 2FA, passkeys, organizations/multi-tenancy, shared Tyche SSO.
- Any change to agent `rud_*` API tokens.
