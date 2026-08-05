# Rudder Phase 3 — Integrations & Launch: Design

Date: 2026-08-03
Status: Approved (PO interview 2026-08-03)
Owner: Hansol Kim (Product Owner)
Parent: `2026-07-30-issue-tracker-design.md` (PRD), `docs/superpowers/plans/2026-07-30-rudder-overview.md` (phase overview)

Phase 3 delivers the overview-table scope — attachments (GCS), Slack
notifications, <slack-bot-repo> intake, Playwright E2E, production deploy —
plus every obligation carried from Phases 1–2. This spec records the
decisions; the plan (`docs/superpowers/plans/2026-08-03-rudder-phase3-launch.md`)
sequences them into tasks.

## 1. Deployment topology (PO decision 2026-08-03)

**Rudder runs as a container on a new dedicated e2-small VM in
`asia-northeast3-a`, fronted by Tailscale.** Not Cloud Run — the PO's
Tailscale constraint flipped the overview table's assumption: a
tailnet-reachable Cloud Run service needs a tailscaled sidecar with
min-instances=1, which cancels scale-to-zero and imports ephemeral-node
mechanics as the most novel component of the phase. And not the existing
`<internal-dashboard>` VM either, which was the first candidate until the
fact check killed it (below).

Verified facts (2026-08-03, gcloud + `tailscale status`):

- `<internal-dashboard>` VM is in **europe-west1-c** (e2-medium, 10GB disk
  already under cleanup pressure). Cloud SQL `<cloud-sql-instance>` is in
  **asia-northeast3** (POSTGRES_15, REGIONAL, db-custom-2-4096; existing
  databases: `postgres`, `tyche_db`). Hosting Rudder on the dashboard VM
  would cross continents twice per interaction — Seoul user → Belgium VM
  (~250ms) → Seoul DB (~230ms per query round trip); a drag-reorder
  transaction is 5+ sequential round trips ≈ over a second per drag.
  Rejected. **PO decision: a new dedicated VM in the DB's region**
  (~$13/mo) over squeezing into `<internal-bot-vm>` (e2-small, 2GB, shared
  with the Hermes Gateway) or `<internal-app-vm>` (portal-team-owned, purpose
  unverified).
- `<internal-bot-vm>` VM (asia-northeast3-a) is a tailnet node and online —
  this is where the Slack bot's tool-executing runtime lives (see §5).
- The dashboard's `.github/workflows/deploy.yml` is a complete reusable
  template: GHCR digest-pinned image → Tailscale GitHub Action (`tag:ci`)
  → SSH over tailnet → `docker compose up` → health check → tagged
  rollback image on failure. It clones to the new VM unchanged in shape.
- The new VM (working name `tyche-rudder`) joins the tailnet as its own
  node: a clean `https://tyche-rudder.<tailnet>.ts.net` via
  `tailscale serve`, and same-region DB access (~1ms). Boot disk ≥20GB —
  the dashboard's 10GB disk is a lesson, not a template.

Consequences:

- **No public ingress at all.** Humans reach Rudder over the tailnet via
  `tailscale serve` (ts.net TLS terminates HTTPS → `Secure` cookies work).
  The bot reaches the API over the tailnet from `<internal-bot-vm>`. Nothing
  listens on a public interface.
- **Login rate limiting is dropped from the launch scope** (carried from
  Phase 1). The threat it defends against — internet-side credential
  stuffing — cannot reach the service. Recorded as an accepted property;
  revisit if exposure ever changes.
- Request body limits stay, cheaply: a shared `readJson(req, 1MB)` helper
  for JSON routes; the attachment route enforces its own 10MB cap.

GCP project is `<gcp-project-id>` (verified). Bucket precedent:
`tyche-*` names in `ASIA-NORTHEAST3` already exist (e.g.
`<existing-bucket-name>`), so the attachments bucket follows that
convention. `<internal-artifact-bucket>` also exists — a concrete lead
for the §6 portal investigation.

## 2. API contract changes (one decision, all clients)

### 2.1 Client-round-trip optimistic locking: required `expectedVersion`

Body field, not `If-Match` header — it flows through the existing zod
validation and the `api()` wrapper without new header plumbing.
**Required**, not optional: all clients are ours and the product is
pre-launch, so an opt-in guard would just preserve today's
last-write-wins.

| Route | `expectedVersion` means |
|-------|------------------------|
| `PATCH /api/v1/issues/:id` | version of the issue being patched |
| `POST /api/v1/issues/:id/transition` | version of the issue being transitioned |
| `POST /api/v1/issues/:id/reorder` | version of the dragged issue |
| `PATCH /api/v1/milestones/:id` | version of the milestone being patched |

- `milestones` gains `version integer NOT NULL DEFAULT 1`.
  `updateMilestone` is rewritten to the same CAS shape as `updateIssue`
  (conditional `UPDATE … WHERE version = expected`), which also closes the
  read-validate-write race on merged date ranges. Migration 0002's CHECK
  stays as the last line of defence.
- Version mismatch → existing conflict path: 409 + `CONFLICT_ERROR`
  (`domain/result.ts` kind `conflict`). The UI already renders this class
  of failure (refresh prompt); it now also sends the `version` it rendered.
- `comments` and `relations` are append-only — no version field, out of
  scope for this contract.
- Agent/bot contract: GET the resource, send back the `version` you read.
  Documented in the intake brief (§5).

### 2.2 Zod message surfacing: optional `issues` array in the envelope

Parse failures on all 7 mutating routes change from one opaque 400 to:

```json
{ "ok": false, "error": "입력값이 올바르지 않습니다",
  "issues": [{ "path": "endsOn", "message": "시작일은 종료일보다 늦을 수 없습니다" }] }
```

- One shared `failParse(zodError)` helper; the `issues` field is additive,
  so existing clients that only read `error` are untouched.
- Korean constraint prose comes from zod 4's locale support
  (`z.locales.ko()`) — verify the exact API against current zod docs at
  implementation time, not from memory.
- The LLM intake path (§5) is the forcing function: a machine client that
  composes payloads needs field paths to retry correctly.
- **Unique-violation translation (SQLSTATE 23505)** joins the same
  decision: the rename pre-checks on products/milestones have a benign
  race window whose loser currently surfaces as a raw 500. A shared
  translator maps driver error code `23505` to the existing 422 rule
  message ("이미 존재하는…"). PGlite cannot reproduce driver SQLSTATE
  shapes, so this lands with a real-Postgres verification gate.

### 2.3 `starts_on` / `ends_on` become `date` columns (migration 0003)

`date(..., { mode: 'string' })` in drizzle: the wire carries
`"2026-07-25"` as-is.

- Deletes `wireDate()` / `wireDateFull()` and the UTC-midnight convention
  they defended. The date-label invariant moves from "one zod line plus
  discipline" into the schema itself.
- `z.iso.date()` stays but drops its `.transform(s => new Date(s))` —
  strings pass through.
- Domain types for these fields change `Date | null` → `string | null`.
- Migration must preserve 0002's range CHECK on the new column type
  (`USING starts_on::date`).
- `timeline.ts` quarter-key math simplifies to string parsing. KST
  *instant* display (`formatDateTime`, `kstDayMillis`) is untouched, and
  the TZ-pinned tests (`America/Los_Angeles`) stay — instants still exist.

## 3. Attachments (GCS, server-proxied)

- **Schema**: `attachments` — `id, issue_id FK, filename, content_type,
  size_bytes, gcs_object, actor_type/actor_user_id/actor_token_id` (the
  existing XOR CHECK pattern), `created_at`. Upload records
  `recordEvent('attachment', null, filename)` — actor-attributed history
  per PRD §10.
- **API**: `POST /api/v1/issues/:id/attachments` (multipart; 10MB cap;
  content-type allowlist png/jpeg/gif/webp/pdf/txt) and
  `GET /api/v1/attachments/:id` (authenticated server-proxied stream).
  Server-proxied both directions: the bucket stays fully private, no
  CORS, no signed-URL state machine. VM bandwidth is a non-issue at
  ~10 users of screenshots.
- **No delete endpoint.** YAGNI, and it preserves the "nothing deletes
  products/users/milestones/issues" premise the existence pre-checks
  rely on. Accepted property.
- **Infra**: one new private bucket in `asia-northeast3` (uniform access);
  VM service account gets objectAdmin on it. New dependency:
  `@google-cloud/storage`.
- **UI**: upload button + attachment list on the issue detail page, per
  the design system. This is the moment Phase 2 reserved for splitting
  the 729-line `issues/[id]/page.tsx` (`MetaPanel`, `RelationsPanel` are
  the named candidates) — the split ships with the attachment UI.

## 4. Slack notifications (`src/lib/slack.ts`)

- New issue → channel `<slack-channel-id>`. Status change → requester DM.
- `users.slack_user_id` (nullable) is the mapping; seed CSV gains an
  optional 5th column. No mapping → no DM, silently.
- Direct Slack Web API `chat.postMessage` with `SLACK_BOT_TOKEN` (reuses
  the existing bot token; scope `chat:write`). Outbound-only, so the
  tailnet topology doesn't constrain it.
- **Fire-and-forget after the mutation commits**: a notification failure
  logs and never fails the API response — the Phase 2 "annotate, don't
  block" precedent. No outbox table (over-engineering at this size;
  accepted property: a Slack outage drops those notifications).
- Called at the route level, which covers every client (web, bot, agents)
  because they all go through the same API.

## 5. Bot intake (<slack-bot-repo> repo, Hermes architecture)

**Topology fact (2026-08-03, supersedes the kickoff's description):** the
bot was migrated to Hermes in late July. Slack events hit a thin Cloud
Function (signature check) → Pub/Sub → **Hermes Gateway on the
`<internal-bot-vm>` VM**, where tools execute. That VM is on the tailnet, so
Rudder API calls from the bot are tailnet-internal — no public exposure,
no VPC plumbing. The canonical working copy is
`~/Documents/GitHub/<slack-bot-repo>`; it is currently behind origin/main
(804f5f1 < 96477e1), so **pull + read the current Hermes structure is the
first intake task**.

- **Surfaces (PO decision)**: message shortcut ("이슈로 등록" on any
  message) and natural-language mention/DM. No slash command.
- **Both surfaces pass a draft-confirm gate** (PRD §10, suggestion ≠
  action): the bot presents title/product/type extracted from the message
  or conversation; only an explicit user confirm calls create. This gate
  absorbs the LLM misfiling risk that made NL intake the riskiest surface.
- **Tools**: `rudder_create_issue` (+ `rudder_list_products` for the
  draft) in the <google-workspace-domain> plugin, authenticated with a `Bearer
  rud_*` token (`npm run create-token`).
- **Requester attribution**: agents must send `requesterPortalId`
  (Phase 1 contract). The bot resolves Slack user → portal id via
  `GET /api/v1/users`, whose response now includes `slackUserId`.
  Unmapped users get a guidance message instead of a misattributed issue.
- The intake brief quotes the *actual route contracts read from code*
  (envelope shape, `expectedVersion`, error kinds) — Phase 2's
  "a brief that guesses the contract becomes a defect" lesson, four times
  over.
- Message shortcut requires a Slack app manifest change (new callback),
  flowing through the same CF → Pub/Sub → Hermes path.

## 6. Auth: IT Portal integration (investigate; local fallback ships)

PO wants portal integration in Phase 3, but the portal's verification
mechanism is unknown (Phase 1's investigation ended at "ask Hansol";
answer 2026-08-03: 조사 필요). Design:

- A timeboxed investigation task (half a day) determines what the portal
  exposes (login API / queryable credential store / neither).
- If a clean path exists, swap the body of `verifyCredentials`
  (`src/lib/auth.ts`) — the signature and every caller stay put.
- If not resolved within the timebox, **launch ships with locally-seeded
  bcrypt passwords** (current behavior) and the swap remains a one-
  function follow-up. Launch does not block on the portal.

## 7. Security closeouts

- **Dependency alerts (measured 2026-08-03, supersedes the kickoff
  numbers)**: 5 open dependabot alerts = 3 high (postcss ≤8.5.17 ×2,
  sharp <0.35.0 ×1) + 2 moderate (postcss XSS, esbuild dev-server).
  `next@16.2.12` is the **latest** release and pins `postcss@8.4.31`
  exactly / `sharp@^0.34.5`, so "upgrade Next" is not currently a path.
  Fix: `package.json` `overrides` — `postcss ^8.5.18`, `sharp ^0.35.0`,
  and `esbuild ^0.25.0` under `@esbuild-kit/core-utils` (drizzle-kit's
  loader; dev-only exposure). Verification gate: `npm audit` shows 0
  high, `next build` clean, full suite green, `drizzle-kit generate`
  still works. `npm audit fix --force` is forbidden (downgrades to
  next@9.3.3). Exposure note: the app never uses `next/image` (pixel-art
  SVGs are inline), so sharp is build-side only — the overrides are
  hygiene, not an active-exploit fix.
- **`SESSION_SECRET` validated at boot** via `instrumentation.ts`
  `register()`: a misconfigured deploy fails to start instead of 500ing
  at first auth (closes the Phase 1 carry-over; README's "no boot
  validation yet" paragraph gets updated).
- **Request body size**: shared `readJson(req, limit)` helper, 1MB for
  JSON routes, attachment route has its own 10MB multipart cap.
- **Inbox grooming `onDone` scoping**: `onDone` is not scoped to its
  issue id, so a stale PATCH completion can close a different row's open
  panel. Fixed as its own task with its own gates — Task 6 spent five
  rounds in this state machine and it earns standalone review scrutiny.

## 8. Playwright E2E

- Runs against a production `next build` + real Postgres (docker), not
  PGlite — this suite exists precisely because green PGlite proves too
  little.
- **First-class scenarios are the three items Phase 2 could not close**:
  1. `dragleave` indicator leak (CDP cannot fire HTML5 drag events;
     Playwright can),
  2. terminal-state `.row-expand` bottom border,
  3. `Rail` admin-gating render.
- Plus a lean core-journey smoke: login → create issue → 통관(groom) →
  backlog drag-reorder → milestone assign → attachment upload → status
  change fires a notification (asserted against a mock Slack endpoint).
- CI: GitHub Actions PR gate — build + unit suite + E2E. E2E stays small;
  anything a unit test can catch stays a unit test.

## 9. Deploy pipeline

Clone of the dashboard's proven `deploy.yml` shape:

1. Test job → build job pushes GHCR image, outputs **digest** (immutable).
2. Deploy job joins the tailnet (Tailscale GitHub Action, `tag:ci`),
   SSHes to the VM, pulls by digest, tags previous image `:rollback`.
3. `drizzle-kit migrate` runs against the `rudder` database **before**
   the container swap.
4. `docker compose up -d`, health check `/api/health` (already exists),
   automatic rollback to the tagged image on failure. Rollback is built
   into the pipeline, not a runbook step.

- Container binds `127.0.0.1:3000` on the new VM; `tailscale serve`
  exposes it with ts.net TLS.
- DB: new `rudder` database on Cloud SQL `<cloud-sql-instance>` (zero new
  *database* instances; POSTGRES_15 — local docker and the E2E database
  pin `postgres:15` to match, replacing the current `postgres:16-alpine`);
  the compose stack gets a **cloud-sql-proxy sidecar** with a
  read-only-mounted SA key — the dashboard's credentials pattern.
- One-time manual steps at launch: create the VM (e2-small,
  asia-northeast3-a, ≥20GB disk; rollback = delete the instance) and
  join it to the tailnet, create the `rudder` database, create the
  bucket, seed `users.csv`, mint the bot's `rud_*` token, configure
  `tailscale serve`.

## 10. Testing strategy (applies to every task)

- Regression tests are mutation-verified: run against the pre-fix code
  and watch them fail before trusting them.
- Anything touching transactions, timestamps, concurrency, or driver
  error shapes gets a real-Postgres verification before "done" — the
  23505 translator and both migrations explicitly so.
- Two independent gates per task (Claude review + Codex adversarial
  review); reviewers write verdicts to files; no self-review of
  self-implemented code.
- Parallel work uses in-repo `.worktrees/` with relative symlinks;
  worktree-era suites run `npx vitest run --dir tests`.

## 11. Non-goals & accepted properties

- No login rate limiting (tailnet-only exposure; revisit on any exposure
  change).
- One new e2-small VM (~$13/mo) is the single piece of new infrastructure
  — accepted over cross-continent latency (dashboard VM) and co-tenancy
  risk (hermes/apps VMs). The database and bucket reuse existing
  infrastructure patterns.
- No attachment delete endpoint; no outbox for notifications; no
  user-management UI (unchanged from overview).
- Sessions remain stateless sealed cookies (Phase 1 accepted property,
  unchanged).
- No slash-command intake surface (PO chose shortcut + NL).
- AI decision-support features (PRD §10) still out of scope; the intake
  confirm-gate is the §10-compliant pattern they will later reuse.

## Next step

`superpowers:writing-plans` →
`docs/superpowers/plans/2026-08-03-rudder-phase3-launch.md`, after
(1) PO review of this spec and (2) the pending gcloud fact checks in §1
land in the plan as numbers, not assumptions.
