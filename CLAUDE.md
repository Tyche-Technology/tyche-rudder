# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. `AGENTS.md` is a symlink to this file, so other coding agents (Codex, Gemini CLI, …) read the same content.

**README.md is the operational source of truth** — it documents every hard-won constraint in detail (Korean). This file is the digest; when in doubt, read the README section it points to.

## What this is

Rudder — Tyche's internal issue tracker (Next.js 16, React 19, Drizzle + Postgres 15). Statuses use a maritime metaphor in UI copy; enum values stay standard English (`inbox`, `backlog`, `in_progress`, `done`, `rejected`, `on_hold`). User-facing strings are Korean.

## Commands

```bash
docker compose up -d              # local Postgres 15 on :5432
npm run dev                       # check first: lsof -iTCP:3000 -sTCP:LISTEN -P
npm test                          # vitest on PGlite (in-memory WASM Postgres), excludes tests/e2e
npx vitest run tests/domain/issues.test.ts   # single test file
npm run coverage:gate             # per-slice 80% gate: src/domain, src/lib, src/ui each
npm run build && npm run test:e2e # Playwright; harness self-manages Postgres :5435, mock Slack :3299, app :3200
npm run db:generate               # drizzle-kit: emit migration from schema.ts changes
npm run db:migrate
npm run seed:admin                # first admin only; needs SEED_ADMIN_EMAIL/PASSWORD(≥8)/NAME
npm run create-token <name>       # agent Bearer token
npm run revoke-token <name>       # sets revoked_at (prod: node scripts/revoke-token.mjs — bundled)
```

There is no lint script.

## Conventions

- Strict TypeScript, two-space indent, single quotes, no semicolons. `camelCase` variables/functions, `PascalCase` components/types, kebab-case filenames.
- User-facing copy is Korean; enum/API values, identifiers, and committed docs are English.
- Tests: `*.test.ts(x)` for vitest, grouped by layer under `tests/{domain,api,lib,ui}`; `*.spec.ts` for Playwright under `tests/e2e`. Add coverage beside the affected layer.
- Commits: conventional prefixes (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`), imperative and focused. PRs explain behavior changes, link the spec/issue, list verification commands, include screenshots for visible UI changes, and call out migrations and env changes explicitly.
- Secrets: copy `.env.example` to `.env.local`; generate your own `BETTER_AUTH_SECRET` (≥32 chars) and set `BETTER_AUTH_URL` to the browser-facing origin (see README). Never put credentials or production data in fixtures, logs, screenshots, or docs.

Dev-server rules (README "dev 서버는 한 번에 하나만"): Next 16 takes a per-project dev lock — a second `next dev` dies with an error that is invisible when stdio is discarded, so verify the port, not `pgrep`. `tests/api/session-live.test.ts` boots its own dev server (:3101) and Postgres container (:5434); never run a dev server while it runs. In parallel worktrees, scope vitest with `--dir tests` or worktree copies of session-live fight over ports.

## Architecture invariants

**The web UI is a client of the REST API.** `/api/v1/*` IS the product API — web, Slack bot, and AI agents all call the same endpoints.

```
src/app/api/v1/**   REST API (thin routes; respond.ts maps error kinds → HTTP status)
src/domain/**       business rules + event recording; every mutation passes through here with an actor
src/db/**           Drizzle schema + client
src/ui/**           shared components/hooks — client of the API only
src/app/(app)/**    the five screens
design/**           approved mockups + token source (rudder.css)
```

- `src/ui/**` and `src/app/(app)/**` MUST NOT import `src/db` or `src/domain`. UI declares its own types in `src/ui/types.ts` — the duplication is deliberate.
- Domain functions return `DomainError` with `kind: 'not_found' | 'conflict' | 'rule'` (`src/domain/result.ts`); routes never infer status codes from message text. Errors are wrapped by `src/lib/with-error-envelope.ts`.
- The status machine lives in `src/domain/transitions.ts`: backlog entry requires a priority, rejected/on_hold require a reason, rejected is terminal.
- Optimistic locking uses an explicit `version` column — never timestamp comparison (timestamps burned us: see Testing).
- Auth: humans use better-auth DB-backed sessions after invite-based email/password or optional Google login; agents send `Bearer rud_*` (sha256 hash stored). Role and banned status are re-read from the DB on every request (`src/lib/api-auth.ts` deliberately has no cookie cache), so account changes take effect immediately. Self-service signup is disabled; bootstrap the first admin with `npm run seed:admin`, then invite users from `/crew`.
- CSS tokens: `design/rudder.css` is the source, `src/app/globals.css` is its copy. Every style change goes into BOTH files identically (only the two font-loading lines differ).
- `@/` aliases `src/` (tsconfig + vitest).

## Time is always KST

Everything displayed is fixed to Asia/Seoul regardless of browser/server TZ, owned by `src/ui/format.ts` — never slice ISO strings or call `toLocaleString()` in components. Two distinct kinds (README "시간 표시는 항상 KST"):

- **Instants** (`createdAt`, …): stored UTC, converted to KST via `formatDateTime()`/`shortDate()`. "Today" comparisons use `kstDayMillis()`.
- **Date labels** (milestone `startsOn`/`endsOn`): Postgres `date` columns — there is no instant to convert; render via `dateLabel()`.

TZ tests deliberately pin `process.env.TZ` to a non-KST zone; keep that pin or regressions become invisible on KST hosts.

## Testing: green ≠ production

Unit/API tests run on PGlite; production runs postgres-js + real Postgres. Known divergences (README "Testing"): timestamp precision (µs vs ms — this broke optimistic locking in prod while 191 tests passed), transaction serialization (PGlite can't show concurrency races), and KST-host clock skew. If you touched transactions, timestamps, concurrency, or driver error shapes, verify against real Postgres (E2E suite or `scripts/verify-concurrency.ts`) before claiming done.

Coverage thresholds are per-slice (`src/domain`, `src/lib`, `src/ui` each ≥80% independently), enforced by `scripts/coverage-gate.sh`, which also fails if any include glob matches zero files.

## Deploy

`master` push → GitHub Actions → GHCR image → GCP VM `tyche-rudder` (Tailscale-only, no public IP, cloud-sql-proxy sidecar). Migrations run before the container swap; `/api/health` polling drives automatic rollback — that endpoint checks config validity, not just liveness, and is the real safety net (Next 16's `register()` does NOT reliably kill the prod server; `scripts/docker-entrypoint.sh` validates `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL` and rejects `STORAGE_EMULATOR_HOST` before Node loads). Migration 0003 is one-way (`timestamp` → `date`); rollbacks across it need a schema decision. Details: README "Deploy".

## Docs

`docs/superpowers/` holds specs/plans/reviews. The PRD (`specs/2026-07-30-issue-tracker-design.md`) is binding — §7 naming rules, §10 AI guardrails. `design/index.html` is the living style guide.
