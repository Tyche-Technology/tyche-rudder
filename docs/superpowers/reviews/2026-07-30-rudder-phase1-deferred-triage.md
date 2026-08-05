# Deferred items for final-review triage

Every one of these was found by a review, adjudicated by the controller, and
recorded rather than silently dropped. Your job is to decide which must be fixed
before this branch merges, which can ship as-is, and which belong in a later
phase. Say so explicitly for each — a list with no verdict is not a triage.

## A. Deliberate deferrals with stated reasoning (three)

**A1. Login rate limiting is absent.** Codex found unlimited online password
guessing and bcrypt CPU exhaustion on `POST /auth/login`. Deferred because a
correct limiter needs shared state — this deploys to Cloud Run where every
instance has its own memory, so an in-memory counter would be security theatre
that looks like protection — and whether the service is publicly reachable is a
Phase 3 deployment decision. Must be carried into the Phase 3 plan.

**A2. Request bodies are fully buffered before validation.** `req.json()` parses
the whole payload before zod applies field limits, so an authenticated caller can
force full parsing of a very large body. Deferred because Cloud Run bounds request
size at the platform level, the API is internal-only behind authentication, and a
bounded body reader's value depends on the same undecided deployment posture.

**A3. `addRelation`'s duplicate handling is race-free but products/milestones'
was fixed differently.** Both now use `ON CONFLICT DO NOTHING` + `RETURNING`;
`updateMilestone`'s rename path uses an existence pre-check instead, because
`ON CONFLICT` has no `UPDATE` equivalent. That pre-check is racy in principle.
Accepted because Phase 1 has no endpoint that deletes a product, user, or
milestone and only one path renames them, so nothing can remove the row between
check and insert. Comments record the dependency. **Anyone adding a delete or
bulk-rename endpoint inherits the race** — judge whether that is documented
loudly enough.

## B. Test-coverage gaps (seven)

**B1.** The three auth routes (`login`, `logout`, `me`) have no automated tests
for their normal 200/400/401 paths — only the forced-throw envelope path is
covered. Success paths rest on manual curl evidence in Task 7's report and Task
11's live smoke.

**B2.** Task 3's four reason-gated transition edges assert only `.ok`, not the
returned priority on the success branch or the error string on the failure
branch. Mirrors the brief's original pattern.

**B3.** `listIssues`'s `productId`/`milestoneId` filters and its backlog
`sortOrder` ordering branch are implemented but not directly asserted.

**B4.** Task 4's nullable-clear test asserts `newValue === null` but not that the
prior event recorded `oldValue === null`. `serialize()` is applied symmetrically,
so this is a narrower test rather than a code gap.

**B5.** Task 6's self-relation and duplicate-relation tests assert only
`.ok === false`, leaving `'자기 자신과는 연결할 수 없습니다'` and
`'이미 연결되어 있습니다'` without exact-string coverage anywhere.

**B6.** Several domain-error branches reachable through `domainErrorStatus` have
no route test pinning their status, though each was verified correct by reading:
missing priority entering backlog, missing reason on reject/hold, self-relation,
contradictory anchors.

**B7.** Task 5's retry bound is implemented but its branch is unreachable in the
Vitest harness — after a renumber every backlog row is at least `ORDER_GAP`
apart, so a same-transaction retry cannot re-trigger the squeeze. Only genuine
cross-transaction concurrency reaches it. A DI seam to reach it was explicitly
declined as abstraction-for-testability.

## C. Code-hygiene items with concrete fixes (three)

**C1.** `serialize` is duplicated in `src/domain/issues.ts` and
`src/domain/ordering.ts`. A reviewer found the option neither the controller nor
the implementer explored: put it in `src/domain/events.ts`, which both files
already import `recordEvent` from and which depends on neither, so there is no
cycle, no new module, and no duplication. Roughly six lines across three files.

**C2.** The `Tx` type exported from `src/db/client.ts` does not structurally match
what drizzle's `.transaction()` callback provides — Task 5 hit TS2345 using it and
fell back to `DbOrTx`, which works everywhere. An exported type that cannot be
used is a trap. Either fix its generics or delete it and let `DbOrTx` be the
single name.

**C3.** Computing `next` in `reorderIssue` through a helper returning
`number | null` would remove the two-guard TS2454 tension entirely. A reviewer
compiled a scratch repro against the project's real tsconfig to confirm it works.
Purely structural.

## D. Consistency and robustness observations (four)

**D1.** `pgIdCoerced` (used only for `listIssuesSchema`'s GET query filters) is
`z.coerce.number()`, looser than `parsePgId` — it would read `"0x10"` as 16 or
`"1e3"` as 1000 for a filter value. Still bounded, so it cannot cause the crash
class it was introduced against; the effect is a silently surprising filter and an
inconsistency between path-id and filter strictness.

**D2.** `domainErrorStatus` maps to 404 by testing whether a message contains
`'찾을 수 없습니다'`. Correct for every current domain string, and a comment now
names the assumption — but a future domain message containing that phrase for a
non-404 reason would silently misroute.

**D3.** `globalThis.__rudderTestDb` is process-global. Safe today because Vitest's
default `isolate: true` gives one worker per file, but a later task calling
`getDb()` from application code inside a shared test file could collide.

**D4.** `scripts/seed.ts` splits CSV on commas with no quote handling, so a comma
inside a name or password breaks the row. It now rejects any line without exactly
four fields rather than silently truncating, and it is an internal one-shot tool.

## E. Environment and dependency notes (two)

**E1.** `npm audit` reports 7 transitive dev-tooling vulnerabilities (4 moderate,
3 high) inherited from the Next.js scaffold. None are runtime-facing.

**E2.** `user?.passwordHash ?? TIMING_EQUALIZER_HASH` substitutes only on
`null`/`undefined`, so an empty-string `passwordHash` would reach
`bcrypt.compare(password, '')` instead of returning null. Currently unreachable —
the only writer is `scripts/seed.ts`, which always inserts a real hash for a
validated non-empty password. Becomes live if a future admin UI writes `''`.
