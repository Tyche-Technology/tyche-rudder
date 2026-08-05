# Rudder Phase 3 — Integrations & Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Rudder to production — API contract hardening (optimistic locking, error surfacing, date columns), attachments, Slack notifications, Hermes bot intake, Playwright E2E, and a Tailscale-fronted VM deploy.

**Architecture:** Architecture A unchanged — every client (web UI, Hermes bot, agents) talks to `/api/v1/*`; every mutation goes through an actor-attributed domain function. Production is a new e2-small VM (`tyche-rudder`, asia-northeast3-a) on the tailnet, a `rudder` database on Cloud SQL `<cloud-sql-instance>` via cloud-sql-proxy sidecar, and one private GCS bucket.

**Tech Stack:** Next.js 16.2.12, Drizzle 0.45, zod 4, PGlite (unit) + Postgres 15 (E2E/prod), Playwright, `@google-cloud/storage`, GitHub Actions → GHCR → VM.

**Spec:** `docs/superpowers/specs/2026-08-03-rudder-phase3-launch-design.md` — binding. PRD §7 naming and §10 AI guardrails remain binding.

## Global Constraints

- Coverage gate ≥80% on `src/domain`, `src/lib`, `src/ui` (`npm run coverage:gate`). Never mock a live test to move the number.
- **Green PGlite ≠ production proof.** Anything touching transactions, timestamps, concurrency, or driver error shapes gets a real-Postgres check before "done" (docker `postgres:15`).
- Regression tests are **mutation-verified**: run them against pre-fix code and watch them fail first.
- Every task passes two independent gates — Claude task review + Codex adversarial review. Reviewers write verdicts to files under `.superpowers/sdd/2026-08-03-rudder-phase3-launch/reviews/`; the orchestrator reads the files (reviewers often end idle without delivering a message). No self-review of self-implemented code.
- Ledger: `.superpowers/sdd/2026-08-03-rudder-phase3-launch/progress.md`.
- Parallel lanes use in-repo `.worktrees/` + relative symlinks for `node_modules`/`.env.local`; while any worktree exists, run suites as `npx vitest run --dir tests`.
- Before any `next dev`/`next start`: `lsof -iTCP:3000 -sTCP:LISTEN -P` (Next 16 holds a project-wide dev-server lock). `tests/api/session-live.test.ts` self-manages :3101/:5434.
- UI copy Korean (nautical pairs per PRD §7); enums/code/commits English. Display formatting only via `src/ui/format.ts`.
- KST rules: instants convert to KST; milestone dates are labels, never timezone-converted. TZ-pinned tests stay pinned to `America/Los_Angeles`.
- `npm audit fix --force` is **forbidden** (downgrades next→9.3.3).
- GCP project `<gcp-project-id>` only. Slack channel `<slack-channel-id>`. Prod DB = database `rudder` on instance `<cloud-sql-instance>`.
- Production-touching steps (T14) present affected scope + rollback line and get explicit PO confirmation before executing.

## Task order & lanes

Sequential spine: T1 → T2 → T3 → T4 → T5 (they share `validation.ts`/`respond.ts`/routes — do NOT parallelize these five).
After T5: lanes may run in parallel worktrees — Lane A: T6, T7→T8→T16; Lane B: T9, T10, T17; Lane C: T11, T15 (bot repo — separate repo, always safe); then T12 → T13 → T14 sequentially on the merged tree.

**Tasks 16 and 17 were added mid-execution (2026-08-03) by PO decision** after T5's review surfaced two questions the plan had not answered. Both are in `docs/superpowers/plans/2026-08-03-rudder-phase3-launch.md` below Task 15. T16 must land before the branch merges — until it does, four routes show a less helpful message than they did before T5.

---

### Task 1: Dependency security overrides

Closes all 5 open dependabot alerts (3 high: postcss ×2, sharp ×1; 2 moderate: postcss, esbuild). `next@16.2.12` is the latest release and pins `postcss@8.4.31` / `sharp@^0.34.5`, so `overrides` is the only path.

**Files:**
- Modify: `package.json`

**Interfaces:** none (dependency-only).

- [ ] **Step 1: Add overrides to package.json** (top level, after `devDependencies`):

```json
"overrides": {
  "postcss": "^8.5.18",
  "sharp": "^0.35.0",
  "@esbuild-kit/core-utils": { "esbuild": "^0.25.0" }
}
```

- [ ] **Step 2: Reinstall and verify resolution**

Run: `npm install && npm ls postcss sharp esbuild`
Expected: postcss ≥8.5.18, sharp ≥0.35.0 under next; esbuild ≥0.25.0 under `@esbuild-kit/core-utils` (drizzle-kit's own esbuild was already 0.25.x).

- [ ] **Step 3: Audit**

Run: `npm audit`
Expected: 0 high. (If sharp 0.35 has no darwin/linux binary for this Node — unlikely — stop and report; do not force.)

- [ ] **Step 4: Full verification**

Run: `npm test && npm run build && npx drizzle-kit generate`
Expected: 358 tests pass; build clean; drizzle-kit reports no schema changes (proves the loader still works under the esbuild override). Delete any accidentally generated empty migration.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "fix: force-resolve postcss/sharp/esbuild past dependabot alerts via overrides"
```

---

### Task 2: Milestone dates become `date` columns (migration 0003)

Wire carries `"2026-07-25"`; `wireDate()`/`wireDateFull()` and the UTC-midnight convention die.

**Files:**
- Modify: `src/db/schema.ts` (milestones startsOn/endsOn), `src/lib/validation.ts` (isoDate), `src/domain/catalog.ts` (types), `src/ui/format.ts` (delete wireDate/wireDateFull, add dateLabel), `src/ui/timeline.ts:4,122`, `src/ui/horizon.tsx:8,130`, `src/app/(app)/roadmap/page.tsx:11,227-228,266,271`, `src/ui/milestone-dialog.tsx:9,17-19`, `src/ui/types.ts` (comment)
- Create: `drizzle/0003_*.sql` (generated)
- Test: `tests/ui/format.test.ts`, `tests/ui/timeline.test.ts`, `tests/domain/catalog.test.ts`, `tests/domain/schema.test.ts`

**Interfaces:**
- Consumes: current `milestones.startsOn/endsOn: timestamp`.
- Produces: `milestones.startsOn/endsOn: date mode 'string'` → domain/patch types `string | null`; `dateLabel(date: string): string` in `src/ui/format.ts` (replaces `wireDate`); `<input type="date">` value = wire string as-is (no helper). T3+ build on the string types.

- [ ] **Step 1: Write failing tests first.** In `tests/domain/catalog.test.ts` change milestone create/update fixtures to plain strings and assert string round-trip:

```ts
const created = await createMilestone(db, admin, { name: 'Q3', startsOn: '2026-07-01', endsOn: '2026-09-30' })
expect(created.ok && created.milestone.startsOn).toBe('2026-07-01')
```

In `tests/ui/format.test.ts` replace the wireDate/wireDateFull block:

```ts
it('dateLabel trims a wire date to MM-DD without timezone math', () => {
  expect(dateLabel('2026-07-25')).toBe('07-25')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/domain/catalog.test.ts tests/ui/format.test.ts`
Expected: FAIL (Date objects returned; `dateLabel` not exported).

- [ ] **Step 3: Schema + migration.** In `src/db/schema.ts` import `date` from `drizzle-orm/pg-core` and change:

```ts
startsOn: date('starts_on', { mode: 'string' }),
endsOn: date('ends_on', { mode: 'string' }),
```

Run: `npx drizzle-kit generate` → inspect the SQL. It must be exactly two `ALTER TABLE "milestones" ALTER COLUMN ... SET DATA TYPE date;` statements (timestamp→date uses Postgres's built-in assignment cast; no `USING` needed) and must NOT drop `milestones_range_ck`.

- [ ] **Step 4: Validation + domain types.** `src/lib/validation.ts`: `const isoDate = z.iso.date()` (drop `.transform`), and retype the range helper:

```ts
const validDateRange = (v: { startsOn?: string | null; endsOn?: string | null }) =>
  !(typeof v.startsOn === 'string' && typeof v.endsOn === 'string') || v.startsOn <= v.endsOn
```

`src/domain/catalog.ts`: `createMilestone` input `{ name: string; startsOn?: string; endsOn?: string }`, `updateMilestone` patch `{ name?: string; startsOn?: string | null; endsOn?: string | null; closed?: boolean }`. The merged-range comparison `mergedStartsOn > mergedEndsOn` is now a string comparison — correct for `YYYY-MM-DD` (lexicographic = chronological).

- [ ] **Step 5: UI.** `src/ui/format.ts`: delete `wireDate`/`wireDateFull`, add:

```ts
// A milestone date arrives as the calendar-day string the admin typed
// ("2026-07-25"). Display trims to MM-DD; there is nothing to convert.
export function dateLabel(date: string): string {
  return date.slice(5)
}
```

Replace `wireDate(` → `dateLabel(` at: `src/ui/timeline.ts:122`, `src/ui/horizon.tsx:130`, `src/app/(app)/roadmap/page.tsx:227,228,266,271` (and their imports). `src/ui/milestone-dialog.tsx`: `toDateInput` becomes `(iso: string | null) => iso ?? ''` and drops the `wireDateFull` import. `src/ui/types.ts`: update the ApiMilestone comment — startsOn/endsOn are bare `YYYY-MM-DD` strings. `timeline.ts`'s `dayMillis`/`e.milestone.endsOn.slice(0, 10)` already accept bare dates — leave them.

- [ ] **Step 6: Full suite + gate**

Run: `npm test && npm run coverage:gate && npx tsc --noEmit`
Expected: all green. Grep guard: `grep -rn "wireDate" src tests` → 0 hits.

- [ ] **Step 7: Real-Postgres migration check** (timestamps + migration = real-PG rule):

```bash
docker run -d --name pg15-mig -e POSTGRES_PASSWORD=t -p 5440:5432 postgres:15
DATABASE_URL=postgres://postgres:t@localhost:5440/postgres npx drizzle-kit migrate   # 0000..0002
docker exec pg15-mig psql -U postgres -c "INSERT INTO milestones (name, starts_on, ends_on) VALUES ('legacy', '2026-07-01T00:00:00Z', '2026-09-30T00:00:00Z')"
DATABASE_URL=postgres://postgres:t@localhost:5440/postgres npx drizzle-kit migrate   # applies 0003
docker exec pg15-mig psql -U postgres -c "SELECT starts_on, ends_on FROM milestones"          # → 2026-07-01 / 2026-09-30 (date)
docker exec pg15-mig psql -U postgres -c "UPDATE milestones SET starts_on='2026-10-01'"        # → must FAIL on milestones_range_ck
docker rm -f pg15-mig
```

Expected: values survive as dates; the CHECK still rejects an inverted range. Record the output in the ledger.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: milestone starts_on/ends_on become date columns; wireDate convention removed"
```

---

### Task 3: Milestone `version` column + CAS + `expectedVersion` (migration 0004)

**Files:**
- Modify: `src/db/schema.ts` (milestones), `src/domain/catalog.ts` (updateMilestone), `src/lib/validation.ts` (patchMilestoneSchema), `src/app/api/v1/milestones/[id]/route.ts`, `src/ui/types.ts` (ApiMilestone), `src/ui/milestone-dialog.tsx`
- Create: `drizzle/0004_*.sql`
- Test: `tests/domain/catalog.test.ts`, `tests/api/catalog.test.ts`

**Interfaces:**
- Consumes: T2's string date types.
- Produces: `updateMilestone(db, actor, id, patch, expectedVersion: number)`; `MILESTONE_CONFLICT_ERROR` exported from `src/domain/catalog.ts`; wire: `PATCH /api/v1/milestones/:id` body requires `expectedVersion`; `ApiMilestone.version: number`.

- [ ] **Step 1: Failing domain test** (this is the last-write-wins regression pin — mutation-verify it):

```ts
it('rejects a stale expectedVersion with a conflict', async () => {
  const m = await createMilestone(db, admin, { name: 'cas' })
  if (!m.ok) throw new Error('setup')
  const first = await updateMilestone(db, admin, m.milestone.id, { startsOn: '2026-07-01' }, m.milestone.version)
  expect(first.ok).toBe(true)
  const stale = await updateMilestone(db, admin, m.milestone.id, { endsOn: '2026-06-01' }, m.milestone.version) // version 1 again
  expect(stale.ok).toBe(false)
  if (!stale.ok) expect(stale.kind).toBe('conflict')
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/domain/catalog.test.ts` → FAIL (updateMilestone takes 4 args).

- [ ] **Step 3: Schema + migration.** Add to `milestones`: `version: integer('version').notNull().default(1),`. Run `npx drizzle-kit generate` → single `ADD COLUMN "version" integer DEFAULT 1 NOT NULL`.

- [ ] **Step 4: Domain CAS.** In `src/domain/catalog.ts` add `import { conflict } from './result'` (extend existing import), export:

```ts
export const MILESTONE_CONFLICT_ERROR = '다른 사용자가 먼저 이 마일스톤을 변경했습니다. 새로 고침 후 다시 시도해주세요'
```

Rewrite `updateMilestone` with the `expectedVersion: number` 5th parameter: after the notFound check, `if (existing.version !== expectedVersion) return conflict(MILESTONE_CONFLICT_ERROR)` (BEFORE the empty-patch shortcut, so a stale no-op still learns it is stale); keep merged-range + name pre-check as is; the update becomes:

```ts
const [milestone] = await db.update(milestones)
  .set({ ...patch, version: existing.version + 1, updatedByUserId: actor.id, updatedAt: new Date() })
  .where(and(eq(milestones.id, id), eq(milestones.version, expectedVersion)))
  .returning()
if (!milestone) return conflict(MILESTONE_CONFLICT_ERROR)
```

- [ ] **Step 5: Contract.** `patchMilestoneSchema` gains `expectedVersion: pgId` (required — this is the breaking contract decision). Route: `const { expectedVersion, ...patch } = parsed.data` → `updateMilestone(db, actor as UserActor, id, patch, expectedVersion)`. `ApiMilestone` gains `version: number`. Dialog (`milestone-dialog.tsx` submit): `patch` object gains `expectedVersion: editing.version` unconditionally on the PATCH branch; a 409 renders through the existing `error` line (server copy tells the user to refresh).

- [ ] **Step 6: API test** in `tests/api/catalog.test.ts`: PATCH without `expectedVersion` → 400; with stale → 409 + `MILESTONE_CONFLICT_ERROR`; with current → 200 and `version` incremented.

- [ ] **Step 7: Suite + tsc** — `npm test && npx tsc --noEmit` → green (existing milestone-PATCH tests updated to send `expectedVersion` as part of this step).

- [ ] **Step 8: Commit** — `git add -A && git commit -m "feat: milestone optimistic locking — version column, CAS update, required expectedVersion"`

---

### Task 4: `expectedVersion` on issue PATCH / transition / reorder

One contract decision with T3 — issues side. Reorder starts bumping `version` (any mutation bumps; the board already refreshes its held version from the response).

**Files:**
- Modify: `src/lib/validation.ts` (patchIssueSchema, transitionSchema, reorderSchema), `src/domain/issues.ts` (updateIssue, transitionIssue), `src/domain/ordering.ts` (reorderIssue, reorderWithinTx), routes `src/app/api/v1/issues/[id]/route.ts`, `.../transition/route.ts`, `.../reorder/route.ts`, UI: `src/app/(app)/issues/[id]/page.tsx:114,136,320,375`, `src/app/(app)/inbox/page.tsx:286-338`, `src/app/(app)/board/page.tsx:83-87`
- Test: `tests/domain/issues.test.ts`, `tests/domain/ordering.test.ts`, `tests/api/issues.test.ts`, `tests/ui/inbox-grooming.test.tsx`, `tests/ui/board-reorder.test.tsx`

**Interfaces:**
- Consumes: T3's pattern (`conflict` early-return + CAS WHERE).
- Produces: `updateIssue(db, actor, id, patch, expectedVersion)`, `transitionIssue(db, actor, id, input, expectedVersion)`, `reorderIssue(db, actor, id, target, expectedVersion)`; wire: the three routes require body `expectedVersion`. The Hermes brief (T15) quotes these.

- [ ] **Step 1: Failing tests.** Domain (`tests/domain/issues.test.ts`):

```ts
it('updateIssue rejects a stale expectedVersion', async () => {
  const issue = await createIssue(db, actorFor(admin), { title: 't', type: 'bug', productId: product.id, requesterId: admin.id })
  await updateIssue(db, actorFor(admin), issue.id, { title: 'first' }, issue.version)
  const stale = await updateIssue(db, actorFor(admin), issue.id, { title: 'second' }, issue.version)
  expect(!stale.ok && stale.kind).toBe('conflict')
})
```

Mirror for `transitionIssue` (stale version → conflict) and `reorderIssue` in `ordering.test.ts` (reorder with stale version → conflict; successful reorder increments `version`). Match each file's existing fixture helpers.

- [ ] **Step 2: Verify failure** — `npx vitest run tests/domain/issues.test.ts tests/domain/ordering.test.ts` → FAIL (arity).

- [ ] **Step 3: Domain.** `updateIssue`/`transitionIssue`: add `expectedVersion: number` parameter; after the notFound check insert `if (current.version !== expectedVersion) return conflict(CONFLICT_ERROR)` (before `updateIssue`'s no-change shortcut); the UPDATE `where` swaps `eq(issues.version, current.version)` → `eq(issues.version, expectedVersion)` (same value by then — the read guard is for the friendly early error, the WHERE stays the atomic guard). `reorderIssue`: thread `expectedVersion` through `reorderWithinTx`; add the same early conflict check after the status check; the UPDATE becomes:

```ts
const [updated] = await tx.update(issues)
  .set({ sortOrder: next, version: current.version + 1, updatedAt: new Date() })
  .where(and(eq(issues.id, id), eq(issues.version, expectedVersion)))
  .returning()
if (!updated) return conflict(CONFLICT_ERROR)
```

(import `conflict`, `CONFLICT_ERROR` from `./result`/`./issues`). `renumberBacklog` stays version-neutral — it rescales `sortOrder` without changing what any client is editing; document with one comment line. The renumber-retry recursion re-reads `current`, whose version is unchanged by the renumber, so the same `expectedVersion` stays valid.

- [ ] **Step 4: Validation + routes.** Add `expectedVersion: pgId` to `patchIssueSchema`, `transitionSchema`, `reorderSchema` (the reorder `.refine` is unaffected). Each route destructures: `const { expectedVersion, ...patch } = parsed.data` (PATCH) / passes `parsed.data.expectedVersion` (transition, reorder — note transition passes `{ to, priority, reason }` onward, not the whole parsed object). The non-admin field-allowlist in issues PATCH (`requestedFields.every(...)`) must ignore `expectedVersion`: add `f === 'expectedVersion'` to the allowed predicate.

- [ ] **Step 5: UI call sites.** Send the version each view already holds:
  - `issues/[id]/page.tsx`: the three PATCH bodies (114 MetaPanel-save, 320 title, 375 description) gain `expectedVersion: issue.version`; the transition body (136) gains `expectedVersion: issue.version`. All four already `refetch()` on success and render 409s via their `conflict` flags — no new UI state.
  - `board/page.tsx` `commitReorder`: `body: JSON.stringify({ ...target, expectedVersion: order.find((i) => i.id === draggedId)!.version })` — the optimistic update already writes back `updated.version`.
  - `inbox/page.tsx` `GroomingPanel`: transition body gains `expectedVersion: issue.version`; **the follow-up assignment PATCH must use the post-transition version**, not the list's stale one. Capture it:

```ts
const committedVersionRef = useRef<number | null>(null)
// in transition(): const updated = await api<ApiIssue>(`/api/v1/issues/${issue.id}/transition`, ...)
//                  committedVersionRef.current = updated.version
// in patchAssignment(): patch body gains expectedVersion: committedVersionRef.current ?? issue.version
```

  (`committedVersionRef.current ?? issue.version` — the plain grooming PATCH path never transitions first, so it uses the row's version.)
- [ ] **Step 6: Update existing tests.** Every existing call to the three domain functions / three endpoints gains the version argument/field (grep: `updateIssue(`, `transitionIssue(`, `reorderIssue(`, `'/transition'`, `'/reorder'` under `tests/`). Route tests add: missing `expectedVersion` → 400.

- [ ] **Step 7: Suite + gate** — `npm test && npm run coverage:gate && npx tsc --noEmit` → green.

- [ ] **Step 8: Commit** — `git add -A && git commit -m "feat: required expectedVersion on issue PATCH/transition/reorder — client round-trip optimistic locking"`

---

### Task 5: zod `issues` envelope + Korean locale + 23505 translation

**Files:**
- Modify: `src/app/api/v1/respond.ts` (failParse, unique-violation helper), `src/lib/validation.ts` (locale config), all 11 parse sites (`auth/login`, `issues` POST, `issues/[id]` PATCH, `transition`, `reorder`, `comments`, `relations`, `milestones` POST/PATCH, `products` POST/PATCH), `src/domain/catalog.ts` (rename paths catch 23505), `src/ui/api.ts` (ApiError.issues)
- Test: `tests/api/issues.test.ts`, `tests/api/catalog.test.ts`, `tests/domain/result.test.ts` (or new `tests/domain/respond.test.ts`), `tests/ui/api.test.ts`

**Interfaces:**
- Consumes: routes as left by T3/T4.
- Produces: envelope `{ ok: false, error: string, issues?: Array<{ path: string; message: string }> }`; `failParse(error: z.ZodError): NextResponse` in respond.ts; `isUniqueViolation(e: unknown): boolean` in respond.ts; `ApiError.issues?: Array<{ path: string; message: string }>`.

- [ ] **Step 1: Verify zod 4 locale API against current docs** (Context7 / official zod docs — do not code from memory): confirm `z.config(z.locales.ko())` is the v4 call shape for `zod@^4.4.3` and where it must run (module top-level once). Record the doc URL in the ledger.

- [ ] **Step 2: Failing test** (route-level, `tests/api/issues.test.ts`):

```ts
it('exposes field paths on a parse failure', async () => {
  const res = await POST(new Request('http://t/api/v1/issues', {
    method: 'POST', headers: authHeaders, body: JSON.stringify({ type: 'bug', productId: product.id }), // title missing
  }))
  expect(res.status).toBe(400)
  const body = await res.json()
  expect(body.issues.some((i: { path: string }) => i.path === 'title')).toBe(true)
})
```

Run → FAIL (`issues` undefined).

- [ ] **Step 3: Implement.** `src/lib/validation.ts` top: `z.config(z.locales.ko())` (per Step 1 findings). `respond.ts`:

```ts
import type { ZodError } from 'zod'
export function failParse(error: ZodError): NextResponse {
  const issues = error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
  return NextResponse.json({ ok: false, error: '입력값이 올바르지 않습니다', issues }, { status: 400 })
}
// postgres-js surfaces SQLSTATE on .code; PGlite can't reproduce this — real-PG gate below.
export function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505'
}
```

All 11 parse sites: `if (!parsed.success) return failParse(parsed.error)` (reorder's custom 400 string is replaced too — the refine message arrives as an issue entry). In `src/domain/catalog.ts`, wrap ONLY the two rename-carrying `db.update(...)` calls (updateProduct, updateMilestone) in try/catch: `catch (e) { if (isUniqueViolation(e)) return ruleViolation('이미 존재하는 제품입니다' /* or 마일스톤 */); throw e }` — closes the pre-check race window with a 422 instead of a raw 500. `src/ui/api.ts`: `ApiError` gains `public issues?: Array<{ path: string; message: string }>`, populated in the failure branch from `body`.

- [ ] **Step 4: Suite** — `npm test` green; assert one Korean locale message in a test (e.g. parse `{}` against `commentSchema` and snapshot that `issues[0].message` is Korean, guarding the locale wiring).

- [ ] **Step 5: Real-Postgres 23505 shape check** (driver error shapes rule):

```bash
docker run -d --name pg15-uv -e POSTGRES_PASSWORD=t -p 5440:5432 postgres:15
DATABASE_URL=postgres://postgres:t@localhost:5440/postgres npx tsx -e "
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL);
await sql\`CREATE TABLE uv (n text unique)\`; await sql\`INSERT INTO uv VALUES ('a')\`;
try { await sql\`INSERT INTO uv VALUES ('a')\` } catch (e) { console.log('code =', e.code) }
await sql.end()"
docker rm -f pg15-uv
```

Expected: `code = 23505`. Record in ledger.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: structured zod issues in the error envelope, ko locale, 23505 translation"`

---

### Task 6: Slack notifications (migration 0005: users.slack_user_id)

**Files:**
- Modify: `src/db/schema.ts` (users), `scripts/seed.ts`, `src/app/api/v1/users/route.ts`, `src/ui/types.ts` (ApiUser), `src/app/api/v1/issues/route.ts` (POST hook), `src/app/api/v1/issues/[id]/transition/route.ts` (hook), `.env.example`
- Create: `src/lib/slack.ts`, `drizzle/0005_*.sql`
- Test: `tests/domain/slack.test.ts` (new), `tests/api/issues.test.ts`, `tests/api/users.test.ts`

**Interfaces:**
- Consumes: transition route as left by T4/T5.
- Produces: `users.slackUserId: string | null`; seed CSV line `portalId,name,role,password[,slackUserId]`; `GET /api/v1/users` rows include `slackUserId`; `notifyNewIssue(issue: Issue): void` and `notifyStatusChange(db: Db, issue: Issue, from: IssueStatus): void` in `src/lib/slack.ts` — both fire-and-forget (`void` return, never throw). Env: `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID` (default `<slack-channel-id>`), `APP_BASE_URL`, test seam `SLACK_API_BASE`.

- [ ] **Step 1: Failing unit test** (`tests/domain/slack.test.ts`) with a stubbed `fetch` (`vi.stubGlobal('fetch', ...)`): `notifyNewIssue` posts to `chat.postMessage` with `SLACK_CHANNEL_ID` and a text containing `#<id>` + title + `${APP_BASE_URL}/issues/<id>`; a rejected fetch resolves without throwing (await a tick, assert no unhandled rejection); missing `SLACK_BOT_TOKEN` → no fetch call at all.

- [ ] **Step 2: Verify failure** — module doesn't exist.

- [ ] **Step 3: Implement `src/lib/slack.ts`:**

```ts
import { eq } from 'drizzle-orm'
import { users, type Issue, type IssueStatus } from '@/db/schema'
import type { Db } from '@/db/client'

const STATUS_LABEL: Record<IssueStatus, string> = {
  inbox: '입항 대기', backlog: '선적 대기', in_progress: '항해 중',
  done: '배송 완료', rejected: '반송', on_hold: '정박',
}

async function post(channel: string, text: string): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN
  if (!token) return // notifications are optional wiring, never a failure path
  try {
    const base = process.env.SLACK_API_BASE ?? 'https://slack.com/api'
    const res = await fetch(`${base}/chat.postMessage`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ channel, text }),
    })
    const body = await res.json().catch(() => null)
    if (!body?.ok) console.error('slack notify failed:', body?.error ?? res.status)
  } catch (error) {
    console.error('slack notify failed:', error)
  }
}

function issueUrl(id: number): string {
  return `${process.env.APP_BASE_URL ?? ''}/issues/${id}`
}

// Fire-and-forget: called AFTER the mutation committed; a Slack outage must
// never fail the API response (annotate-don't-block). No outbox by design.
export function notifyNewIssue(issue: Issue): void {
  const channel = process.env.SLACK_CHANNEL_ID ?? '<slack-channel-id>'
  void post(channel, `⚓ 새 이슈 #${issue.id} ${issue.title}\n${issueUrl(issue.id)}`)
}

export function notifyStatusChange(db: Db, issue: Issue, from: IssueStatus): void {
  void (async () => {
    const [requester] = await db.select({ slackUserId: users.slackUserId })
      .from(users).where(eq(users.id, issue.requesterId))
    if (!requester?.slackUserId) return // unmapped → silently no DM
    await post(requester.slackUserId,
      `#${issue.id} ${issue.title}: ${STATUS_LABEL[from]} → ${STATUS_LABEL[issue.status]}\n${issueUrl(issue.id)}`)
  })().catch((error) => console.error('slack notify failed:', error))
}
```

- [ ] **Step 4: Schema/seed/route.** users: `slackUserId: text('slack_user_id'),` → `npx drizzle-kit generate` (0005). `scripts/seed.ts` `parseLine`: accept 4 OR 5 fields; 5th (optional, may be empty) becomes `slackUserId ?? null`; upsert `set` includes it. `users/route.ts` select adds `slackUserId: users.slackUserId`. `ApiUser` gains `slackUserId: string | null`. Hook-in: issues POST route after `createIssue` → `notifyNewIssue(issue)`; transition route: capture `const from = ...` — the route doesn't know the old status, so `transitionIssue`'s success return already carries `issue` (new) — pass the old one by reading `result`: change the route to call `notifyStatusChange(db, result.issue, /* from */ ...)`. The `from` status: extend `transitionIssue`'s success shape to `{ ok: true; issue: Issue; from: IssueStatus }` (one-line addition in domain, type-checked at both call sites). `.env.example` gains commented `SLACK_BOT_TOKEN=`, `SLACK_CHANNEL_ID=`, `APP_BASE_URL=` lines.

- [ ] **Step 5: Route test:** stub fetch; POST /issues → one chat.postMessage to the channel; transition → DM only when the requester has `slackUserId`; a fetch that rejects still returns 200/201 from the route.

- [ ] **Step 6: Suite + gate + commit**

```bash
npm test && npm run coverage:gate && npx tsc --noEmit
git add -A && git commit -m "feat: Slack notifications — channel on create, requester DM on status change"
```

---

### Task 7: Attachments backend (migration 0006)

**Files:**
- Modify: `src/db/schema.ts` (attachments table), `src/domain/issues.ts` (getIssueDetail includes attachments), `package.json` (`@google-cloud/storage`), `.env.example` (`GCS_BUCKET=`)
- Create: `src/lib/object-store.ts`, `src/domain/attachments.ts`, `src/app/api/v1/issues/[id]/attachments/route.ts`, `src/app/api/v1/attachments/[id]/route.ts`
- Test: `tests/domain/attachments.test.ts`, `tests/api/attachments.test.ts` (new), extend `tests/helpers/db.ts` with a fake store

**Interfaces:**
- Consumes: actor XOR pattern (schema), `recordEvent`, `idFromParams`/`fail`/`ok`.
- Produces: `attachments` table; `ObjectStore { save(object, data, contentType): Promise<void>; read(object): Promise<Buffer> }` + `getObjectStore()` in `src/lib/object-store.ts` (test override via `globalThis.__rudderTestStore`, same pattern as `__rudderTestDb`); `createAttachment(db, actor, issueId, meta: { filename, contentType, sizeBytes, gcsObject }): Promise<{ok:true; attachment} | DomainError>`; `ApiIssueDetail.attachments` (T8 consumes); wire: `POST /api/v1/issues/:id/attachments` (multipart field `file`, ≤10MB, types png/jpeg/gif/webp/pdf/txt → 201 attachment row; 413 oversize; 422 bad type), `GET /api/v1/attachments/:id` (authenticated stream, `content-disposition: attachment`).

- [ ] **Step 1: Failing domain test:** `createAttachment` inserts the row (actor-attributed, XOR check holds for user and agent actors) and records an `attachment` event (`field='attachment'`, `newValue=filename`); attachment rows come back from `getIssueDetail` ordered by `createdAt`.

- [ ] **Step 2: Verify failure**, then **Step 3: Schema:**

```ts
export const attachments = pgTable('attachments', {
  id: serial('id').primaryKey(),
  issueId: integer('issue_id').notNull().references(() => issues.id),
  filename: text('filename').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  gcsObject: text('gcs_object').notNull().unique(),
  actorType: actorTypeEnum('actor_type').notNull(),
  actorUserId: integer('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
  actorTokenId: integer('actor_token_id').references(() => apiTokens.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  check('attachments_actor_xor',
    sql`(${t.actorType} = 'user' AND ${t.actorUserId} IS NOT NULL AND ${t.actorTokenId} IS NULL)
     OR (${t.actorType} = 'agent' AND ${t.actorTokenId} IS NOT NULL AND ${t.actorUserId} IS NULL)`),
])
```

`npx drizzle-kit generate` (0006). No delete endpoint — matches the repo-wide "nothing deletes" premise (spec §3).

- [ ] **Step 4: `src/lib/object-store.ts`:**

```ts
import { Storage } from '@google-cloud/storage'

export type ObjectStore = {
  save(object: string, data: Buffer, contentType: string): Promise<void>
  read(object: string): Promise<Buffer>
}

let cached: ObjectStore | null = null

// Tests inject a fake here (tests/helpers/db.ts pattern, same as __rudderTestDb).
export function getObjectStore(): ObjectStore {
  const testStore = (globalThis as { __rudderTestStore?: ObjectStore }).__rudderTestStore
  if (testStore) return testStore
  if (!cached) {
    const bucketName = process.env.GCS_BUCKET
    if (!bucketName) throw new Error('GCS_BUCKET not configured')
    // "fs:<dir>" stores objects on the local filesystem — E2E and GCP-less
    // local dev use this; production uses a real bucket name.
    if (bucketName.startsWith('fs:')) {
      const dir = bucketName.slice(3)
      cached = {
        async save(object, data) {
          const file = path.join(dir, object)
          await fs.mkdir(path.dirname(file), { recursive: true })
          await fs.writeFile(file, data)
        },
        async read(object) { return fs.readFile(path.join(dir, object)) },
      }
    } else {
      const bucket = new Storage().bucket(bucketName)
      cached = {
        async save(object, data, contentType) { await bucket.file(object).save(data, { contentType }) },
        async read(object) { const [buf] = await bucket.file(object).download(); return buf },
      }
    }
  }
  return cached
}
```

(`import fs from 'node:fs/promises'`, `import path from 'node:path'`; the fs branch keeps the GCS branch's contract — contentType lives in the DB row, not the store.)

(Verify `@google-cloud/storage` current API against Context7 docs before implementing — `save`/`download` shapes.) `src/domain/attachments.ts`: transaction { insert + `recordEvent(tx, actor, issueId, 'attachment', null, filename)` }, notFound when the issue doesn't exist.

- [ ] **Step 5: Routes.** POST (`issues/[id]/attachments/route.ts`): actor required, and **agents are blocked** (`if (actor.type === 'agent') return forbidden()`) — parity with the comments route, which defers agent-authored issue content to the AI-assistance phase (PRD §10). *(Corrected 2026-08-03: this line originally said agents MAY upload, which misread the comments route; both T7 reviewers caught the resulting over-permission.)* GET stays open to agents, consistent with the PRD's agent read capability; `const form = await req.formData().catch(() => null)`; `const file = form?.get('file')`; reject non-File → 400 `failParse` equivalent (`fail('file 필드가 필요합니다', 400)`); `file.size > 10 * 1024 * 1024` → `fail('파일이 너무 큽니다 (최대 10MB)', 413)`; allowlist `['image/png','image/jpeg','image/gif','image/webp','application/pdf','text/plain']` → 422 otherwise; object key `issues/${issueId}/${crypto.randomUUID()}`; `getObjectStore().save(...)` then `createAttachment(...)`; store failure propagates to withErrorEnvelope's 500 (no orphan row — save first, insert second; an orphan GCS object on insert failure is harmless and invisible). GET (`attachments/[id]/route.ts`): actor required; row lookup → 404; `store.read` → `new Response(buf, { headers: { 'content-type': row.contentType, 'content-disposition': \`attachment; filename*=UTF-8''\${encodeURIComponent(row.filename)}\` } })`.

- [ ] **Step 6: API tests** with a Map-backed fake store in `tests/helpers/db.ts` (`export function installFakeStore()` setting `globalThis.__rudderTestStore`): 401 unauth; 201 + event row; 413 oversize (construct an 11MB `File`); 422 type; GET round-trips bytes + headers; detail includes the attachment.

- [ ] **Step 7: Suite + gate + commit** — `npm test && npm run coverage:gate && npx tsc --noEmit`; `git commit -m "feat: attachments — GCS-backed upload/download, actor-attributed"`

---

### Task 8: Attachments UI + issue detail split

**Files:**
- Create: `src/ui/meta-panel.tsx`, `src/ui/relations-panel.tsx`, `src/ui/attachments-panel.tsx`
- Modify: `src/app/(app)/issues/[id]/page.tsx` (extract 419-660 region; render AttachmentsPanel), `src/ui/types.ts` (ApiAttachment, ApiIssueDetail.attachments), `src/ui/api.ts` (FormData passthrough), `src/app/globals.css` + `design/rudder.css` (attachment list styles — BOTH files, identical)
- Test: `tests/ui/attachments-panel.test.tsx` (new), `tests/ui/api.test.ts`

**Interfaces:**
- Consumes: T7's wire contract; `useApi` refetch pattern; design system (`docs/superpowers/design/2026-07-30-rudder-design-system.md` is the binding spec for the new panel).
- Produces: `ApiAttachment = { id, issueId, filename, contentType, sizeBytes, actorType, actorUserId, actorTokenId, createdAt }`; `<AttachmentsPanel issueId={number} attachments={ApiAttachment[]} onChanged={() => void} />`; `api()` accepts FormData bodies (skips the json content-type).

- [ ] **Step 1: `api()` FormData seam + failing test** (`tests/ui/api.test.ts`): posting a FormData body must NOT set `content-type: application/json` (the browser sets the multipart boundary). Implementation in `api()`:

```ts
headers: {
  ...(init?.body instanceof FormData ? {} : { 'content-type': 'application/json' }),
  ...init?.headers,
},
```

- [ ] **Step 2: Extraction (no behavior change).** Move `MetaPanel` (page.tsx:419+), `RelationsPanel` (605+), `RelationAddButton` (643+) into `src/ui/meta-panel.tsx` / `src/ui/relations-panel.tsx` (RelationAddButton stays with RelationsPanel). Props exactly as today; page.tsx imports them. Run the full suite — green with zero test edits proves the move was pure.

- [ ] **Step 3: AttachmentsPanel (failing component test first):** renders the list (filename as `<a href={\`/api/v1/attachments/\${a.id}\`}>`, size in KB/MB, `shortDate(a.createdAt)`); `<input type="file">` + 업로드 button posts `FormData` via `api(\`/api/v1/issues/\${issueId}/attachments\`, { method: 'POST', body: form })`, disables while pending, calls `onChanged()` on success, shows `ApiError.message` on failure (413/422 copy comes from the server). Empty state: `첨부된 화물이 없습니다`. Styles follow the design system's panel/list tokens; add to BOTH css files identically.

- [ ] **Step 4: Wire into page.tsx** below the comment thread; `onChanged={refetch}`. Types: `ApiIssueDetail` gains `attachments: ApiAttachment[]`.

- [ ] **Step 5: Suite + gate + line counts** — `npm test && npm run coverage:gate && npx tsc --noEmit`; `wc -l 'src/app/(app)/issues/[id]/page.tsx'` recorded in ledger (expect well under 800, target ≤450).

- [ ] **Step 6: Commit** — `git commit -m "feat: attachment upload/list UI; split MetaPanel/RelationsPanel out of issue detail"`

---

### Task 9: Grooming panel stale-completion hardening

The overview carries "`onDone` is not scoped to its issue id". Commit 5fd56f5 (T6 round 4) already scoped the cross-row case at `inbox/page.tsx:190`. What remains reachable: a **stale completion targeting the same row after close-and-reopen** — the unmounted panel instance's late `retryAssignment`/`transition` continuation calls `onDone()` and closes the freshly reopened panel (and fires setState on an unmounted component). Characterize both; fix what fails; the already-fixed case becomes a regression pin.

**Files:**
- Modify: `src/app/(app)/inbox/page.tsx` (GroomingPanel)
- Test: `tests/ui/inbox-grooming.test.tsx`

**Interfaces:** none new — internal state machine only.

- [ ] **Step 1: Characterization test (a) — cross-row (expected to PASS already):** open row A, submit a transition whose fetch is a hanging promise, close A, open B, resolve A's promise → B's panel stays open. If it passes, record in the ledger: "overview obligation §3 cross-row case was closed by 5fd56f5; test pinned."

- [ ] **Step 2: Characterization test (b) — same-row reopen (expected to FAIL):** open row A, 통관 with an assignee so the transition commits and the assignment PATCH hangs, close A (닫기), reopen A (committed mode), resolve the old PATCH → the reopened panel must STAY OPEN. Run: verify it fails on current code (mutation-verification of the test itself).

- [ ] **Step 3: Fix — an unmounted panel may not act:**

```ts
// In GroomingPanel:
const alive = useRef(true)
useEffect(() => () => { alive.current = false }, [])
// retryAssignment success path:      if (alive.current) onDone()
// retryAssignment failure setStates: guard with if (alive.current) { setError(...); setConflict(...) }
// transition(): same guards around onCommitted/onDone/setError/setPending
```

`onCommitted` stays UNGUARDED where the transition actually committed — the page-level `committedIds` set must learn the truth even if the panel closed (that is 5fd56f5's refetch contract; check the comment at page.tsx:170-183 still holds).

- [ ] **Step 4: Re-run both tests + full grooming suite** — `npx vitest run tests/ui/inbox-grooming.test.tsx` → all green.

- [ ] **Step 5: Suite + commit** — `npm test`; `git commit -m "fix: stale grooming-panel completions can no longer close or mutate a reopened panel"`

---

### Task 10: SESSION_SECRET boot validation + JSON body cap

**Files:**
- Create: `src/instrumentation.ts`
- Modify: `src/lib/session.ts` (export the placeholder const), `src/app/api/v1/respond.ts` (readJson), all 11 JSON parse sites (readJson swap), `README.md` (boot-validation paragraph)
- Test: `tests/domain/instrumentation.test.ts` (new), `tests/api/issues.test.ts` (413 case)

**Interfaces:**
- Produces: `register()` in `src/instrumentation.ts` (Next runs it at server boot; throws on missing/placeholder/short secret); `readJson(req: Request): Promise<unknown | typeof BODY_TOO_LARGE | null>` + `export const BODY_TOO_LARGE: unique symbol` in respond.ts. Attachment route (multipart) is exempt — it has its own 10MB cap.

- [ ] **Step 1: Failing tests.** `instrumentation.test.ts`: `register()` throws when `SESSION_SECRET` is unset / equals the placeholder / is 31 chars; passes at 32+. (Set/restore `process.env` per test.) API test: PATCH with `content-length: 2000000` and an actually-large body → 413 `{ ok: false, error: '요청 본문이 너무 큽니다' }`.

- [ ] **Step 2: Implement.** `src/lib/session.ts`: `export const PLACEHOLDER_SECRET = ...` (existing const, now exported). `src/instrumentation.ts`:

```ts
import { PLACEHOLDER_SECRET } from '@/lib/session'

// Next.js runs register() once at server boot (dev and start). A deploy with
// a missing/forged-able secret must fail HERE, not 500 at first login.
export async function register() {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret === PLACEHOLDER_SECRET || secret.length < 32) {
    throw new Error('SESSION_SECRET missing or invalid (need ≥32 chars) — refusing to start')
  }
}
```

`respond.ts`:

```ts
const JSON_BODY_LIMIT = 1_048_576 // 1MB — an order of magnitude above the largest legal payload (10k-char description)
export const BODY_TOO_LARGE = Symbol('BODY_TOO_LARGE')
export async function readJson(req: Request): Promise<unknown | typeof BODY_TOO_LARGE | null> {
  if (Number(req.headers.get('content-length') ?? '0') > JSON_BODY_LIMIT) return BODY_TOO_LARGE
  const text = await req.text().catch(() => null)
  if (text === null) return null
  if (text.length > JSON_BODY_LIMIT) return BODY_TOO_LARGE // content-length can lie
  try { return JSON.parse(text) } catch { return null }
}
```

All 11 sites: `await req.json().catch(() => null)` → `await readJson(req)` with `if (raw === BODY_TOO_LARGE) return fail('요청 본문이 너무 큽니다', 413)` before the safeParse. README: replace the "부팅 시점 검증은 아직 없다" sentence — boot validation now exists; a misconfigured deploy fails to start.

- [ ] **Step 3: Suite + live check** — `npm test`; then the session-live test (`npx vitest run tests/api/session-live.test.ts`) still passes (its dev server has a valid secret; instrumentation must not break it).

- [ ] **Step 4: Commit** — `git commit -m "feat: SESSION_SECRET validated at boot; 1MB JSON body cap"`

---

### Task 11: IT Portal auth investigation (timebox: half a day)

**Files:**
- Create: `docs/superpowers/plans/2026-08-03-it-portal-auth-finding.md` (decision record — always produced)
- Modify (only on a clean integration path): `src/lib/auth.ts` `verifyCredentials` body, `.env.example`
- Test (same condition): `tests/domain/auth.test.ts`

**Interfaces:** `verifyCredentials(db, portalId, password): Promise<User | null>` — signature frozen; only the body may change.

- [ ] **Step 1: Investigate (timeboxed).** Leads in order: `gh repo list Tyche-Technology --limit 100 | grep -i portal`; the `<internal-artifact-bucket>` bucket (`gcloud storage ls gs://<internal-artifact-bucket> | head`); Outline wiki via Hermes/직접; the portal's deploy target (`gcloud run services list` / VM list already gathered). Determine: does it expose a credential-verify endpoint, a queryable user store, or neither?
- [ ] **Step 2A (clean path exists):** swap `verifyCredentials` internals to call it (portal errors → `null`, never a thrown 500 for bad credentials; network failure → throw so withErrorEnvelope 500s honestly); keep the bcrypt fallback REMOVED only if the portal covers all 10 users; env for the portal endpoint/secret in `.env.example`; live verification against the real portal with a real account before "done".
- [ ] **Step 2B (unclear/no path):** write the finding (what was checked, what exists, what integration would take) in the decision record; launch ships with local bcrypt (spec §6 fallback). Either way the record is committed.
- [ ] **Step 3: Commit** — `git commit -m "docs: IT Portal auth finding (+ verifyCredentials swap if taken)"`

---

### Task 12: Playwright E2E + CI

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/helpers.ts`, `tests/e2e/drag-indicator.spec.ts`, `tests/e2e/visual-carryovers.spec.ts`, `tests/e2e/core-journey.spec.ts`, `tests/e2e/global-setup.ts`, `.github/workflows/ci.yml`
- Modify: `package.json` (`@playwright/test` devDep, `test:e2e` script), `docker-compose.yml` (postgres:16-alpine → **postgres:15**, matching prod), `README.md` (E2E section)

**Interfaces:**
- Consumes: the whole app; T6's `SLACK_API_BASE` seam (mock Slack server in global-setup).
- Produces: `npm run test:e2e`; CI gate on PRs (tsc → vitest+coverage → build → e2e).

- [ ] **Step 1: Scaffold.** `npm i -D @playwright/test && npx playwright install chromium`. `playwright.config.ts`: `webServer` runs `next start -p 3200` after a build, `globalSetup` boots docker `postgres:15` on :5435, runs `scripts/migrate.mjs` (created in T13 — if executing T12 first, inline `npx drizzle-kit migrate`), seeds via `npm run seed` fixture CSV (one admin `e2e-admin`, one user `e2e-user` — the user WITH a fake slackUserId), starts a tiny mock Slack HTTP server on :3299 capturing posts; env: `DATABASE_URL=postgres://…:5435/rudder`, `SESSION_SECRET=<32+ chars>`, `SLACK_BOT_TOKEN=e2e`, `SLACK_API_BASE=http://127.0.0.1:3299`, `GCS_BUCKET=fs:<playwright tmp dir>` (T7's filesystem store scheme — uploads run against the real route with real bytes, no GCP).
- [ ] **Step 2: The three Phase 2 carry-overs (write first, watch them fail only where the bug exists):**
  - `drag-indicator.spec.ts`: seed 3 backlog issues; on `/board`, use Playwright's HTML5 drag support (`locator.dragTo` for the reorder smoke; for the leak, drive the drag manually: `hover` source → `mouse.down` → move over the column until `.drop` is visible → move OUTSIDE the column → `mouse.up` on the page body) → `await expect(page.locator('.drop')).toHaveCount(0)`. This is the CDP-unreachable case; **verify the test fails against current code** (the leak exists — board-column has no dragleave/out clearing) — that failure IS the mutation-verification; then fix: in `src/ui/board-column.tsx` add `onDragLeave` on the column that clears `dropIndex` when `e.relatedTarget` leaves the column element (`!e.currentTarget.contains(e.relatedTarget as Node)`), re-run → green.
  - `visual-carryovers.spec.ts`: (1) terminal-row border: on `/requests` expand a `done` row → assert the expanded `.row-expand`'s computed `border-bottom-width` is `1px`(or the design-system decision — read the design doc §row spec and pin what it prescribes); (2) Rail admin gating: as `e2e-user` the sidebar has no `제품` link, as `e2e-admin` it does (`page.getByRole('link', { name: '제품' })` count 0/1).
  - Both must run against the production build (`next start`), not dev.
- [ ] **Step 3: Core journey smoke (`core-journey.spec.ts`):** login as admin → create issue (모달) → inbox 통관 to backlog with priority → board drag-reorder above another card (assert order + no error banner) → milestone create in roadmap → assign issue → upload a small png in detail → download link responds 200 (request via `page.request`) → transition to in_progress → mock Slack captured ≥2 posts (channel post at create, none required for DM unless mapped — seed `e2e-user` WITH a fake slackUserId and create the issue as e2e-user so the transition DM fires; assert both captures).
- [ ] **Step 4: CI (`.github/workflows/ci.yml`):** on pull_request + push to master: job `test` (npm ci → `npx tsc --noEmit` → `npm test` → `npm run coverage:gate`), job `e2e` (needs test; services: postgres:15; `npm run build` → `npx playwright install --with-deps chromium` → `npm run test:e2e`, upload trace artifact on failure).
- [ ] **Step 5: Run everything locally** — `npm run test:e2e` green twice in a row (flake check). Commit: `git commit -m "test: Playwright E2E — drag-indicator leak fixed, visual carry-overs pinned, core journey; CI workflow"`

---

### Task 13: Dockerfile + deploy pipeline

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `scripts/migrate.mjs`, `deploy/docker-compose.prod.yml`, `.github/workflows/deploy.yml`
- Modify: `next.config.ts` (`output: 'standalone'`), `README.md` (deploy section)

**Interfaces:**
- Consumes: dashboard `deploy.yml` shape (digest pin, Tailscale action `tag:ci`, SSH, health check, `:rollback` tag).
- Produces: GHCR image `ghcr.io/tyche-technology/tyche-rudder`; VM compose stack `rudder` + `cloud-sql-proxy`; migrate-before-swap step.

- [ ] **Step 1: `next.config.ts`** → `const nextConfig: NextConfig = { output: 'standalone' }`. Build locally, confirm `.next/standalone/server.js` exists.
- [ ] **Step 2: `scripts/migrate.mjs`** (runtime deps only — drizzle-kit is a devDep and stays out of the image):

```js
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL, { max: 1 })
await migrate(drizzle(sql), { migrationsFolder: 'drizzle' })
await sql.end()
console.log('migrations applied')
```

- [ ] **Step 3: `Dockerfile`** (multi-stage, node:22-alpine): deps stage `npm ci`; build stage `npm run build`; runtime stage copies `.next/standalone`, `.next/static`, `public`, `drizzle/`, `scripts/migrate.mjs`, `node_modules/drizzle-orm node_modules/postgres` are already inside standalone's traced node_modules — verify with `docker run --rm image node scripts/migrate.mjs` against a throwaway PG (if tracing dropped them, copy the two packages explicitly). `EXPOSE 3000`, `CMD ["node", "server.js"]`, non-root user.
- [ ] **Step 4: `deploy/docker-compose.prod.yml`:**

```yaml
services:
  rudder:
    image: ghcr.io/tyche-technology/tyche-rudder:latest
    container_name: rudder
    restart: unless-stopped
    ports: ["127.0.0.1:3000:3000"]
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgres://rudder:${DB_PASSWORD}@cloud-sql-proxy:5432/rudder
      - SESSION_SECRET=${SESSION_SECRET}
      - SLACK_BOT_TOKEN=${SLACK_BOT_TOKEN}
      - SLACK_CHANNEL_ID=<slack-channel-id>
      - APP_BASE_URL=${APP_BASE_URL}
      - GCS_BUCKET=${GCS_BUCKET}
      - GOOGLE_APPLICATION_CREDENTIALS=/credentials/sa.json
    volumes: ["./credentials:/credentials:ro"]
    depends_on: [cloud-sql-proxy]
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://127.0.0.1:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
  cloud-sql-proxy:
    image: gcr.io/cloud-sql-connectors/cloud-sql-proxy:latest
    container_name: cloud-sql-proxy
    restart: unless-stopped
    command: ["--address", "0.0.0.0", "--port", "5432", "--credentials-file", "/credentials/sa.json", "<cloud-sql-instance-connection-name>"]
    volumes: ["./credentials:/credentials:ro"]
```

- [ ] **Step 5: `deploy.yml`** — clone the dashboard's (already read at `~/<internal-dashboard>/.github/workflows/deploy.yml`) with: paths filter (`src/**`, `drizzle/**`, `public/**`, `package*.json`, `next.config.ts`, `Dockerfile`, workflow itself); no catalog step; after image pull and BEFORE `docker compose up`: `docker compose -f docker-compose.prod.yml run --rm rudder node scripts/migrate.mjs` (migrations are additive; a failed migration aborts before the swap, old container keeps serving); keep digest pin, `:rollback` tag, health check + auto-rollback, GHCR login/logout, Tailscale action. Secrets consumed: `VM_HOST` (tailnet name `tyche-rudder`), `VM_USERNAME`, `VM_SSH_KEY_BASE64`, `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET` (org-level ones may already exist from the dashboard — reuse, don't mint).
- [ ] **Step 6: Local end-to-end docker check** — `docker build .` then run the image + local postgres:15 + `fs:` object store; `wget /api/health` 200; login works. Record in ledger.
- [ ] **Step 7: Commit** — `git commit -m "feat: production Dockerfile, prod compose with cloud-sql-proxy, deploy workflow"`

---

### Task 14: Launch (production runbook — every step confirmed with PO first)

**Files:** none in-repo (runbook execution; record every command + output in the ledger).

Present this entire list with scope + rollback to the PO, get one explicit 승인, then execute in order:

- [ ] **Step 1: VM** — `gcloud compute instances create tyche-rudder --project=<gcp-project-id> --zone=asia-northeast3-a --machine-type=e2-small --boot-disk-size=20GB --image-family=debian-12 --image-project=debian-cloud` (rollback: `gcloud compute instances delete tyche-rudder --zone=asia-northeast3-a`). Install docker + compose plugin; install tailscale, `tailscale up` (node name `tyche-rudder`); confirm it appears in `tailscale status`.
- [ ] **Step 2: DB** — `gcloud sql users create rudder --instance=<cloud-sql-instance> --password=<generated>` and `gcloud sql databases create rudder --instance=<cloud-sql-instance>` (rollback: drop database + user; affects 0 rows of other DBs — `tyche_db` untouched).
- [ ] **Step 3: Bucket + SA** — `gcloud storage buckets create gs://<gcs-bucket-name> --location=asia-northeast3 --uniform-bucket-level-access`; `gcloud iam service-accounts create <runtime-service-account>`; grant `roles/cloudsql.client` (project) + `roles/storage.objectAdmin` (bucket only); key → VM `~/rudder/credentials/sa.json` mode 600 (rollback: delete key/SA/bucket).
- [ ] **Step 4: Secrets/env on VM + GitHub** — `~/rudder/.env` (DB_PASSWORD, SESSION_SECRET via `openssl rand -base64 32`, SLACK_BOT_TOKEN from the existing bot, APP_BASE_URL=`https://tyche-rudder.<tailnet>.ts.net`, GCS_BUCKET=<gcs-bucket-name>); GitHub repo secrets VM_HOST/VM_USERNAME/VM_SSH_KEY_BASE64 (+TS oauth if not org-inherited).
- [ ] **Step 5: First deploy** — push to master (or `workflow_dispatch`) → watch the workflow; migrate step applies 0000–0006; health check passes.
- [ ] **Step 6: Serve + seed + token** — `tailscale serve --bg --https=443 http://127.0.0.1:3000`; browse `https://tyche-rudder.<tailnet>.ts.net` from a tailnet device; `npm run seed users.csv` (real 10-person CSV with slackUserIds, run via `docker compose run` or locally against the proxy); `npm run create-token hermes` → hand to T15 (store in Secret Manager, never in the bot repo).
- [ ] **Step 7: Production smoke** — login as PO account, create a real test issue, groom it, upload an attachment, confirm the Slack channel message arrived in `<slack-channel-id>`, transition it and confirm the DM. Delete nothing (no delete endpoints — the test issue stays as issue #1, honest history).
- [ ] **Step 8: Ledger** — record every command, output, and rollback line; update README deploy section if reality diverged from T13's docs.

---

### Task 15: Hermes intake (repo: `~/Documents/GitHub/<slack-bot-repo>`)

Separate repo, separate conventions (Python 3.11–3.13, uv, pytest, ruff, Hermes Agent 0.18.2, immutable releases under `/opt/tyche/releases`). The working copy is BEHIND origin/main (804f5f1 < 96477e1) — pull first.

**Files (bot repo; exact paths determined in Step 2 from AGENTS.md):**
- Modify: <google-workspace-domain> plugin tool registry + Slack app manifest (message shortcut callback)
- Create: rudder tool module + tests

**Interfaces (the Rudder contract this task consumes — quoted from code, not guessed):**
- Base URL `https://tyche-rudder.<tailnet>.ts.net/api/v1` (<internal-bot-vm> VM is on the tailnet — direct reach, no public exposure).
- Auth: `authorization: Bearer rud_<token>` (from T14 Step 6, in Secret Manager).
- `POST /issues` body `{ title: string≤200, description?: string≤10000, type: 'bug'|'feature'|'improvement', productId: number, requesterPortalId: string }` — **requesterPortalId is REQUIRED for agent actors**; response `{ ok: true, data: Issue }` 201-equivalent (200).
- `GET /products` → active products for the draft picker; `GET /users` → rows now include `slackUserId` for Slack→portalId mapping.
- Errors: `{ ok: false, error: string, issues?: [{ path, message }] }` — on 400, use `issues[].path` to repair the payload and retry once; on unmapped requester, reply with guidance (do NOT file with a wrong requester).
- Agents may not PATCH/transition (403 by contract) — intake is create-only.

- [ ] **Step 1: Sync** — `git -C ~/Documents/GitHub/<slack-bot-repo> pull --ff-only origin main`; run the repo's own checks green before touching anything (`uv sync --frozen --group dev && uv run pytest -q`).
- [ ] **Step 2: Read current architecture** — AGENTS.md, `docs/NUL_GUIDE.md`, the <google-workspace-domain> plugin layout; locate: tool registration, Slack event→Pub/Sub flow, staging config (`scripts/check_config.py --environment staging`), release process. Write the intake brief INTO the ledger quoting the contract block above verbatim.
- [ ] **Step 3: Tools (TDD per the repo's test conventions)** — `rudder_create_issue(title, description, type, product_id, requester_portal_id)` and `rudder_list_products()`; HTTP against `RUDDER_API_BASE` env with the token from Secret Manager; unit tests with a stubbed HTTP layer covering: success, 400-with-issues repair path, unmapped requester.
- [ ] **Step 4: Confirm gate (PRD §10 — suggestion ≠ action)** — both surfaces produce a DRAFT message (title/type/product guessed from the message or conversation, requester resolved via slack_user_id mapping) and file ONLY on explicit user confirmation (the repo's existing interaction primitive — button or affirmative reply, whichever NUL_GUIDE prescribes). Never silent-create.
- [ ] **Step 5: Message shortcut** — Slack app manifest gains the shortcut (callback e.g. `rudder_file_issue`); the CF event path forwards it over the existing Pub/Sub topic; Hermes handler builds the draft from the target message (text → title/description, permalink appended to description).
- [ ] **Step 6: NL mention/DM** — Hermes skill instruction addition: when a conversation contains a request/bug worth tracking, offer the draft (same confirm gate, same tool).
- [ ] **Step 7: Staging validation** — staging environment end-to-end: shortcut on a test message → draft → confirm → issue exists in Rudder (verify via `GET /issues?requester=me` with the bot token? No — agents list via products/issues endpoints; verify in the Rudder UI) → Slack channel notification observed. Then release to production per the repo's release process.
- [ ] **Step 8: Commit/PR in the bot repo** following ITS conventions; record release id in the ledger.

---

### Task 16: Field-level form errors from the `issues` envelope

**Added 2026-08-03 by PO decision.** T5 made every parse failure return `{ error, issues: [{path, message}] }`, which collapsed four routes' specific Korean messages into the generic one — a real UX regression for humans, since nothing client-side reads `issues`. The PO chose to consume the array rather than restore the old strings, so the field-level message becomes the product's answer for every form, not just those four.

**Files:**
- Modify: `src/ui/api.ts` (already carries `ApiError.issues` — no change expected; verify), `src/app/globals.css` + `design/rudder.css` (field-error style — BOTH files, identical), `src/app/(app)/products/page.tsx` (create + rename forms), `src/ui/milestone-dialog.tsx`, `src/ui/comment-thread.tsx`, `src/ui/new-issue.tsx`
- Create: `src/ui/field-errors.ts`
- Test: `tests/ui/field-errors.test.ts`, plus assertions in the existing component tests for the three forms

**Interfaces:**
- Consumes: `ApiError.issues?: Array<{ path: string; message: string }>` (T5).
- Produces: `fieldErrors(error: unknown): Record<string, string>` in `src/ui/field-errors.ts` — maps an `ApiError`'s issues to a path→message lookup, `{}` for any non-`ApiError` or an error without issues. Forms render `errors[fieldName]` under the matching input.

- [ ] **Step 1: Read the design system's form-error spec first.** `docs/superpowers/design/2026-07-30-rudder-design-system.md` is the binding spec. If it already prescribes an inline field-error treatment, follow it exactly. If it does not, add ONE token-consistent style (reuse the existing `.hint` error styling rather than inventing a new visual language) and note in your report that the design system had no rule for this.

- [ ] **Step 2: Write the failing test** (`tests/ui/field-errors.test.ts`):

```ts
it('maps an ApiError with issues to a path→message lookup', () => {
  const err = new ApiError(400, '입력값이 올바르지 않습니다')
  err.issues = [{ path: 'name', message: '제품 이름을 입력해주세요' }]
  expect(fieldErrors(err)).toEqual({ name: '제품 이름을 입력해주세요' })
})
it('returns an empty lookup for a non-ApiError or an error without issues', () => {
  expect(fieldErrors(new Error('boom'))).toEqual({})
  expect(fieldErrors(new ApiError(500, '서버 오류가 발생했습니다'))).toEqual({})
})
```

- [ ] **Step 3: Run it, watch it fail** (`fieldErrors` not exported), then implement the helper — it is a few lines; do not build a form framework.

- [ ] **Step 4: Wire the three forms + new-issue.** Each already renders `err.message` in a single error line; keep that as the form-level fallback and ADD the per-field line where a matching path exists. A path with no matching input must still surface somewhere — never swallow an issue silently.

- [ ] **Step 5: Component tests.** For each form: mock a 400 whose `issues` names the form's own field, assert the field-level message renders next to that input. Mutation-verify one of them (drop the `errors[...]` render, watch the test fail, restore).

- [ ] **Step 6: The reorder route has no form.** Its lost message (`'afterId 또는 beforeId가 필요합니다'`) cannot be shown as a field error — the board surfaces reorder failures as a banner. Decide and state in your report: either compose the banner text from `issues[0].message` when present, or accept the generic string there. Do not leave it undecided.

- [ ] **Step 7: Suite + gate + commit** — `npm test && npm run coverage:gate && npx tsc --noEmit`; `git commit -m "feat: render field-level form errors from the API's issues envelope"`

---

### Task 17: Make the coverage gate measure what it claims

**Added 2026-08-03 by PO decision.** `vitest.config.ts` asks for `src/ui/*.ts`, but v8 reports every file a test loads, so component `.tsx` files land in the artifact too. The `ui` slice therefore reads 76.97% (bits.tsx 16.66%, comment-thread.tsx 18.51%, board-column.tsx 43.39%) while the combined 80% threshold passes at 86.46% and hides it. The PO chose to make `.tsx` inclusion official and raise coverage rather than exclude it.

**Files:**
- Modify: `vitest.config.ts` (include `.tsx` explicitly; per-slice thresholds), `scripts/coverage-gate.sh` (glob-match guard for the new pattern), `README.md` (the Testing section currently documents the mismatch as a known quirk — it becomes wrong once fixed)
- Test: new/extended component tests for `src/ui/bits.tsx`, `src/ui/comment-thread.tsx`, `src/ui/board-column.tsx`

**Interfaces:** none (test-infrastructure only).

- [ ] **Step 1: Make the config state the truth.** Change `include` to `['src/domain/**', 'src/lib/**', 'src/ui/*.ts', 'src/ui/*.tsx']` so the measured set is the declared set. Then run `npm run coverage:gate` and record the honest starting numbers per file — that table is your work list.

- [ ] **Step 2: Convert the global threshold to per-slice thresholds** using vitest's per-glob threshold syntax (verify the exact syntax against current vitest docs — v4 is installed; do not write it from memory). Target ≥80% on each of `src/domain/**`, `src/lib/**`, `src/ui/**`. Expect the gate to FAIL at this point — that failure is the proof the per-slice gate now bites, and it belongs in your report.

- [ ] **Step 3: Raise the three low files with real behavioral tests.** `bits.tsx`, `comment-thread.tsx`, and `board-column.tsx` are the gap. Test what they DO — a comment posts and clears the box, a drag indicator appears at the right index, an empty state renders its copy — not that they render without throwing. Do not add assertions that restate the JSX.

- [ ] **Step 4: `scripts/coverage-gate.sh`** counts matches per glob and fails loudly when one matches nothing. Add the `.tsx` glob to that guard so a future rename can't silently empty the new slice.

- [ ] **Step 5: README.** The Testing section says the config "asks for `src/ui/*.ts` only, but component `.tsx` files that a test loads land in the artifact too" and tells the reader to fix the config rather than the docs. That is now done — rewrite the paragraph to describe the per-slice gate.

- [ ] **Step 6: Gate green + commit** — `npm run coverage:gate` must now pass on its own terms, with every slice ≥80%. `git commit -m "test: per-slice coverage thresholds; cover the three lowest UI components"`

---

## Self-review notes (run before execution)

- Spec §2.1/§2.2/§2.3 → T3+T4 / T5 / T2. §3 → T7+T8. §4 → T6. §5 → T15. §6 → T11. §7 → T1, T10, T9. §8 → T12. §9 → T13+T14. §1 accepted properties → encoded in Global Constraints. No spec section is uncovered.
- Type consistency: `expectedVersion` is `pgId` (positive int) everywhere; `dateLabel` defined T2 and consumed only after; `ApiMilestone.version` (T3) precedes dialog use (T3 Step 5); `scripts/migrate.mjs` created in T13 but referenced by T12 Step 1 — T12 notes the inline fallback if executed first.
- Migration numbering assumes execution order T2(0003) → T3(0004) → T6(0005) → T7(0006); if lanes reorder T6/T7, the generated numbers shift — harmless, drizzle numbers whatever `generate` sees next; do NOT hand-edit journal entries.
