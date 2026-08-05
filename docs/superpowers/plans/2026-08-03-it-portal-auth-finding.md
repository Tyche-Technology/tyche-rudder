# IT Portal auth investigation — finding (Task 11, 2026-08-03)

Phase 1 shipped `verifyCredentials` against a local bcrypt hash and deferred the
"shared login with IT Portal" question with a `ponytail:` marker and "ask
Hansol." Asked on 2026-08-03: 잘 모름 — 조사 필요. This is that investigation.

## Verdict: (a) — a real credential-verify endpoint exists, and a clean,
narrow integration was taken.

## What was checked, in the order of the brief's leads

### 1. `gh repo list Tyche-Technology --limit 100 | grep -i portal`
```
Tyche-Technology/<internal-portal-repo>  Tyche IT Portal - Next.js + RESTFUL 기반 내부 업무 포털 시스템  internal
Tyche-Technology/<unrelated-portal-repo>  Portal monthly closing accounting prototype  private
```
`<internal-portal-repo>` is the portal's source. Cloned read-only to a scratch directory (never
pushed to, no branches created, no mutations) to read its auth code.

### 2. `gcloud storage ls gs://<internal-artifact-bucket> | head`
```
gs://<internal-artifact-bucket>/avatars/
gs://<internal-artifact-bucket>/ci/
gs://<internal-artifact-bucket>/supplier-docs/
```
This is the portal's own attachment store (profile avatars, CI documents,
supplier docs) — not a CI/build-artifact bucket as the bucket name suggested,
and unrelated to authentication. No further action.

### 3. Deploy target
```
gcloud compute instances list --project=<gcp-project-id>
  → <internal-app-vm>  asia-northeast3-a  RUNNING  (<internal-ip> internal, <external-ip> external)
gcloud run services list --project=<gcp-project-id>
  → no itportal-* Cloud Run service (portal is VM-hosted, not Cloud Run)
tailscale status
  → <tailscale-ip>  <internal-app-vm>  <operator>@  linux  (online)
```
The portal repo's own `README.md` confirms this VM (`<internal-app-vm>`, Nginx + PM2,
Postgres 15 on Cloud SQL) serves `https://<internal-portal-host>`, reachable
**only** over the company Tailscale tailnet (GCP firewall: ports 80/443 allowed
only from `100.64.0.0/10`).

**Network reachability, verified live from this dev session** (already on the
tailnet):
```
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://<internal-portal-host>/
  → HTTP 307
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://<internal-portal-host>/api/v1/auth/login
  → HTTP 405   (route exists, POST-only — GET correctly rejected)
```
Per `docs/superpowers/plans/2026-08-03-rudder-phase3-launch.md` (Task 13),
Rudder's own production VM (`tyche-rudder`, asia-northeast3-a) will also join
this same tailnet (`tailscale up`, node name `tyche-rudder`). So the reachability
just verified from this dev machine is the same reachability Rudder's deployed
server will have — this is not a "dev-only, breaks in prod" integration.

### 4. Outline wiki
Not reached — the portal's own repo already answered every question the wiki
search was meant to answer (endpoint shape, deploy target, network topology),
so this lead wasn't needed. Flagging only because the brief listed it — no
Outline token was requested or used.

### 5. Cloud SQL
Not queried directly (no credentials for the portal's Postgres, and the task
scope didn't require them — the portal's own FastAPI code answered what the
database holds). `docs/TYCHE_IT_PORTAL_SPEC.md` (in `<internal-portal-repo>`) documents the
schema as `tyche_it_portal` on a separate Cloud SQL Postgres 15 instance from
Rudder's own `rudder` database on `<cloud-sql-instance>` — no shared-DB temptation here.

## What exists: a real login endpoint

`<internal-portal-repo>` contains **two** auth stacks:
- `apps/auth.py` — a legacy Flask blueprint (`flask_login` + `werkzeug` hashes,
  hardcoded 8-person email allowlist). Reads like an earlier prototype next to
  the current backend; not what's live (confirmed below).
- `backend/app/api/v1/auth.py` — the current FastAPI backend. **This is the
  live one.**

```
POST /api/v1/auth/login   (OAuth2PasswordRequestForm: username, password; form-urlencoded)
  200 → SuccessResponse[Token] { access_token, refresh_token, token_type: "bearer" }
  401 → { "detail": "Invalid username or password" }   (also fires for a disabled account)
  429 → rate-limited at 5/minute per source IP (slowapi, backend/app/core/rate_limit.py)
```
(`backend/app/models/user.py`: `username` unique, `hashed_password` bcrypt via
`backend/app/core/security.py`; `docs/TYCHE_IT_PORTAL_SPEC.md` §2-1 documents the
same route table.)

**Verified live** (safe probe — nonexistent username, no real account touched):
```
curl -s -X POST https://<internal-portal-host>/api/v1/auth/login \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'username=__nonexistent_probe_user__&password=wrong'
→ HTTP 401  {"detail":"Invalid username or password"}
```
This confirms the exact request/response shape `verifyCredentials` now codes
against, independent of any real account.

There's also an API-key mechanism (`tyk_live_...`, `backend/app/core/api_key.py`,
used by `tools/itportal-mcp` for the portal's own knowledge-graph MCP tools). That
is a *different* feature (per-user, "knowledge" scope only, issued via
Admin→Users) — not applicable to verifying a login password, so not used here.

## What's unconfirmed: coverage

The brief's Step 2A says to remove the local bcrypt fallback **only if the
portal covers all 10 Rudder users**. I could not confirm this:
- No portal session yet (chicken-and-egg — verifying login is what's being
  built) and no DB access to the portal's `tyche_it_portal.users` table were
  used to check membership (out of scope, and read-only per the task's
  constraints).
- The only user roster found (`apps/auth.py`'s `ALLOWED_EMAILS`, 8 people) is
  from the legacy Flask prototype's *registration* allowlist, not the current
  FastAPI user table — not trustworthy evidence either way.

**Because coverage is unconfirmed, the bcrypt fallback was kept**, per the
brief's own conditional.

## What was implemented

`src/lib/auth.ts` — `verifyCredentials`'s signature is unchanged; the body now
tries the portal first and falls back to the local hash:

1. Look up the local Rudder user row by `portalId` (unchanged — Rudder still
   needs its own `id`/`role`/`slackUserId` etc. regardless of who checks the
   password).
2. Ask the portal via `checkItPortal(portalId, password)` (5s timeout via
   `AbortSignal.timeout`) and branch on its outcome:

   | outcome | trigger | `verifyCredentials` behavior | why |
   |---|---|---|---|
   | `null` | `IT_PORTAL_LOGIN_URL` unset | skip the portal, go straight to bcrypt | dev/CI/pre-deploy — unchanged Phase 1 behavior, no network dependency in tests |
   | `accepted` | portal `200` | return the local user row directly (or `null` if this `portalId` has no Rudder account) — **bcrypt is never evaluated** | portal said the credentials are correct; a local row is still required because Rudder needs its own `id`/`role`/`slackUserId`, not just proof of identity |
   | `disabled` | portal `401` with body `{"detail": "User account is disabled"}` | return `null` directly — **bcrypt is never evaluated** | portal-confirmed the account exists and is disabled — distinguishable, not ambiguous; added 2026-08-03 on branch `fix/portal-disabled-account`, see the correction below the table this row replaces |
   | `rejected` | portal `401` with any other body (wrong password, unknown username) or an unreadable/missing/non-JSON 401 body | **fall through** to the local bcrypt check | still ambiguous — wrong password *or* `portalId` not yet provisioned in the portal; since coverage is unconfirmed (below), the local hash is tried as a second, independent credential rather than declaring the user locked out |
   | *(throws)* | portal `429`, any `5xx`, or the `fetch` call itself rejects (DNS/timeout/connection refused) | propagates out of `verifyCredentials`, uncaught until the login route's existing `withErrorEnvelope` turns it into a generic 500 | bucketed as "the check didn't happen," not "the check said no" — see the 429 discussion below |

   (Original table returned a bare `boolean | null` — `true`/`false`/`null` — with `false`
   covering `401` unconditionally. `checkItPortal` was extended on 2026-08-03,
   branch `fix/portal-disabled-account`, to a four-way `'accepted' | 'rejected' |
   'disabled' | null`, splitting the old `false` row into `disabled` and `rejected`
   above. See the correction in "The local fallback does not expire" below — its
   original premise that a portal `401` is indistinguishable across all three
   underlying causes was wrong for the disabled case.)

3. Local bcrypt check against `passwordHash`, unchanged from Phase 1
   (including the constant-time-ish equalizer hash for unknown users).

`.env.example` — added `IT_PORTAL_LOGIN_URL=` (empty; the deploy runbook in
Task 14 sets it to `https://<internal-portal-host>/api/v1/auth/login` on the
production VM once the live check below has run).

### Why a 429 throws instead of falling back to bcrypt

A 429 is not `401` and isn't `res.ok`, so it lands in the throw branch above —
same treatment as a 5xx or a network failure, and the bcrypt fallback is
never attempted for it. This is deliberate, not an oversight:

- A 429 means the portal didn't evaluate the credentials, not that it
  rejected them. Bucketing it with the `401` branch would make requests that
  were never checked behave like requests that failed.
- The portal rate-limits **per source IP** at 5/minute. Once
  `IT_PORTAL_LOGIN_URL` is live, every Rudder user's login shares Rudder's
  single production VM IP against that one budget — so 429s are expected
  under ordinary concurrent use (several teammates logging in within the
  same minute), not just under abuse. Falling back to bcrypt on a 429 would
  mean a user fully migrated to the portal — who may no longer remember or
  use their original Phase-1 seeded local password — gets checked against a
  password they don't actively use, specifically during the load spikes that
  trigger the rate limit. The same correct password would then succeed or
  fail depending on request timing alone: a non-deterministic failure mode,
  and the worst possible moment for "shared login" to silently stop being
  true.
- This is symmetric with the already-established 5xx/network-failure rule:
  both are "the portal couldn't tell us," not "the portal said no."

Residual cost: the resulting generic 500 (`withErrorEnvelope`'s flat "서버
오류가 발생했습니다") looks, to the user, identical to "the database is down,"
which overstates a self-clearing, sub-minute condition. A friendlier signal
("잠시 후 다시 시도해주세요" specifically for 429) would need a typed exception
that the login route catches before the generic envelope — that touches
`route.ts`, outside this function's frozen signature and this task's scope.

**PO decision (post-review):** requested an IP-allowlist exemption from the
portal team for Rudder's production VM instead of any code-level
accommodation for the shared rate limit. `checkItPortal`'s throw-on-429
behavior stands as written and should not be changed for this.

### The local fallback does not expire — corrected 2026-08-03 (branch `fix/portal-disabled-account`)

This section originally claimed the bcrypt fallback is **unconditional and
permanent** because the portal's `401` supposedly "fires identically for
'wrong password' and for 'unknown or disabled user'". **That premise was
wrong** — verified directly against `Tyche-Technology/<internal-portal-repo>`'s
`backend/app/api/v1/auth.py`: the disabled-account check is a *separate*
branch, reached only after the password check passes, raising `HTTPException(401,
"User account is disabled")` — a different `detail` string from the generic
`"Invalid username or password"` used for both wrong password and unknown
username. The 401 is not a single case; it is (at least) two, and one of
them was distinguishable all along.

**What's closed:** `checkItPortal` now reads the `401` body and returns a
distinct `'disabled'` outcome for that message, and `verifyCredentials`
returns `null` for it without ever consulting the local hash (see
`src/lib/auth.ts`, `isPortalDisabledAccountResponse`, and the corrected table
above). A Rudder user whose portal account is off-boarded or disabled for
cause can no longer keep logging in with their Phase-1 seeded local
password — that half of "permanent second door" is shut as of this branch.

**What's still open:** the portal's `401` still fires identically, with no
way for `checkItPortal` to tell them apart, for an **unknown-to-portal**
`portalId` and a **wrong password** for a real, active account. Those two
remain a standing second door for the same reason as before — nothing
distinguishes them in the response. **"Shared login with IT Portal" is now
true for the disabled-account case; it is not yet fully true for the
unknown-user/wrong-password case.**

Exit condition — what has to be true before the bcrypt branch can be deleted
entirely, for the two cases that remain (unknown-to-portal id, wrong
password):
1. Every current Rudder `portalId` maps to a portal account, and portal
   coverage across all ~10 users is confirmed (not just spot-checked).
2. At least one real login round-trip verified end-to-end against the live
   portal (see below — still outstanding).

(The original exit condition's third item — a policy decision on
portal-account provisioning at onboarding and on immediate-vs-eventual
lockout timing for a portal-side disable — is moot for the disabled-account
case: the check is already immediate, at every login attempt, not "eventually
consistent." It may still matter for onboarding process hygiene, but it is
not a blocker for closing this exit condition and is dropped from it here.)

Once 1–2 hold: delete the `rejected → fall through` line and the bcrypt
branch entirely, and drop `bcryptjs`/`TIMING_EQUALIZER_HASH` from `auth.ts`
(a net deletion, not new work). Until then, the fallback for
unknown-user/wrong-password is the correct launch-bridge state — it matches
the brief's own "remove only if full coverage" condition — but it is a
standing exception to name, not a mystery to inherit.

### Tests (TDD — RED confirmed before implementation, GREEN after)

`tests/domain/auth.test.ts` — the original 2 tests are unchanged (bcrypt-only
path, `IT_PORTAL_LOGIN_URL` unset) plus 7 new tests covering: portal 200
overrides a wrong local hash; portal 200 for a portalId with no local Rudder
row returns `null`; portal 401 falls back to the local hash (both the
succeeds-locally and fails-both cases); portal 5xx throws; a network failure
(rejected fetch) throws; empty password still short-circuits before any
network call. All mock `fetch` via `vi.stubGlobal`, matching the existing
convention in `tests/domain/slack.test.ts` — no real network call in the unit
suite.

```
npx vitest run --dir tests/domain -t "verifyCredentials"   → 9 passed
npx vitest run --dir tests                                  → 435 passed (35 files)
npm run coverage:gate                                        → PASS
  overall: 86.77% stmts / 83.57% branch / 86.92% funcs / 89.4% lines (gate: 80%)
  src/lib/auth.ts itself: 100% statements, 100% functions, 100% branches
```

## What's NOT done: live verification against the real portal

The brief requires "live verification against the real portal with a real
account before 'done'." I do not have a portal account I'm authorized to test
with, and I did not use one without asking:

- `gcloud secrets list` surfaced `itportal-username` / `itportal-password` in
  Secret Manager. Tracing their usage (`gh search code`) shows they belong to
  an **archived** BigQuery ETL scraper (`tyche_pipeline` /
  `<internal-dashboard>/pipeline`, `cloud_run/_archived/itportal-*-etl`) that logged
  into the portal's *old* Flask backend, created 2025-12-30 — before the
  FastAPI rewrite this task found live today. Whether that account still
  exists in the new `users` table is unknown, and it wasn't provisioned for
  this task. Using it without asking felt like exactly the kind of call this
  task said to surface rather than guess at.
- No other test/service credential for the current backend was found in this
  session's reachable secrets or env.

**Status update (post-review):** the PO is verifying the endpoint by hand
with their own account, so this live round-trip is being confirmed outside
this task — not by this task's own commit. The check remains, for the
record:
```
curl -s -X POST https://<internal-portal-host>/api/v1/auth/login \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'username=<portalId>&password=<password>'
→ expect HTTP 200 + access_token
```
then setting `IT_PORTAL_LOGIN_URL` in Rudder's own `.env` and logging in
through Rudder's `/api/v1/auth/login` end-to-end with that same account.
Until `IT_PORTAL_LOGIN_URL` is set, Rudder ships and runs on local bcrypt
only — the pre-agreed fallback, not a blocker to launch.

## Operational notes for Task 14 (launch runbook)

- The portal's login route is rate-limited to 5 requests/minute **per
  source IP** (`slowapi`, `get_remote_address`). Once `IT_PORTAL_LOGIN_URL`
  is set, every Rudder login from every user is proxied through this check
  from Rudder's single production VM IP — the limit is shared across all
  ~10 users, not per-user. See "Why a 429 throws instead of falling back to
  bcrypt" above for the failure mode this causes and why the code doesn't
  compensate for it.
- **PO decision:** requested an IP-allowlist exemption from the portal team
  for Rudder's production VM, rather than a code-level accommodation (retry,
  fallback, etc.) for the shared rate limit. Run on local passwords
  (`IT_PORTAL_LOGIN_URL` unset) until the allowlist lands; `checkItPortal`'s
  throw-on-429 is not to be changed for this.
