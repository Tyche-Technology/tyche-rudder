# Rudder

[한국어](README.md) | English

Tyche's internal issue tracker. It brings requests from Slack, the web, and bots
into one place for grooming, backlog ordering, and roadmap progress tracking.

Statuses use a maritime metaphor in the UI: Inbox, Backlog, In Progress, Done,
Rejected, and On Hold. Enum values in the code remain standard English
(`inbox`, `backlog`, ...).

## Architecture

**The web UI is a client of the REST API.** `/api/v1/*` is the API itself, and
the web app, Slack bot, and AI agents all use the same endpoints. Therefore:

- `src/ui/**` and `src/app/(app)/**` **must not import** `src/db` or `src/domain`.
  Types needed by the UI are declared separately in `src/ui/types.ts`; this
  duplication is intentional.
- Every mutation passes through a domain function that records its actor. No
  business logic exists only in the UI.

```
src/app/api/v1/**   REST API (= the API)
src/domain/**       business rules and event recording
src/db/**           Drizzle schema and client
src/ui/**           shared components and hooks (API clients)
src/app/(app)/**    the five screens
design/**           approved design mockups and token source (rudder.css)
```

`design/rudder.css` is the source of truth for tokens and components, and
`src/app/globals.css` is its copy. Add every style to **both files identically**.
Only the two font-loading lines intentionally differ.

## Setup

```bash
npm install
docker compose up -d          # Postgres 15, default port 5432
cp .env.example .env.local    # DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL
npm run db:migrate
SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... SEED_ADMIN_NAME=... npm run seed:admin
                              # Creates the first admin only. Add later users by invitation.
npm run dev                   # http://localhost:3000
```

You **must generate your own** `BETTER_AUTH_SECRET`. `.env.example` deliberately
contains a rejected placeholder: anyone who knows a shared value could
otherwise forge a valid session for an arbitrary user ID. The value must be at
least 32 characters long, matching better-auth's entropy requirement.

Set `BETTER_AUTH_URL` to the browser-facing origin as well. The trusted-origin
guard in `src/lib/api-auth.ts` uses it as its trust root. This project builds
with `output: "standalone"` and does not enable
`experimental.trustHostHeader`, so leaving it unset makes the guard fall back
to the server's bind origin (`HOSTNAME`/`PORT`). That never matches the real
browser Origin, and every cookie-bearing state-changing request is rejected
with 401.

`register()` in `src/instrumentation.ts` validates `BETTER_AUTH_SECRET` **at
startup**. During `npm run dev`, the process exits immediately if the value is
missing, is the placeholder, or is shorter than 32 characters. This guarantee
applies only to development, however. In the actual Next 16 production server
(`next start` or the standalone `server.js` deployed by this project), an exception from
`register()` does not reliably terminate the process. `NextServer.prepare()`
runs `register()` in a fire-and-forget path and swallows its failure as a
background 500. This was traced in `node_modules/next/dist/server/next.js` and
reproduced with the actual image built by `docker build`. The deployment
therefore relies on two safeguards outside Next:

- `scripts/docker-entrypoint.sh`: the container `CMD`. It validates both
  `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` before loading Next and never
  starts `node server.js` if either is invalid. Direct `docker run`
  reproduction confirmed that an invalid secret makes the container reach
  `Exited (1)` immediately and leaves the port closed. URL readers normalize
  it through `new URL(value).origin`, so a harmless trailing slash is accepted.
- `GET /api/health`: this checks configuration validity as well as liveness.
  The deployment pipeline decides whether to roll back by **polling this
  endpoint**, not by waiting for the process to exit. See the healthcheck in
  `deploy/docker-compose.prod.yml` and the wget loop in
  `.github/workflows/deploy.yml`. This is the effective safety net.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

If local Postgres uses another port, update `DATABASE_URL` in `.env.local`.

**Postgres was downgraded from 16 to 15, and the volume was renamed from
`rudder-pgdata` to `rudder-pgdata-pg15`.** Postgres 15 cannot open a data
directory initialized by 16, so reusing the old volume causes
`docker compose up -d` to enter a crash loop. The new volume name keeps the
data separate. Local development data is reproducible with
`npm run seed:admin`, so this is safe. After the new `rudder-pgdata-pg15`
volume starts successfully, the old volume (`<project>_rudder-pgdata`, usually
`<directory-name>_rudder-pgdata`) remains on disk as an orphan. Remove it with
`docker volume rm <project>_rudder-pgdata` if it is no longer needed.

## Only one development server at a time

Next 16 takes a **per-project development server lock**. A second `next dev`
exits with an explicit error, so it does not corrupt artifacts, but it also
does not start. When a parent process discards child-process stdio, as the
`session-live` test does, that error is invisible and appears as an unexplained
failure. One orphaned server previously caused the entire test to fail.

- Before `next dev`, check the port with
  `lsof -iTCP:3000 -sTCP:LISTEN -P`.
- If a test was interrupted, clean up any remaining `next-server` process
  first. A `pgrep` immediately after `pkill` can race ahead of process
  termination and falsely report success; verify the port instead.
- `tests/api/session-live.test.ts` starts and stops its own development server
  on port 3101 and Postgres container on port 5434. Do not run another
  development server while this test is running.
- When several git worktrees run in parallel, scope Vitest with a path such as
  `npx vitest run --dir tests`. Running it without arguments can discover test
  trees in other worktrees, whose copies of `session-live` then compete for the
  same ports.

## Testing

```bash
npm test                      # Vitest with in-memory PGlite Postgres
npm run coverage:gate         # >=80% coverage for src/domain, src/lib, and src/ui
```

Run browser journeys separately against real Postgres 15 and the production
build. The E2E harness owns Postgres on port 5435, mock Slack on port 3299, a
localhost GCS-compatible server on port 3300, migrations, seeding, and cleanup.
An E2E-only Node preload redirects Slack, while object operations use the real
Storage SDK path. The Docker image excludes both test surfaces, and its
entrypoint rejects `STORAGE_EMULATOR_HOST`, so production keeps the fixed Slack
URL and real GCS boundary.

```bash
lsof -iTCP:3200 -sTCP:LISTEN -P
npm run build
npm run test:e2e              # next start :3200 + Playwright Chromium
```

On branches without `scripts/migrate.mjs`, the harness runs
`npx drizzle-kit migrate` directly. Failure traces and screenshots are written
to `test-results/e2e/`.

The coverage gate covers `src/domain`, `src/lib`, and `src/ui`.
`coverage.include` in `vitest.config.ts` explicitly includes `src/ui/*.tsx`.
Because V8 already includes component `.tsx` files loaded by tests in its
artifacts, this makes the declared measurement scope match the actual one. The
project recognizes that wider measurement instead of narrowing the
configuration to exclude it.

Thresholds apply **per slice**, not to the combined average. Each of
`src/domain/**`, `src/lib/**`, and `src/ui/**` must independently reach 80% for
statements, branches, functions, and lines. This uses Vitest
`coverage.thresholds[glob-pattern]` without `perFile`: stronger files can still
offset weaker files within one slice, but one slice can no longer hide another.
The previous combined average allowed healthy `domain` coverage to conceal
weak `ui` coverage. `scripts/coverage-gate.sh` first verifies that all four
include globs (`src/domain/**/*.ts`, `src/lib/**/*.ts`, `src/ui/*.ts`, and
`src/ui/*.tsx`) match at least one file. If any glob matches zero files, the
gate fails instead of silently passing an empty measurement scope.

**A green test suite does not prove production behavior.** Tests run on PGlite
(WASM Postgres), while production uses postgres-js and real Postgres. They
diverge in the following areas:

- **Timestamp precision**: Postgres `now()` has microsecond precision, while a
  JS `Date` parsed by postgres-js has millisecond precision. This difference
  caused Phase 1 optimistic locking to fail on every production attempt even
  though all 191 tests passed. The application now uses an explicit `version`
  column.
- **Transaction serialization**: PGlite serializes work through one connection,
  so tests cannot expose concurrency races.
- **Timezone skew**: on a KST host, PGlite's `defaultNow()` is about nine hours
  ahead of JS `Date.now()`. A one-sided boundary assertion can pass while
  proving nothing.

If you touch transactions, timestamps, concurrency, or driver error shapes,
verify the behavior against **real Postgres** before claiming completion.

## Time is always displayed in KST

Every time shown in the UI is fixed to **Asia/Seoul**, regardless of the
browser or server timezone. The team must share one clock for questions such
as when a request arrived to have a consistent answer.

There are two distinct kinds of dates, both owned by `src/ui/format.ts`.
Components must not slice ISO strings or call `toLocaleString()` for display.
Extracting year or month numbers for calculations, such as roadmap quarter
keys, is not display formatting and is an exception.

| Kind | Example | Function | Rule |
|------|---------|----------|------|
| **Instant** | `createdAt`, `updatedAt` | `formatDateTime()` and `shortDate()` | Store in UTC, then **convert to KST** for display |
| **Date label** | milestone `startsOn`/`endsOn` | `dateLabel()` | Store as a Postgres `date` value. There is no instant to convert. |

**Comparisons also use KST.** The roadmap's "today" is an instant and is
converted with `kstDayMillis()` (`todayMillis` in `timeline.ts`). A milestone
due on July 31 therefore becomes overdue at **midnight KST on August 1**, not
at midnight UTC (9 a.m. KST) or the browser's local midnight. Ship position,
D-day, and panel chips all use this one answer.

A milestone deadline is not converted because it is a **label** such as "due
July 25," not a particular instant. The database column is a Postgres `date`,
so it has neither a time nor a timezone. The stored value is already
"July 25," and there is nothing to convert. Before Phase 3, this value was
stored as UTC midnight in a `timestamp` column. Converting it to KST happened
to preserve the date only because KST is east of UTC; local conversion on a
host west of UTC produced the previous day. Moving to a `date` column removed
that coincidence entirely.

Timezone tests (`tests/ui/format.test.ts` and `tests/ui/timeline.test.ts`) pin
`process.env.TZ` to a zone outside KST. Because the code names KST explicitly,
the values remain identical everywhere, but a regression to local date getters
would be invisible on a KST host. Since this suite is usually run on Seoul
laptops, removing the pin would prevent the tests from detecting exactly that
regression.

## Auth

Humans sign in with invite-based email/password or optional Google OAuth.
Agents continue to use `Bearer rud_*` tokens; that path did not change in the
better-auth migration.

```bash
npm run create-token <name>   # Issue an agent token
npm run revoke-token <name>   # Revoke an agent token (revoked_at; production uses scripts/revoke-token.mjs)
```

There is no self-service signup. Bootstrap the first admin with
`npm run seed:admin` (`SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, and
`SEED_ADMIN_NAME`), then invite later users from the **Crew** page (`/crew`).
Invites are single-use and expire after seven days. `disableImplicitSignUp`
also prevents an uninvited Google account from creating a user; Google may only
link to an existing invited email. Configure the OAuth redirect URI as exactly
`<BETTER_AUTH_URL>/api/auth/callback/google` and leave Authorized JavaScript
Origins empty, because `disableIdTokenSignIn: true` deliberately closes that
alternate login path.

Sessions are DB-backed rather than stateless. `src/lib/api-auth.ts` deliberately
does not enable better-auth's cookie cache, so role and banned status are read
from the database on every request. Demoting or banning a user therefore takes
effect immediately instead of waiting for a cookie to expire.

## Deploy

A push to `master` that changes a relevant path, or a `workflow_dispatch`,
deploys to the GCP VM `tyche-rudder` in `asia-northeast3-a`. The VM is available
only on the Tailscale tailnet and has no public IP. It is a VM rather than Cloud
Run because the Cloud SQL instance `tyche-db` is in the same region and can be
reached locally through the `cloud-sql-proxy` sidecar. People connect only
through `tailscale serve`; ts.net terminates TLS, so `Secure` cookies work as
intended. With no public ingress, login rate limiting was intentionally left
out of Phase 3.

```
push(master) -> build & push (GHCR, digest pin)
             -> migrate.mjs (before container replacement; the old container keeps serving on failure)
             -> docker compose up -d
             -> /api/health check -> automatic rollback to the :rollback tag on failure
```

- `Dockerfile`: a three-stage `node:22-alpine` build (deps, builder, runner),
  non-root `node` user, and `output: 'standalone'`. `drizzle-orm` and `postgres`
  are copied explicitly into the runtime stage because standalone tracing
  misses them: the build graph does not include `migrate.mjs`. Both packages
  have no dependencies of their own, so copying them is sufficient. `CMD` is
  `scripts/docker-entrypoint.sh`, not `node server.js`; see the
  `BETTER_AUTH_SECRET` section above. It validates `BETTER_AUTH_SECRET` and
  `BETTER_AUTH_URL` with `sh` before Next starts.
- `scripts/migrate.mjs`: applies migrations with runtime dependencies only,
  without adding the `drizzle-kit` development dependency to the image.
  Migrations 0004 through 0006 are additive, so a failure does not require a
  schema rollback. **Migration 0003 is the exception**: it changes
  `milestones.starts_on` and `ends_on` from `timestamp` to `date` in one
  direction. The deployment applies migrations before replacing the container,
  while rollback replaces only the image and leaves the schema in place. After
  0003, a rollback image still interprets the `date` column's `"YYYY-MM-DD"`
  string as if it were a `timestamp`. The first deployment has no rollback
  image and is unaffected, but rollbacks across this boundary from the second
  deployment onward require an explicit schema decision.
- `deploy/docker-compose.prod.yml`: two services, `rudder` and
  `cloud-sql-proxy`. Secrets (`DB_PASSWORD`, `BETTER_AUTH_SECRET`,
  `BETTER_AUTH_URL`, `SLACK_BOT_TOKEN`, `APP_BASE_URL`, `GCS_BUCKET`, and the
  optional `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`) are not stored in
  committed files; they come from the VM environment (`.env`). The service
  account key is mounted read-only from the VM disk with
  `./credentials:/credentials:ro`.
- GitHub Actions secrets: `VM_HOST` (tailnet name `tyche-rudder`),
  `VM_USERNAME`, `VM_SSH_KEY_BASE64`, `TS_OAUTH_CLIENT_ID`, and
  `TS_OAUTH_SECRET`.
- VM, database, bucket, and secret provisioning belongs to a separate runbook
  (Task 14, executed after PO confirmation).

## Docs

| Document | Description |
|----------|-------------|
| `docs/superpowers/specs/2026-07-30-issue-tracker-design.md` | PRD (the naming rules in Section 7 and AI guardrails in Section 10 are binding) |
| `docs/superpowers/design/2026-07-30-rudder-design-system.md` | Design system specification (tokens, signal flags, timeline rules, and copy deck) |
| `docs/superpowers/plans/2026-07-30-rudder-overview.md` | Phase overview and carryover items |
| `design/index.html` | Living style guide (open it in a browser) |

## License

Rudder is distributed under **GNU AGPL-3.0-only**. The original [LICENSE](LICENSE)
controls; the summary below is informational and not legal interpretation.

Copyright © 2026 Tyche Technologies Co., Ltd.

- If you **modify this software and provide it over a network**, AGPL Section 13
  may require you to offer the modified source to users.
- Third-party components, including npm dependencies, remain subject to their
  original licenses. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
- This license does not grant rights to use the "Tyche" name, logo, or other
  brand assets. See [TRADEMARKS.md](TRADEMARKS.md).
- See [CONTRIBUTING.md](CONTRIBUTING.md) and [CLA.md](CLA.md) for contribution
  terms and the CLA draft, which has not yet received legal review.
