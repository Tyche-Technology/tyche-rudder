# Final whole-branch review — Rudder Phase 1 Core

**Range:** 828450e..9dc27c1 (35 commits, 72 files, ~9,700 insertions)
**Reviewer:** rudder-final-review
**Independent evidence gathered at HEAD:** `npx tsc --noEmit` clean; `npm test` →
13 files / 191 tests passed; `npm test -- --coverage` → 95.83% stmts / 92.81%
branches on `src/domain` + `src/lib`. Two behavioural claims below were proven
with throwaway PGlite probes rather than asserted from reading.

---

### Strengths

These are specific things I went looking to criticise and could not.

- **The domain/HTTP seam is genuinely uniform where it counts.** Eleven
  implementers produced fourteen route handlers that all read
  `getDb()` → `actorFromRequest` → guard → `safeParse` → domain call →
  `result.ok ? ok(...) : fail(result.error, domainErrorStatus(result.error))`.
  `src/app/api/v1/issues/[id]/transition/route.ts:8-18` and
  `src/app/api/v1/milestones/[id]/route.ts:10-20` were written by different
  agents in different lanes and are the same shape line for line. That is not
  the norm for parallel multi-agent work and it is the single biggest reason
  this branch reads as one codebase.

- **Every non-obvious decision carries its reasoning at the point of the
  decision, and the reasoning is correct.** `src/domain/ordering.ts:108-116`
  explains why `renumberBacklog` deliberately records no per-row event
  (rescaling is not a semantic change any actor made) — that is exactly the
  right call and it pre-empts the obvious reviewer objection. Same quality at
  `src/domain/collab.ts:33-35` (unique index as duplicate authority),
  `src/app/api/v1/respond.ts:16-24` (why `Number()` is too permissive for an
  id), `src/lib/validation.ts:69-73` (why `z.iso.date()` beats
  `z.coerce.date()`), and `src/lib/session.ts:4-6` (why role is not in the
  cookie). None of these are decorative comments; each names a constraint the
  code cannot show.

- **Authentication design choices are right in ways that invite wrong review
  feedback.** `hashToken` uses plain SHA-256 (`src/lib/api-auth.ts:8-10`) —
  correct, because a 24-byte CSPRNG token has no entropy deficit for a slow KDF
  to compensate; using bcrypt there would be cargo cult. Role is re-read from
  the DB on every request (`src/lib/api-auth.ts:22-27`) so a demotion takes
  effect immediately instead of at cookie expiry. `TIMING_EQUALIZER_HASH`
  (`src/lib/auth.ts:8`) is a real bcrypt hash so unknown-user and
  wrong-password paths cost the same, and it is labelled not-a-secret.

- **The XOR actor constraint is enforced in the database, not in application
  code.** `drizzle/0000_nasty_clint_barton.sql:24-25,38-39` — a
  `user`-typed event physically cannot carry a token id. Combined with the four
  `ON DELETE restrict` actor FKs, the audit trail cannot be orphaned or
  half-attributed by any future code path, including code that forgets
  `actorColumns()`. This is the strongest single piece of engineering on the
  branch.

- **`updateIssue`'s changed-field diffing is honest.**
  `src/domain/issues.ts:78-90` filters to fields that are both present *and*
  different, returns early with no version bump when nothing changed, and emits
  one event per actually-changed field. A no-op PATCH does not pollute history
  or burn a version. Easy to get wrong; got right.

- **The coverage gate is guarded against measuring nothing.**
  `scripts/coverage-gate.sh:9-16` fails loudly if the include globs stop
  matching files, which is the failure mode that makes threshold gates useless.
  Someone thought about how their own gate could lie.

---

### Cross-Cutting Consistency

Six places where one concept has two implementations. Individually small;
collectively they are the tax of eleven parallel tasks, and every one of them is
cheaper to collapse now than after a UI is built on top.

1. **Two response idioms — the auth routes never adopted `respond.ts`.**
   `src/app/api/v1/auth/me/route.ts:10` hand-writes
   `NextResponse.json({ ok: false, error: '로그인이 필요합니다' }, { status: 401 })`,
   which is character-for-character what `unauthorized()`
   (`src/app/api/v1/respond.ts:9`) returns. Login and logout hand-roll their
   envelopes too. Cause is chronological, not architectural: Task 7 shipped the
   auth routes before Task 9 created `respond.ts`, and nobody went back.
   `src/app/api/health/route.ts:4` likewise hand-rolls `{ ok: true, data }` and
   is the only route not wrapped in `withErrorEnvelope`.

2. **Two ways to resolve "who is the logged-in human", one of which will
   drift.** `src/lib/api-auth.ts:21-27` reads the session then loads the user
   from the DB. `src/app/api/v1/auth/me/route.ts:9-12` does the same thing
   again, independently. Any future rule added to `actorFromRequest` — an
   `active` flag, a deactivation check, a last-login bump — silently will not
   apply to `/auth/me`, so the endpoint whose entire job is reporting identity
   becomes the one endpoint with stale identity rules. `/auth/me` should be
   `actorFromRequest` + a user fetch, or `actorFromRequest` should return the
   user row.

3. **The admin guard exists as a helper and as five copies.**
   `src/app/api/v1/issues/[id]/relations/route.ts:15-21` defines `requireAdmin`.
   No other file uses it; `transition/route.ts:12`, `reorder/route.ts:12`,
   `products/route.ts:20`, `milestones/route.ts:20`, and
   `milestones/[id]/route.ts:14` each inline
   `if (actor.type !== 'user' || actor.role !== 'admin') return forbidden()`.
   This is the "helper written because its owner could not edit another's file"
   pattern in reverse — the helper landed in the one file that needed it twice
   and never became shared. (The *differently-shaped* guards in
   `issues/[id]/route.ts:27` and `comments/route.ts:12` — `actor.type === 'agent'`
   — are correctly different, because those endpoints admit non-admin humans.)

4. **`serialize` is duplicated** — `src/domain/issues.ts:11` and
   `src/domain/ordering.ts:13`, with a comment on the second explaining why the
   author believed they had no choice. They did: `src/domain/events.ts` imports
   from neither and is already imported by both. This one matters slightly more
   than ordinary duplication because it is the null-handling rule for the audit
   log, so a future change to it would apply to only half of the history.

5. **Two id parsers with different strictness.** `parsePgId`
   (`src/app/api/v1/respond.ts:20-24`) accepts canonical decimal digits only;
   `pgIdCoerced` (`src/lib/validation.ts:8`) is `z.coerce.number()` and reads
   `"0x10"` as 16. Same concept, two rules, and the looser one is the one
   exposed to query strings.

6. **FK existence checking happens at two altitudes.** The route layer
   pre-checks with `productExists` / `userExists` / `milestoneExists`
   (`respond.ts:40-51`), while the domain layer does its own with `issueExists`
   (`collab.ts:11-14`) and `backlogAnchor` (`ordering.ts:25-34`). Each works;
   but "where do I validate that a referenced row exists" has no single answer
   on this branch, so the next implementer will guess.

**Naming drift inside the audit log — the one I would actually spend money
on.** `issue_events.field` currently receives three conventions:

| Convention | Values | Written by |
|---|---|---|
| camelCase | `title`, `description`, `type`, `productId`, `assigneeId`, `milestoneId`, `priority` | `issues.ts:89` (patch loop, uses the TS field name) |
| snake_case | `sort_order`, `relation_added`, `relation_removed` | `ordering.ts:104`, `collab.ts:42,62` |
| bare verb/noun | `created`, `status`, `priority`, `reason` | `issues.ts:21,112,114,117` |

`priority` is written by two paths and agrees, which is lucky rather than
designed. This is the machine-readable history that spec §10.3 makes a binding
guardrail, and it is the only artefact on this branch whose format becomes
*immutable on first deploy* — every convention decision is baked into stored
rows, and changing it later means a data migration, not a code change. Pick one
convention (I would use the column name in snake_case, so `sort_order`,
`assignee_id`, `milestone_id`, and event-not-field entries prefixed, e.g.
`relation.added`) before any row exists.

---

### End-to-End Coherence

I traced the flow the brief asked for: agent files via Slack → admin grooms →
lands on a roadmap.

1. **Slack bot files the issue.** `POST /api/v1/issues` with
   `Authorization: Bearer rud_…` → `actorFromRequest` matches case-insensitively
   (`api-auth.ts:14`), resolves an `agent` actor, bumps `lastUsedAt`
   defensively. `createIssueSchema` requires `productId`; the agent branch
   requires `requesterPortalId` and maps it to a real user
   (`issues/route.ts:33-37`). `createIssue` inserts and records `created` inside
   one transaction. **The attribution here is exactly right and it is the
   subtlest seam on the branch**: `requesterId` is the *human* who asked, while
   the event's actor is the *token*. "The bot filed this on Hansol's behalf" is
   reconstructible, which is precisely what a Slack intake needs and what a
   naive implementation gets wrong.

2. **Admin grooms it.** `POST /issues/{id}/transition {to:'backlog',
   priority:'p1'}` → admin-only, `validateTransition` requires a priority to
   enter backlog, `backlogEntrySortOrder` appends at max+1024, `version` bumps
   under a CAS predicate, and `status` + `priority` events are recorded (the
   `reason` event correctly suppresses itself when null→null). Coherent.

3. **Admin assigns a milestone.** `PATCH /issues/{id} {milestoneId}` →
   `milestoneExists` 422 pre-check, then a `milestoneId` event. Coherent, except
   that the event's field name is camelCase here and snake_case one module over
   (above).

4. **Roadmap.** `GET /roadmap` groups issues by milestone, sorts by priority
   with an id tie-break, returns `total`/`done`. Coherent in shape; the counts
   are wrong in a way I verify below.

**Verdict on the seams: coherent, not merely individually correct.** The three
intake paths really do converge on one domain function, the actor abstraction
really does carry a token and a human through the same code with no branching
in the domain layer, and I could not find a place where a route reaches around
its domain function to touch the DB directly. Two frictions are worth naming:

- **The bootstrap is a seam with nothing on the other side of it.** A fresh
  deploy has no products, and `productId` is mandatory. There is no
  `POST /products` an agent may call (admin-human only) and no UI. So the first
  issue in the system requires: run migrations → run `npm run seed users.csv` to
  create an admin → `curl POST /auth/login` with a cookie jar →
  `curl POST /products` with that cookie. Until all four happen in order, every
  intake path returns 422. Nothing in the repo says so (see Production
  Readiness).
- **The agent cannot comment** (`comments/route.ts:12`, forbidden with the note
  `도선사 댓글은 spec §10 이후`). That is the correct reading of §10.4 today, but
  it is worth being explicit that the 도선사 persona's first feature — posting a
  suggestion — needs an authorization change, not just new code.

---

### Emergent Problems

Two real defects that no per-task review could have seen, because each lives in
the interaction between two tasks' files. I proved both against PGlite rather
than reasoning about them.

**E1 — An issue that leaves the backlog keeps its slot, and that slot gets
handed to someone else.** `src/domain/issues.ts:104-105` assigns a `sortOrder`
on entry to backlog but never clears it on exit, so an `in_progress` issue sits
on a stale `sortOrder`. Meanwhile every ordering query filters
`status = 'backlog'` (`ordering.ts:16-17,38,45,119`), so that parked value is
invisible to the neighbour search. Probe output:

```
initial backlog:            A=1024 B=2048 C=3072
B → in_progress:            B still holds sortOrder 2048
reorder C to after A:       C.sortOrder = 2048     ← lands on B's parked slot
B → backlog (legal):        A=1024 B=2048 C=2048
duplicate sortOrder?        true
```

Consequence: the admin's explicit "C goes right after A" decision is resolved
by `asc(issues.id)` tie-break the moment B returns, i.e. arbitrarily from the
user's point of view. No error, no event, no signal. This is **not** a
concurrency race — it is a single actor doing three ordinary things in sequence
(start work on an item, reorder the rest, put the item back), which is exactly
why the real-Postgres concurrency gate did not catch it. Manual backlog order is
the one thing spec §4 says this tool exists to maintain.
*Fix:* clear `sortOrder` when the target status is not `backlog` — a one-clause
change to the existing ternary at `issues.ts:104`. A returning issue then
appends at the end, which is the honest semantics for 선적 대기 (it stopped
waiting to be loaded). Consider recording the clear as a `sort_order` event for
symmetry.

**E2 — Rejected issues sit on the roadmap forever and cap every progress bar
below 100%.** `src/domain/catalog.ts:73-74` computes `total: group.length` with
no status filter, and nothing clears `milestoneId` on rejection
(`issues.ts:107-108` does not touch it). Probe output:

```
milestone 2026 Q3: one issue done, one issue rejected
getRoadmap → {"total":2,"done":1}   → UI shows 50% with zero live work left
```

Every roadmap accumulates rejections over time, so this drifts monotonically
worse and the progress bar in spec §4 becomes meaningless. The API does return
the per-issue `status` array so a client *could* recompute, but shipping
`total`/`done` as the contract means clients will trust them.
*Fix:* exclude `rejected` from `total` (one `.filter`), or return
`total`/`done`/`rejected` separately and let the client decide. Either way it is
a deliberate product decision that should be made before a UI consumes it.

**Two smaller emergent inconsistencies**, same class, lower stakes:

- `reorderIssue` is the only mutation that does not participate in optimistic
  concurrency: `ordering.ts:101-103` sets `sortOrder` with
  `.where(eq(issues.id, id))` — no `version` predicate, no `version` bump —
  while `updateIssue` and `transitionIssue` both do. A reorder therefore does
  not invalidate a client's held version. Defensible (sortOrder is not
  patchable), but it means "every write bumps version" is not an invariant a
  future author can rely on, and `renumberBacklog` (line 121) writes without
  even touching `updatedAt`.
- `reorderWithinTx` is also the only update path missing the
  `if (!updated) return conflict` guard that `issues.ts:87` and `:111` both
  have. Under READ COMMITTED the row could vanish between the line-65 SELECT
  and the line-101 UPDATE, yielding `{ ok: true, issue: undefined }` and a
  `{"ok":true}` body with no `data`. Unreachable in Phase 1 (no delete
  endpoint), but it is a latent hole that the sibling paths closed.

---

### Spec §10 Guardrails

**§10.1 API-first parity — preserved in substance.** Every human action is a
named API operation; no business logic hides in a route. I checked the inverse
too: an agent is *authorized* only for create+read, but that is a policy check
at the auth layer (`forbidden()` in six places), not a missing operation — the
operations exist and a token grant is all that stands between an agent and
them. That is the correct shape for this guardrail and it matches spec §3.

One genuine parity gap and one dead field:
- **There is no `GET /users`.** A web UI cannot populate an assignee dropdown,
  and an agent cannot discover the `requesterPortalId` it is required to send.
  Phase 2 will need it; not a Phase 1 defect, but it is the one operation whose
  absence blocks a client.
- **`products.active` is unreachable.** The column exists
  (`schema.ts:25`) and `GET /products` returns it, but nothing in the repo ever
  writes it — no PATCH route, and `createProduct` always defaults it true. A
  field no operation can change is not parity, it is a promise.

**§10.2 Actor attribution everywhere — preserved on the issue aggregate,
absent on the catalog.** Every issue mutation is attributed. But
`createProduct(db, name)`, `createMilestone(db, input)`, and
`updateMilestone(db, id, patch)` (`catalog.ts:9,20,29`) **do not take an
`Actor` at all**, and `products`/`milestones` have no actor columns and no
`updatedAt`. So closing a milestone — which changes what the team has committed
to shipping this quarter — leaves no trace of who did it or when. It is not
merely unrecorded; it is unrecordable without a migration.

The progress ledger (line 372) shows this was *seen*: the implementer "checked
the schema and reported that `products` and `milestones` carry no actor columns
at all, so the amendment applies only to comments/issue_events and is not
applicable here," and the controller accepted that. **I disagree with that
adjudication, and I think it inverts the guardrail.** §10.2 is a requirement on
the data model; the absence of columns is the finding, not the exemption. And
roadmap decisions are precisely the material §10 anticipates an AI participating
in ("roadmap risk summaries") — provenance for "who moved Q3's scope" is the
thing that makes such a summary trustworthy. That said, I do not think it blocks
this merge (see Issues → Important): no roadmap data exists yet, and the fix is
a migration that Phase 2 must ship anyway.

**§10.3 Machine-readable context — yes, with a caveat, and the literal question
in the brief has a "no" answer.** Everything is queryable: `getIssueDetail`
returns the issue, comments, events, and relations with related titles resolved
in one call, and reject/hold reasons live both on `issues.reason` and as a
`reason` event.

But the brief asked specifically: *can you reconstruct who changed what from
`issue_events` alone?* **No.** Comments produce no `issue_events` row
(`collab.ts:16-24`) — they are attributed on the comment row itself, which is
correct and arguably better, but it means `issue_events` is not a complete
change log. Note the asymmetry is *within one file*: `addRelation` and
`removeRelation` both write `issue_events`, `addComment` does not. Full history
therefore requires `issue_events ∪ comments`, plus nothing at all for
catalog changes. Practically fine — `getIssueDetail` hands a client both — but
"issue_events is the audit log" is not a statement a Phase 2 author can rely on,
and it should be written down or made true.

**§10.4 Suggestion ≠ action — preserved, and better than required.** Nothing
writes silently. The `Actor` union already distinguishes agents from humans at
every mutation, so "proposed by token 3, confirmed by user 7" needs no schema
change to express — an event pair or a `confirmed_by` column both remain open.
The door §10.4 asked to be left open is open.

---

### Production Readiness

- **The README is still the create-next-app template**, down to "Deploy on
  Vercel" (`README.md:32-36`), while this project deploys to GCP. It is not
  merely absent documentation, it is *wrong* documentation pointing an operator
  at the wrong platform. Nothing in the repo records that a first deploy needs
  `DATABASE_URL` + `SESSION_SECRET`, then `npm run db:migrate`, then
  `npm run seed <csv>` to get an admin, then a login-and-`POST /products` curl
  dance before the API can accept a single issue, then `npm run create-token`
  for the Slack bot. That sequence is mandatory, order-dependent, and currently
  lives only in this reviewer's head and Task 11's report.
- **`drizzle-kit` is a devDependency** (`package.json:34`) but `db:migrate` is
  the only migration path. A production image built with `npm ci --omit=dev`
  will not contain the tool needed to create its own schema. Phase 3's deploy
  work must either keep dev deps in the migration step, run migrations from CI,
  or vendor the SQL. Flagging it now because it is the kind of thing discovered
  at 2am during a first deploy.
- **`/api/health` does not touch the database** (`health/route.ts:3-5`). A
  Cloud Run readiness probe will report healthy while Postgres is unreachable,
  and per this project's CLAUDE.md that is exactly the class of signal that
  wastes a debugging session. One `select 1` would make it mean something.
- **`SESSION_SECRET` is validated lazily and per-request** (`session.ts:10-11`).
  A too-short secret does not fail at boot; it turns every auth route into a
  500 with a generic Korean message. The real cause is in the logs via
  `withErrorEnvelope`'s `console.error`, so this is recoverable, just slower
  than it needs to be.
- **Migration integrity is good.** Single `0000_*` migration regenerated from
  scratch (nothing deployed yet), journal and snapshot consistent, both XOR
  CHECKs and all four `ON DELETE restrict` actor FKs present in the SQL. The
  remaining FKs are `NO ACTION`, which in Postgres blocks deletes identically to
  `RESTRICT` (differing only in deferrability), so child rows already protect
  issues from deletion. No first-deploy schema risk that I can find.
- **No indexes beyond primary keys and uniques.** `issue_events.issue_id`,
  `comments.issue_id`, `issues.status`, `issues.milestone_id` are all sequential
  scans. Entirely fine for ~10 users and years of data at this volume; noting it
  so nobody is surprised later. Do not add them now.
- **`listIssues` has no pagination** and `getIssueDetail` returns unbounded
  comment/event arrays. Same judgement: fine at this scale, and the Slack bot
  pulling the full list is the first place it would bite.
- **Timestamps are `timestamp` without time zone**, and milestone dates are
  date-only input stored in a timestamp column. I probed this under
  `TZ=Asia/Seoul` expecting an off-by-one and **did not find one** — `2026-07-01`
  round-trips to `2026-07-01T00:00:00.000Z` and renders as `2026. 7. 1.` for a
  KST reader. So this is a note, not a defect: a `date` column would be the
  honest type, and the current one renders a day early for any UTC-negative
  viewer, which this team does not have.

---

### Issues

#### Critical (Must Fix)

None. I looked specifically for authorization holes, attribution forgery,
transaction gaps, and data-loss paths, and the two prior gates plus the live
Postgres pass appear to have genuinely closed them. `tsc` is clean and 191/191
tests pass at HEAD.

#### Important (Should Fix)

**I1. The iron-session integration has no automated execution at all — merge
blocker.** `tests/api/issues.test.ts:13` does
`vi.mock('@/lib/session', () => ({ getSession: async () => sessionState }))`, so
every test that needs a logged-in human replaces the real session module.
`tests/api/auth-envelope.test.ts` runs the real `getSession` but only with
`SESSION_SECRET` deleted, i.e. only the throw path. Coverage confirms it
precisely — `src/lib/session.ts` line 12, the
`getIronSession(await cookies(), …)` call, is **the single uncovered line in the
entire `src/lib` slice**:

```
 lib          |   94.33 |    96.15 |   84.61 |   97.77 |
  session.ts  |      75 |       50 |     100 |   66.66 | 12
```

`session.save()` (login:15) and `session.destroy()` (logout:7) are never
executed by any test either. The 95.83% headline is real; the missing sliver
happens to be the mechanism by which humans authenticate. A Next.js minor
bump that changes `cookies()` semantics ships green and locks every human out.
The deferred list frames this as B1, "no tests for the normal 200/400/401
paths," which undersells it — the gap is the integration, not the status codes.
*Fix:* one test file that does not mock `@/lib/session`: real login → assert a
`rudder_session` Set-Cookie → replay that cookie to `/auth/me` → assert the
identity → logout → assert `/auth/me` now 401. That single test converts the
human auth path from "verified once by hand" to "verified every run."

**I2. `issue_events.field` mixes three naming conventions** (table in
Cross-Cutting above). Load-bearing because this is the §10.3 machine-readable
history, and because the format becomes immutable the moment the first row is
written — fixing it later is a data migration, fixing it now is a string change.
*Fix:* pick snake_case column names; map the patch loop's TS field names through
a small lookup at `issues.ts:89`.

**I3. E1 — backlog order is silently lost when an issue leaves and re-enters
the backlog** (proven above). `src/domain/issues.ts:104`.
*Fix:* clear `sortOrder` when the target status is not `backlog`.

**I4. E2 — rejected issues are counted in roadmap `total`, so no progress bar
can reach 100%** (proven above). `src/domain/catalog.ts:73-74`.
*Fix:* filter `rejected` out of `total`, or expose the three counts separately.

**I5. Catalog mutations are unattributed and unattributable** (§10 section
above). `src/domain/catalog.ts:9,20,29` take no `Actor`; the tables have no
actor columns and no `updatedAt`. I disagree with the ledger's "not applicable
here" ruling — the missing columns are the finding. *Not* a merge blocker (no
data exists yet), but it must be an explicit, named Phase 2 schema task rather
than a note, because "who changed the roadmap" is unanswerable retroactively.

**I6. `domainErrorStatus` couples HTTP status to the wording of user-facing
Korean copy.** `respond.ts:60-63` routes 404 by
`error.includes('찾을 수 없습니다')`. Correct today, and the comment says so. The
architectural problem the per-task reviews could not see: user-facing copy is
exactly what a PO reworders, and rewording it changes HTTP semantics across
every endpoint at once. It also interacts with the B-group test gaps — four
separate deferred items describe tests that assert `.ok === false` without
pinning the message, so a rewording would go undetected in the domain layer
even though `issues.test.ts` pins some statuses at the route layer.
*Fix (Phase 2, not now):* return a discriminated
`{ ok: false, kind: 'not_found' | 'conflict' | 'rule', error }` and let the
route map `kind`. Prose stops being an API contract.

**I7. `/auth/me` re-implements session-to-user resolution** instead of using
`actorFromRequest` (Cross-Cutting #2). The endpoint whose job is identity is the
one that will drift from the identity rules.

#### Minor (Nice to Have)

- **M1.** README is create-next-app boilerplate recommending Vercel
  (`README.md:32-36`); no operator runbook exists. Listed as Minor only because
  Phase 3 owns deploy — but the *bootstrap sequence* should be written down now,
  while the person who knows it is still in the room.
- **M2.** `serialize` duplicated (`issues.ts:11`, `ordering.ts:13`) — move to
  `src/domain/events.ts`. Six lines.
- **M3.** `export type Tx` (`db/client.ts:7`) has zero usages anywhere in
  `src/`, `scripts/`, or `tests/` — verified by grep. Delete the line; `DbOrTx`
  is effectively `Db` already since drizzle's tx handle satisfies `PgDatabase`.
- **M4.** `requireAdmin` exists in one file and is inlined in five others.
- **M5.** Auth routes and `/api/health` bypass `respond.ts`'s `ok`/`fail`/
  `unauthorized`; `/api/health` also skips `withErrorEnvelope`.
- **M6.** `pgIdCoerced` (`validation.ts:8`) is looser than `parsePgId`; make the
  query filters use the same rule.
- **M7.** `listIssues` silently ignores `requester=me` for agent callers
  (`issues/route.ts:18`) and returns everything instead. A Slack "show my
  requests" command would dump the whole tracker. Prefer a 400.
- **M8.** `reorderIssue` neither checks nor bumps `version`; `renumberBacklog`
  does not touch `updatedAt`; `reorderWithinTx` lacks the `!updated` guard its
  two sibling paths have.
- **M9.** `products.active` has no writer and no reader — dead column until
  Phase 2 adds `PATCH /products`.
- **M10.** `/api/health` does not touch the DB, so it will report healthy
  against a dead database.
- **M11.** Milestone dates are date-only semantics in a `timestamp` column.
  Probed correct under KST; `date` would be the honest type.

---

### Deferred-Item Triage

All nineteen, with a verdict each.

**A. Deliberate deferrals**

| # | Verdict | Reasoning |
|---|---|---|
| A1 | **Defer to Phase 3** | Agree with the controller: a correct limiter needs shared state that only the deploy posture defines, and an in-memory counter on Cloud Run is theatre. Make it a *blocking* checklist line in the Phase 3 plan, not a note — bcrypt cost 10 is the only thing throttling guesses today. |
| A2 | **Ship as-is** | Authenticated internal API, platform-bounded body size, and a bounded reader's design depends on the same undecided posture. Correct call. |
| A3 | **Ship as-is, but the documentation is not loud enough** | The race is genuinely unreachable (no delete endpoint, one rename path) so the code is fine. But the warnings live in `catalog.ts:39-41` and `respond.ts:36-39` — inside the functions. The person who adds `DELETE /milestones/:id` will be creating a *new route and a new domain function* and will never open `updateMilestone`. Put one line in the Phase 2 plan: "adding any delete endpoint requires revisiting the existence pre-checks in `respond.ts` and `catalog.ts:updateMilestone`." That is where they will actually look. |

**B. Test-coverage gaps**

| # | Verdict | Reasoning |
|---|---|---|
| B1 | **Fix before merge** | The only item I would block on, and it is bigger than described — see I1. Not "missing status-code tests" but "the iron-session integration never executes in the suite," with `session.ts:12` as the single uncovered line in `src/lib` as proof. One cookie round-trip test closes it. |
| B2 | **Ship as-is** | Narrower assertions, not a code gap; both branches are already reachable through the matrix tests. |
| B3 | **Ship as-is** | Two trivially-shaped filters and one `orderBy` branch. My own probe exercised the backlog-ordering branch incidentally and it behaves correctly. Phase 2's UI will cover them by necessity. |
| B4 | **Ship as-is** | `serialize()` is applied symmetrically; the asymmetric assertion is a narrower test of correct code. |
| B5 | **Ship as-is** — fold into the B-group hardening | Combine with B2/B6: the systemic habit is asserting `.ok === false` without the message. Worth one cleanup pass in Phase 2 precisely because `domainErrorStatus` routes on message content (I6), not because any individual assertion is wrong. |
| B6 | **Ship as-is** | Each branch verified by reading, and the mapping function itself is tested. Same Phase 2 pass as B5. |
| B7 | **Ship as-is** | Agree with declining the DI seam — abstraction purely for testability, and `scripts/verify-concurrency.ts` against real Postgres is the right instrument for a branch only genuine concurrency reaches. Good judgement. |

**C. Code hygiene**

| # | Verdict | Reasoning |
|---|---|---|
| C1 | **Fix before merge** | Agree with the reviewer over the controller. Six lines, zero risk, and the reviewer's `events.ts` placement is verifiably cycle-free. It also happens to be the null-handling rule for the audit log, so divergence would corrupt half the history. |
| C2 | **Fix before merge (delete it)** | Verified: `Tx` has zero usages outside its own declaration. A one-line deletion with `tsc --noEmit` as the proof. An exported type that cannot be used is a trap someone pays for later. |
| C3 | **Ship as-is** | The current code is correct and readable. Restructuring working control flow to relieve a type-narrowing tension is churn; `tsc` is already clean. |

**D. Consistency and robustness**

| # | Verdict | Reasoning |
|---|---|---|
| D1 | **Fix before merge (one line)** | Same class as C1/C2 — one concept, two implementations — and one-line consistency fixes are exactly what never gets done later. Bounded, so not dangerous; just make the filter parser match `parsePgId`. |
| D2 | **Ship as-is; fix structurally in Phase 2** | Agree it is correct today and the comment is honest. But the deeper issue the triage does not name is that HTTP semantics now depend on Korean copy a PO may rewrite — see I6. Ship, then replace prose-matching with a discriminated `kind` in Phase 2. |
| D3 | **Ship as-is** | Documented, and Vitest's `isolate: true` makes it safe. Revisit only if someone turns isolation off. |
| D4 | **Ship as-is** | Internal one-shot tool that now rejects malformed lines loudly instead of truncating. A CSV parser here would be over-engineering. |

**E. Environment and dependencies**

| # | Verdict | Reasoning |
|---|---|---|
| E1 | **Ship as-is; re-check at Phase 3** | Dev-tooling transitives, nothing runtime-facing. Re-run with production scope (`npm audit --omit=dev`) as part of the deploy gate, when it actually means something. |
| E2 | **Ship as-is — and the triage overstates the exposure** | Correct that an empty-string hash would reach `bcrypt.compare(password, '')`, but `auth.ts:15` returns `user?.passwordHash && match ? user : null`, so an empty hash is falsy and the call **already returns null** regardless of the compare. The only real effect is a wasted compare (or a 500 if bcryptjs throws on an empty hash) — never a successful login. Unreachable today, and already fail-closed if it were reachable. |

**Summary:** 4 fix-before-merge (B1, C1, C2, D1), 13 ship-as-is, 2 deferred to a
named phase (A1 → Phase 3, D2's structural fix → Phase 2). Two adjudications I
disagree with: A3's "comments record the dependency" is insufficient placement,
and E2's exposure is smaller than stated. Separately, the biggest §10 gap is not
on this list at all — catalog attribution (I5), which the ledger ruled "not
applicable" at line 372.

---

### Recommendations

**Process — what worked and should be kept.**

1. **The asynchronous Codex gate was the right call** (ledger line 95). Treating
   an adversarial pass as a finding *stream* attributed to whichever task owns
   the touched file, instead of serialising each lane behind a 5-10 minute run,
   is a genuinely reusable pattern. Keep it.
2. **Escalating the optimistic-lock mechanism to the owner as a data-model
   decision** (ledger ~line 590) rather than picking one was correct, and the
   chosen `version` column is the right answer for the recorded reason: after
   being burned by a driver precision subtlety, pick a mechanism independent of
   driver behaviour.
3. **The plan is a source of defects and should be treated as one.** The ledger
   records the plan's own code blocks carrying `actorId` after the schema
   changed, a non-terminating retry, and stale framework versions — each caught
   only because a review read the code rather than the plan. For Phase 2:
   either stop putting full code blocks in plans (specify contracts and
   invariants; let implementers write code), or make "plan doc updated" part of
   every fix round's definition of done. The second is what happened; the first
   is cheaper.
4. **Serialise on the index, and treat "reported DONE" as still-active.** The
   ledger's own honest note at line 272 — two implementers live in one index,
   "no damage resulted, but that was luck" — is the single most valuable line in
   it. Carry that rule forward explicitly.

**Architecture — for Phase 2.**

5. **Freeze the `issue_events` vocabulary before the first row exists**, and
   write it down somewhere an implementer will read (a short `docs/events.md`,
   or a `const EVENT_FIELDS` the domain layer must use). This is the only
   artefact here that a later code change cannot fix.
6. **Replace prose-matched error routing with a discriminated `kind`** (I6)
   before the number of domain error strings doubles.
7. **Decide the "one obvious way" for the seams that currently have two**: one
   admin guard, one id parser, one identity resolver, one response helper. Do it
   as a single small pass at the start of Phase 2 rather than per-feature, and
   the UI work inherits one idiom instead of choosing between two.
8. **Phase 2's schema task should carry catalog attribution** (I5) plus
   `products.active`'s missing PATCH and a `GET /users` — the three things a UI
   will immediately need and cannot currently reach.

---

### Assessment

**Ready to merge?** **With fixes** — four of them, all small.

**Reasoning:** The core is sound: `tsc` clean, 191/191 tests green at HEAD, the
XOR actor constraint enforced in the database rather than in application code,
uniform route→domain seams across eleven implementers, and §10's guardrails
preserved in substance rather than in name. I found no critical defect, and the
two emergent bugs I proved (backlog order silently lost on backlog re-entry;
rejected issues capping every roadmap progress bar) are one-clause fixes in
domain code that no per-task review could have seen. The one thing I would
genuinely block on is B1/I1: every test mocks `@/lib/session`, so the sole
mechanism by which a human authenticates is executed by nothing in the suite —
`session.ts:12` is the single uncovered line in all of `src/lib` — and one
cookie round-trip test converts that from hand-verified to always-verified.

**Recommended pre-merge set:** B1/I1 (session round-trip test), C1
(`serialize` → `events.ts`), C2 (delete `Tx`), D1 (`pgIdCoerced` → `parsePgId`
rule). I would also take I3 and I4 now, since both are one-line domain fixes to
behaviour a Phase 2 UI would otherwise be built on top of, and I2 before any row
lands in `issue_events`. Everything else is honestly Phase 2 or Phase 3 work.
