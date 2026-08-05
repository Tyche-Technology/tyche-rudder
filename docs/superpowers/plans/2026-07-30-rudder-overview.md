# Rudder — Implementation Plan Overview

Spec: `docs/superpowers/specs/2026-07-30-issue-tracker-design.md`
Date: 2026-07-30

The spec covers three subsystems. Per plan-scoping rules each gets its own
plan producing working, testable software on its own:

| Phase | Plan file | Produces | Status |
|-------|-----------|----------|--------|
| 1. Core | `2026-07-30-rudder-phase1-core.md` | DB schema, domain logic, auth, full REST API — testable via Vitest without any UI | Written |
| 2. Web UI | `2026-07-31-rudder-phase2-ui.md` | Design system (delivered 2026-07-31: `design/` + `docs/superpowers/design/2026-07-30-rudder-design-system.md`) + all five views on the Phase 1 API + carried-over API obligations (error kinds, catalog attribution, GET /users, PATCH /products) | **Shipped** |
| 3. Integrations & launch | `2026-08-03-rudder-phase3-launch.md` | Attachments (GCS), Slack notifications, Hermes bot intake, Playwright E2E, VM deploy behind Tailscale (spec `2026-08-03-rudder-phase3-launch-design.md` superseded the Cloud Run assumption) | Written |

Phase 2/3 plans are deliberately deferred: Phase 2 depends on the design
system output, Phase 3 on the IT Portal auth investigation result (Phase 1
Task 7) and on which Cloud SQL/Run wiring survives Phase 1 unchanged.

## Locked Decisions (apply to all phases)

- **Stack**: Next.js 16 (App Router, TypeScript) full-stack — the API routes
  ARE the REST API (architecture A: web UI, Slack bot, and AI agents are all
  clients of `/api/v1/*`). Team already operates Next.js (<existing-dashboard-vm>).
- **DB**: Postgres. Production = new database `rudder` on the existing Cloud
  SQL instance `<cloud-sql-instance>` (zero new infrastructure). Local dev = Docker
  Postgres. Tests = PGlite (in-process Postgres, no daemon).
- **ORM**: Drizzle (lightweight, SQL-shaped, first-class PGlite support).
- **Auth**: session cookie via iron-session for humans; `Bearer rud_*` API
  tokens for agents. IT Portal credential integration is an investigation
  task (Phase 1 Task 7) with a local-password fallback that ships either way.
- **Validation**: zod at every API boundary.
- **Tests**: Vitest + PGlite; TDD; coverage gate ≥80% on `src/domain` and
  `src/lib`. Playwright E2E arrives in Phase 3.
- **Metaphor**: name Rudder; nautical labels pair with standard terms
  (스펙 §7 binding rules). Enum values in code stay standard English.
- **AI-readiness guardrails** (spec §10): every mutation goes through a
  domain function that records an actor-attributed event; no UI-only logic.

## Deferred (recorded so they are not lost)

- `attachments` table + GCS upload — Phase 3 (schema migration added then).
- Slack channel/DM notifications — Phase 3 (`src/lib/slack.ts`).
- <slack-bot-repo> slash-command intake — Phase 3, touches the slack-bot repo.
- User-management UI — not planned; users are seeded by script (YAGNI:
  ~10 people; revisit if onboarding becomes frequent).

---

## Phase 1 outcome (2026-07-30)

Delivered on `feat/rudder-phase1-core`: 37 commits, 199 tests across 14 files,
`tsc` clean, coverage 95.8% statements / 92.8% branches on `src/domain` and
`src/lib`. Every task passed two independent gates — a task review and an
adversarial review — plus a phase gate that exercised the API end to end against
a real Postgres rather than the in-process PGlite used by the unit suite.

The phase gate earned its place: it found that the optimistic-concurrency guard
fired on **every** call against real Postgres, because `postgres-js` parses
`timestamp` to millisecond-precision `Date` while Postgres `now()` is microsecond
precision — so `updatedAt` could never equal itself across a round trip. PGlite's
`now()` happens to be millisecond-exact, so all unit tests passed while grooming
transitions and PATCH were dead in production. The guard now uses an explicit
`issues.version` integer column, which does not depend on driver precision.

### Obligations carried into Phase 2

1. **Catalog mutations are unattributed.** `createProduct`, `createMilestone` and
   `updateMilestone` take no `Actor`, and `products`/`milestones` carry no actor
   columns. This is a named schema task, not a note: "who changed the roadmap" is
   unanswerable retroactively, and the cost only rises once rows exist.
2. **`issue_events.field` uses snake_case column names.** The convention is now
   uniform across every `recordEvent` call site. It is effectively frozen — a
   change after real rows exist is a data migration.
3. Test-coverage gaps worth closing while touching the areas: the three auth
   routes' normal 200/400/401 paths, exact-string assertions for the
   self-relation and duplicate-relation errors, `listIssues`'s `productId`/
   `milestoneId` filters and its backlog ordering branch.

### Obligations carried into Phase 3 (deploy)

1. **Login rate limiting.** Deliberately absent. A correct limiter needs shared
   state because Cloud Run gives each instance its own memory — an in-memory
   counter would be security theatre. Whether the service is publicly reachable
   is a Phase 3 decision, so the limiter belongs with it.
2. **Request body size limits.** `req.json()` buffers the whole payload before
   zod applies field limits. Cloud Run bounds request size at the platform level
   and the API is internal-only, so this was deferred to the same decision.
3. **IT Portal authentication.** `verifyCredentials` in `src/lib/auth.ts` is the
   single swap point; it currently compares against locally-seeded bcrypt hashes.

### Known properties, deliberately accepted

- **Sessions are stateless.** `iron-session` seals the session into the cookie;
  `logout` sets `Max-Age=0` on the client's copy and there is no server-side
  revocation. A cookie captured before logout remains valid until it expires —
  verified by experiment, asserted in `tests/api/session-live.test.ts`. Normal for
  sealed-cookie sessions; revisit only if session revocation becomes a
  requirement, which would mean introducing a session store.
- **`src/lib/session.ts:12` reports as uncovered forever.** It is exercised by
  `tests/api/session-live.test.ts`, which drives a real `next dev` server, but V8
  coverage is process-local so the parent collector cannot see the child process.
  Do not "fix" the number by replacing that test with a mocked one.
- **Existence pre-checks assume no deletion endpoints.** The foreign-reference
  checks on issue create/patch, and the duplicate-name check on milestone rename,
  are safe only because Phase 1 has no endpoint that deletes a product, user, or
  milestone. Adding one inherits a check-then-insert race; the call sites carry
  comments saying so.
- **`domainErrorStatus` maps 404 by testing for `'찾을 수 없습니다'` in the
  message.** Correct for every current domain string, and commented — but a
  future message containing that phrase for a non-404 reason would misroute.

---

## Phase 2 outcome (2026-07-31)

Delivered on `feat/rudder-phase2-ui`: 356 tests across 29 files, `tsc` clean,
`next build` clean, coverage 89.05% statements / 85.46% branches — measured at
the phase's final commit; the gate itself is ≥80%. Scope is `src/domain`,
`src/lib` and `src/ui`: `vitest.config.ts` asks for `src/ui/*.ts` only, but
component `.tsx` files that a test loads land in the artifact too, so the
measured scope is wider than the config reads. All five views ship, plus the
four carried-over API obligations.

**The design system came first, before any UI code** — tokens, component specs,
and one worked screen per view (`design/`), signed off in a browser against the
real contrast numbers. Every later task cited it as the binding spec, which is
why "does this match the mockup" was answerable at review time instead of
arguable.

### How it was built

Eleven tasks, each with a fresh implementer and **two independent gates** — a
Claude task review and an adversarial Codex review — plus scoped re-reviews per
fix round. Tasks 7–10 ran as four parallel git-worktree lanes off one base
commit and merged sequentially with a full-suite run per merge; zero merge
conflicts. A phase gate then drove all five views in a real browser against real
Postgres, with a scenario built entirely through the live API.

### What that cost, and what it bought

Six fix rounds across the four parallel lanes; five on Task 6 alone, where the
grooming panel's failure-recovery state machine took until the round breaker to
converge. Two of those rounds regressed on **my own prescriptions** — a design
handed to an implementer without tracing the render gate it passed through
(blanking the whole board on a transient reorder failure), and a "don't prune
this set" instruction that turned an unsubmitted close into a false positive.
Both were caught by the next gate, which is the argument for the gates.

The two reviewers were **complementary, not redundant**. Claude approved rounds
in which Codex then found real race conditions; Codex raised API-contract
rewrites and deferred-by-design smoke tests that were correctly overruled. Neither
alone would have been enough:

- Codex reproduced the KST midnight state-flip on the roadmap by probe — the same
  deadline classified `dest` at 00:30 KST and `overdue` at 12:00.
- A Claude re-reviewer caught a regression test that was green **only in this
  sandbox's timezone**, reproducing the failure under `TZ=UTC`. A test that
  passes because of where it runs is the tautology class this project hunts.
- The browser pass found two defects no unit test could: every timestamp
  rendered in UTC, and the shell had no logout affordance at all (the approved
  mockup had forgotten one too).

The final fix wave was implemented by the orchestrating controller directly — the
subagent fleet had been stopped — and was therefore sent through an independent
review afterward rather than shipping unexamined.

### Obligations carried into Phase 3

1. **Client-round-trip optimistic locking**, as ONE contract decision covering
   issue `PATCH` expected-version, reorder CAS, and milestone CAS. Today's
   failure mode is last-write-wins between two concurrent admins on a
   ~10-person tool. Be precise about the limit of that: `updateIssue` guards
   with an explicit `version` column, but `updateMilestone` re-reads without a
   lock, so two concurrent one-sided date PATCHes can each validate against the
   stale counterpart and both commit. A DB `CHECK` (migration 0002) now makes
   the inverted result impossible — at the cost of a 500 on the losing write,
   since Phase 1 declined SQLSTATE translation. The general guard is still this
   decision. It is an API contract change that every client (Slack bot, agents)
   must then honor, so it cannot be decided inside a UI phase.
2. **Zod message surfacing across all 7 mutating routes.** Every parse failure
   currently collapses to one generic 400. Fixing it means deciding how much of
   the field path and constraint prose to expose to clients; T10's
   unique-violation SQLSTATE translation belongs in the same decision.
3. **`onDone` is not scoped to its issue id** in the Inbox grooming panel — a
   stale PATCH completion can close a different row's open panel. Needs its own
   gated task; Task 6 already spent five rounds in this state machine.
4. **Playwright-era visual items**: the `dragleave` indicator leak (CDP cannot
   fire HTML5 drag events, so no Phase 2 gate could ever have closed this), the
   terminal-state `.row-expand` border, and a `Rail` admin-gating render test.
5. Carried from Phase 1 and still open: login rate limiting, request body size
   limits, IT Portal auth, and `SESSION_SECRET` validated at boot rather than
   per-request.

### Known properties, deliberately accepted

- **Displayed times are pinned to KST**, not the viewer's local zone — a shared
  "when did this happen" only works if everyone reads one clock. Milestone `startsOn`/
  `endsOn` are *date labels*, not instants: stored at UTC midnight and read as
  typed (`wireDate`). A KST conversion would agree, but only because KST is east
  of UTC; a local one is genuinely wrong west of it. See the README.
- **A catalog fetch failure annotates, it does not block.** The page's own data
  still renders with a retry banner; only page-primary data blocks. Established
  in Task 6 and inherited by every later view.
- **`useApi` has no shared cache**, so a page and a topbar-slot component
  calling the same hook fetch twice and hold independent error state. Tolerated
  at this size; revisit if a view multiplies instances further.
- **`issues/[id]/page.tsx` is 729 lines**, over the 200-400 target and under the
  800 cap. `MetaPanel`/`RelationsPanel`/`RelationAddButton` are the named split
  candidates when attachments land.

---

## Phase 3 outcome (2026-08-03)

Delivered on `feat/rudder-phase3-launch`: 17 tasks, migrations 0003–0006, 560 tests,
`tsc` clean, and — for the first time — a coverage gate that measures what it claims.
Two tasks (16, 17) were added mid-execution by PO decision after reviews surfaced
questions the plan had not answered. Task 15 lives in the `<slack-bot-repo>` repository
(PR #34) and is not part of this branch.

**Launch itself has not happened.** The runbook is written and committed
(`2026-08-03-rudder-launch-runbook.md`) but no GCP resource has been created; it waits
on PO approval and on three prerequisites named in it.

### The plan changed on contact with facts, twice

The overview table said Cloud Run. Checking the actual infrastructure killed it: the
existing `<existing-dashboard-vm>` VM is in **europe-west1** while Cloud SQL `<cloud-sql-instance>` is in
**asia-northeast3**, so hosting there would cross continents on every query — a
drag-reorder is five-plus sequential round trips. Rudder gets its own e2-small in the
database's region instead, behind Tailscale with no public ingress at all. That last
property is what let login rate limiting stay out of scope honestly rather than by
omission.

The coverage gate turned out to be measuring something other than what it declared:
`vitest.config.ts` asked for `src/ui/*.ts`, but v8 reports every file a test *loads*,
so `.tsx` components were measured without being declared — and the 80% threshold
applied to the combined total, so a healthy `domain` (96%) masked a `ui` slice at 61%
for the project's entire life. Task 8's extraction moved existing untested components
from an unmeasured file into measured ones, which is what finally made it visible.

### What the two gates actually caught

Every task passed a Claude review and an adversarial review. The pairing earned its
cost — neither reviewer alone would have been enough, and several findings came from
running code rather than reading it:

- **`register()` never stopped the server in production.** Boot validation worked under
  `next dev` and did nothing under `next start`, which is what the container runs. A
  reviewer traced Next 16.2.12's source — `NextServer.prepare()` only awaits the real
  `prepare()` when `dev` is true — then proved it live: a throwing `register()` prints
  "✓ Ready" and serves 500s forever. **Next's published docs say the opposite.** The
  same class of gap that cost Phase 1 a week, and only source-reading plus a real
  process found it.
- **The request-body cap did not cap.** `readJson` rejected early only when
  `content-length` was present and oversized; everything else drained the whole stream
  before checking. Two reviewers proved it independently with different adversarial
  streams. It was reachable pre-authentication on the login route.
- **A CAS guard that no test had ever exercised.** Every test tripped the friendly
  early check first, so the atomic `WHERE version = ?` predicate was never reached. A
  reviewer fired the real UPDATE from two connections forced to overlap with
  `pg_sleep`, confirmed both backends active simultaneously, and got exactly one winner.
- **Nothing gated a deploy on tests passing** — the pipeline had no test job at all.
- **A re-sync fix whose trigger was mount-local**, so it did not survive the remount it
  was written to fix. The reviewers disagreed on this one; the finder was right.

### The controller's own errors, recorded because they are the reusable part

Three briefs stated a contract that the code contradicted — attachment placement against
the design mockup, agent upload permission (I claimed parity with the comments route,
which does the opposite), and a `.row-expand` assertion for a row state the UI never
renders. **All three were caught by the implementer or reviewer reading the source
instead of trusting the brief.** That is the same failure Phase 2 named, and it recurred
under parallelism because briefs were written faster.

Two review packages were generated across a **divergence** rather than a merge base: a
lane that had merged the integration branch mid-flight showed a sibling task's work as
deletions, and a reviewer correctly refused to merge. A merge is not a diff. The rule
now is to run `git merge-base` and use its output as the package base — the second
occurrence was caught before dispatch by doing exactly that.

I also twice declared a reviewer's verdict file missing when my check had simply raced
its write, and passed on a Minor about CI duplication without checking its premise —
`master` turned out to be unprotected, so removing the trigger left direct pushes
ungated.

### Obligations carried forward

1. **Per-file coverage thresholds.** `issue-card.tsx`, `milestone-dialog.tsx` and
   `new-issue.tsx` sit under 80% individually behind a passing `ui` slice, and
   `session.ts` (~62% statements — the documented child-process gap, see Phase 1's
   "known properties") and `object-store.ts` (~77% statements — its real GCS branch has
   never executed anywhere, see the launch runbook step 7) sit under 80% behind a passing
   `lib` slice — the same masking shape one level down that Task 17 just fixed at the
   slice level.
2. **The IT Portal fallback's off-boarded-user half is closed; the rest is a standing
   exception, not yet a permanent one.** The portal's disabled-account 401 turned out to
   carry a distinct message from its wrong-password/unknown-user 401 (confirmed against
   the portal's own source); `fix/portal-disabled-account` (2026-08-03) made
   `verifyCredentials` return `null` for a portal-confirmed disabled account without
   ever trying the local hash — an off-boarded or for-cause-disabled user can no longer
   fall back to their seeded Phase-1 password. Portal 401 still covers "wrong password"
   and "unknown-to-portal id" identically, so that pair still falls back to the local
   hash; removing the fallback for those two needs full portal coverage of Rudder's ~10
   users confirmed plus a live round trip (see the corrected exit condition in
   `2026-08-03-it-portal-auth-finding.md`). Portal login is also rate-limited 5/min per
   source IP, shared by everyone behind Rudder's single VM.
3. **The Slack bot's product guess** now matches product names against message text and
   labels the result high-confidence — but the matcher is a plain substring test with no
   word boundaries and first-match-wins ordering, and only clean-match and no-match are
   tested. A confident wrong guess is worse than the honest low-confidence label it
   replaced. Fix before the surface goes live.
4. **`PLACEHOLDER_SECRET` is duplicated** into `scripts/docker-entrypoint.sh`, since
   shell cannot reach the TypeScript module graph. Nothing catches drift; the impact is
   bounded because the health route's check stays correct independently.
5. **The E2E attachment step is `test.fixme`** — written against a lane that predated
   Task 8's UI. The selectors are now correct; enabling it needs a run on the merged tree.

### Known properties, deliberately accepted

- **No login rate limiting.** The service has no public ingress; the threat cannot reach
  it. This is a consequence of the Tailscale decision, not an oversight — revisit if
  exposure ever changes.
- **No notification outbox.** A Slack outage drops those notifications rather than
  queueing them. An outbox is real operational surface for ~10 users.
- **No attachment deletion, and no deletion anywhere.** Several existence pre-checks are
  race-free only because nothing deletes products, users, milestones, or issues.
- **Sessions remain stateless sealed cookies** with no server-side revocation, unchanged
  from Phase 1.
- **Agent tokens ARE revocable** (since migration 0010). `api_tokens.revoked_at` plus a
  check in `actorFromRequest`, driven by `npm run revoke-token <name>`. It is a flag
  rather than a delete because `comments`/`issue_events`/`attachments` reference
  `api_tokens` `ON DELETE restrict`, so a token pins its row the moment its agent writes
  anything. There is still no `expiresAt`. So of the two credential kinds, only the
  human session cookie above is unrevocable — this entry used to say both were.
- **`ci.yml` deliberately duplicates `deploy.yml`'s test job** on pushes to `master`.
  The two protect different moments, `deploy.yml`'s paths filter will always have gaps
  relative to "run the tests", and `master` is not branch-protected. Enabling branch
  protection would close this structurally and is the recommended follow-up.

### Parked at the final review (not blocking, with rulings)

- **Two `issueExists` helpers** — one exported from `respond.ts`, one module-local in
  `domain/attachments.ts`, because the domain one must accept a transaction handle.
  Deliberate, and the third instance of the "same logic mirrored twice" pattern this
  codebase now carries (`STATUS_LABEL` in `slack.ts` mirrors `src/ui/labels.ts`;
  `NEXT_ACTIONS` in `meta-panel.tsx` mirrors `domain/transitions.ts`). Each mirror is
  individually justified by the architecture's import rules; three of them is a pattern,
  and the honest fix is one shared module, not a fourth comment.
- **The seed CSV's 4-vs-5 column behaviour has no regression test.** The code is correct
  by trace — a 4-column line leaves `slack_user_id` alone, a 5-column line with an empty
  field still clears it — but nothing would catch a future `parseLine` change.
- **The E2E attachment scenario's pass is reported, not independently re-verified.** It
  was un-`fixme`d and run once green by the agent that enabled it; the re-reviewer did
  not re-run Playwright.
- **Correction, not a parked item:** the first real deploy run failed, not at the parked
  VM steps (expected, no VM yet) but at Build & Push Image — root-level
  `playwright.config.ts` imports `./tests/e2e/helpers`, `tsconfig.json`'s `**/*.ts`
  include pulls it into `next build`'s type check, and `.dockerignore` had already
  excluded `tests/` while leaving the root config file in. `npm run build`, `npm test`,
  and CI's unit job all passed anyway, because none of them build inside the real
  Docker context. A real `docker build .` is the only gate that catches root-level
  config reaching into a `.dockerignore`d path; fixed by adding `playwright.config.ts`
  to `.dockerignore` alongside `tests`.
