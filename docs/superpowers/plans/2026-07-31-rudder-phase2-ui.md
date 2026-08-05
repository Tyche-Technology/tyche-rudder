# Rudder Phase 2 — Web UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the five core views (Inbox, Board, Roadmap, My Requests, Issue detail) plus login and product/milestone management on the Phase 1 REST API, after clearing the API obligations the UI depends on (error kinds, catalog attribution, `GET /users`, `PATCH /products`).

**Architecture:** The web UI is a *client* of `/api/v1/*` (spec architecture A) — UI code never imports `src/db` or `src/domain`; all data flows through `fetch` against the same endpoints the Slack bot uses. Views are client components with a small shared fetch helper; the design system is `design/rudder.css` imported as the app stylesheet, with markup lifted from the approved mockups in `design/*.html`.

**Tech Stack:** Next.js 16 App Router (existing), TypeScript, `design/rudder.css` (no CSS framework), `next/font` + `pretendard` npm package (only new dependency), native HTML5 drag-and-drop + keyboard reorder (no dnd library), native `<dialog>` for modals, Vitest + PGlite for API/logic tests.

**Code-in-plan policy (from the Phase 1 retro, final-review Recommendation 3):**
this plan specifies **contracts, invariants, exact names/signatures, and test
specs** — full code blocks appear only where the contract *is* the code
(types, schema, migrations, pure-function specs). Implementers write the
bodies; reviewers hold them to the named invariants. "TBD/add validation
later" style placeholders remain forbidden — every behavior is named here.

## Global Constraints

- **UI language Korean**; status labels always pair nautical + standard: 입항 대기(Inbox) · 선적 대기(Backlog) · 항해 중(In Progress) · 배송 완료(Done) · 반송(Rejected) · 정박(On Hold); grooming = 통관. 로드맵/마일스톤 keep standard names. Priorities plain P0/P1/P2. (spec §7)
- **Code-level enums stay English**: `inbox/backlog/in_progress/done/rejected/on_hold`, `p0/p1/p2`, `bug/feature/improvement`. (spec §7)
- **Architecture A**: UI files (`src/app/(app)/**`, `src/app/login/**`, `src/ui/**`) import nothing from `src/db` or `src/domain`. Types come from `src/ui/types.ts`. The ONLY exception is none — even auth goes through `/api/v1/auth/*`.
- **Design tokens only**: no hex colors, font names, or px sizes hard-coded in
  components — everything via the custom properties in `rudder.css`.
  `node design/contrast-check.mjs` must stay exit 0.
- **The two stylesheets must stay in sync** (clarified 2026-07-31, after T6
  legitimately needed styles the design system lacked). `design/rudder.css`
  is the source of truth and `src/app/globals.css` is its copy, differing by
  exactly two documented items: the removed `@import` font lines and the
  `--font-display`/`--font-mono` rewires to the `next/font` variables.
  A task may **add** a component style the system genuinely lacks (T6 added
  `.row-expand` and native `dialog` styling), but it must land **identically
  in both files** in the same commit. What is forbidden is drift and
  redesign: never change an existing token's value, never restyle an
  existing component, and never let the two files diverge beyond those two
  documented items. `diff <(sed '11,12d' design/rudder.css) src/app/globals.css`
  should show only the font block and its explanatory comment.
- **Accessibility floor** (design doc §7): color never the only signal; `:focus-visible` intact; drag ordering must have the ⌥↑/⌥↓ keyboard path; `prefers-reduced-motion` respected (already in stylesheet).
- **`issue_events.field` is frozen snake_case** — UI maps values to Korean via the design doc §8 table; never writes new field vocabulary.
- **Out of scope (Phase 3)**: attachments (detail view renders NO attachment section — the API has none), Slack notifications, login rate limiting, Playwright E2E, deploy. Agent comments stay 403.
- **HTTP statuses are frozen**: existing tests pin 400/401/403/404/409/422 per route; Tasks 1–3 must not change any status. **Three sanctioned exceptions, all in T2**, recorded here because the plan originally contradicted itself and a reviewer should not re-litigate them: (1) `/auth/me`'s response body becomes the standard envelope; (2) the *misconfiguration* path (missing/short `SESSION_SECRET`) goes from a swallowed 401 to a logged 500 across authenticated routes — a swallowed server fault is not a login state; (3) `/auth/me` with a valid Bearer token goes 401 → 403 (PO ruling, 2026-07-31). On (3): the old 401 was a side effect of `/auth/me` never inspecting the Authorization header, not a design decision. An agent has authenticated; it simply is not entitled to a user profile, so 403 is the true statement and 401 ("log in") is a lie told to a bot. A **cookie** fault must still be 401, never 500 — see T2's fix round 2.
- **Tests**: Vitest + PGlite for API and pure logic; TDD. Coverage gate ≥80% extends to `src/ui/*.ts` pure modules (not `.tsx` components — those are verified against the design mockups by the reviewer on a running dev server, and by Playwright in Phase 3).
- New npm dependencies allowed: `pretendard`, plus `jsdom` and
  `@testing-library/react` as **devDependencies** (amended 2026-07-31). The
  original one-dependency rule blocked unit-testing React hooks, and an
  adversarial pass then found a real stuck-loading bug in `useApi` — the
  exact function the constraint had made untestable. Six later tasks build
  hooks on that seam, so the rule was buying dependency hygiene at the cost
  of correctness. No further runtime dependencies.

**Reference documents** (implementers: read the section named in your task):
- Design system spec: `docs/superpowers/design/2026-07-30-rudder-design-system.md` (binding; §8 copy deck, §9 API gaps)
- Mockups: `design/index.html` (style guide), `design/01-inbox.html` … `design/05-issue.html` — lift markup structure and class names from these.
- Phase 1 review: `docs/superpowers/reviews/2026-07-30-rudder-phase1-final-review.md`

---

### Task 1: Discriminated domain error kinds (final review I6/D2)

Replace prose-matched error→status routing with a `kind` discriminant, so
Korean copy stops being an API contract. **No HTTP status may change.**

**Files:**
- Create: `src/domain/result.ts`
- Modify: `src/domain/issues.ts`, `src/domain/transitions.ts`, `src/domain/ordering.ts`, `src/domain/collab.ts`, `src/domain/catalog.ts` (every `{ ok: false, error }` return)
- Modify: `src/app/api/v1/respond.ts` (delete `domainErrorStatus`, add `failDomain`), every route currently calling `domainErrorStatus` (grep for it)
- Test: `tests/domain/result.test.ts`; existing tests must pass unchanged except assertions that referenced `domainErrorStatus` directly

**Interfaces (Produces):**

```ts
// src/domain/result.ts
export type ErrorKind = 'not_found' | 'conflict' | 'rule'
export type DomainError = { ok: false; kind: ErrorKind; error: string }
export const notFound = (error: string): DomainError => ({ ok: false, kind: 'not_found', error })
export const conflict = (error: string): DomainError => ({ ok: false, kind: 'conflict', error })
export const ruleViolation = (error: string): DomainError => ({ ok: false, kind: 'rule', error })

// src/app/api/v1/respond.ts
export const KIND_STATUS: Record<ErrorKind, number> = { not_found: 404, conflict: 409, rule: 422 }
export const failDomain = (e: DomainError) => fail(e.error, KIND_STATUS[e.kind])
```

Every domain function that returned `{ ok: false; error: string }` now returns
`DomainError` built via the three constructors: `이슈를 찾을 수 없습니다`-class
messages → `notFound(...)`, `CONFLICT_ERROR` → `conflict(CONFLICT_ERROR)`,
everything else → `ruleViolation(...)`. `TransitionCheck`'s failure arm becomes
`DomainError` too. `CONFLICT_ERROR` string stays exported from
`src/domain/issues.ts` (tests reference it).

**Invariants:** (a) route layer contains zero string-matching on error
messages afterward — `grep -rn "찾을 수 없습니다" src/app` returns only
literal `fail('…', 404)` calls for invalid-id paths, no `.includes`; (b) the
`404 via message-substring` comment block in respond.ts is deleted with the
function; (c) suite still green with identical pinned statuses.

- [ ] **Step 1**: Write `tests/domain/result.test.ts`: each constructor produces the right kind; `KIND_STATUS` maps not_found→404, conflict→409, rule→422. Run — fails (module missing).
- [ ] **Step 2**: Create `result.ts` + respond changes; migrate `transitions.ts` and `issues.ts`; run suite, fix compile errors in dependents until green.
- [ ] **Step 3**: Migrate `ordering.ts`, `collab.ts`, `catalog.ts` and all routes off `domainErrorStatus`; delete it. Run full suite + `npx tsc --noEmit`.
- [ ] **Step 4**: Run the Step-1 invariant greps; paste output in the task report.
- [ ] **Step 5**: Commit `refactor: route domain errors by discriminated kind, not message prose`.

---

### Task 2: API seam consolidation + deferred test gaps (I7, M4, M5, overview obligation 3)

One idiom per concept before the UI multiplies call sites.

**Files:**
- Modify: `src/app/api/v1/respond.ts` (add `requireAdmin`), `src/app/api/v1/issues/[id]/relations/route.ts` (use shared one), `transition/route.ts`, `reorder/route.ts`, `products/route.ts`, `milestones/route.ts`, `milestones/[id]/route.ts` (replace inlined guards)
- Modify: `src/app/api/v1/auth/me/route.ts` (identity via `actorFromRequest`), `auth/login/route.ts`, `auth/logout/route.ts`, `src/app/api/health/route.ts` (adopt `ok`/`fail`/`unauthorized`; health also gets `withErrorEnvelope`)
- Test: `tests/api/auth-routes.test.ts` (new), additions to `tests/api/issues.test.ts`, `tests/domain/collab.test.ts`

**Interfaces (Produces):**

```ts
// src/app/api/v1/respond.ts — the ONE admin guard; returns null when allowed
export function requireAdmin(actor: Actor): NextResponse | null
// (actor.type !== 'user' || actor.role !== 'admin') ? forbidden() : null
```

`/auth/me` behavior contract: resolve identity through `actorFromRequest`;
agent actor → `forbidden()`; user actor → fetch the user row once and return
`ok({ id, portalId, name, role })`. Any future rule added to
`actorFromRequest` now applies to `/auth/me` automatically (this was I7).
Response shape of all three auth routes and `/api/health` becomes the standard
envelope — **assert current bodies first; if login/logout envelopes already
match `{ ok: true, data }`, keep byte-identical output.**

**Deferred test gaps to close (overview obligation 3):**
- `tests/api/auth-routes.test.ts` (mocked-session variant, PGlite): login 200 with correct credentials + Set-Cookie; login 401 wrong password and unknown user (identical body — timing equalizer path); login 400 malformed body; me 200 shape `{ id, portalId, name, role }`; me 401 without session; me 403 with Bearer token; logout 200. (The real-server round-trip stays in `session-live.test.ts` — do not touch it.)
- `tests/domain/collab.test.ts`: exact-string assertions — self-relation rejects with `자기 자신과는 관계를 만들 수 없습니다`-class message (copy the actual string from collab.ts) and duplicate relation with its actual string; both `kind: 'rule'`.
- `tests/api/issues.test.ts`: `GET /issues?productId=X` and `?milestoneId=Y` return only matching rows; `?status=backlog` returns sortOrder-ascending order (seed three with sortOrder 3072/1024/2048, assert id order).

**Invariants:** `grep -rn "actor.type !== 'user' || actor.role !== 'admin'" src/app` hits only respond.ts; every route file imports its guard; suite green.

- [ ] **Step 1**: Write the new/extended tests above. Run — new ones fail.
- [ ] **Step 2**: Implement `requireAdmin` + replace the five inlined guards; rewrite `/auth/me`; convert auth routes + health to envelope helpers.
- [ ] **Step 3**: Full suite + tsc green; run the invariant grep.
- [ ] **Step 4**: Commit `refactor: one admin guard, one identity resolver, one response idiom + close deferred auth/filter test gaps`.

---

### Task 3: Catalog attribution schema + product management + user listing (I5, M9, §10.2; design §9-1/2/3)

The migration that makes "누가 로드맵을 바꿨는가" answerable, plus the two
endpoints the UI cannot exist without.

**Files:**
- Modify: `src/db/schema.ts` (products, milestones), generate `drizzle/0001_*.sql` via `npm run db:generate`
- Modify: `src/domain/actor.ts` (add `UserActor`), `src/domain/catalog.ts` (actor params + `updateProduct`), `src/lib/validation.ts` (`patchProductSchema`)
- Create: `src/app/api/v1/products/[id]/route.ts` (PATCH), `src/app/api/v1/users/route.ts` (GET)
- Modify: `src/app/api/v1/products/route.ts`, `milestones/route.ts`, `milestones/[id]/route.ts` (pass actor)
- Test: `tests/domain/catalog.test.ts` (extend), `tests/api/users.test.ts` (new), `tests/api/catalog-api.test.ts` (extend existing catalog API test file — locate by grep), `tests/helpers/db.ts` (seedProduct/seedMilestone signatures)

**Schema contract** (both `products` and `milestones` gain, exactly):

```ts
createdByUserId: integer('created_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
updatedByUserId: integer('updated_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
createdAt: timestamp('created_at').notNull().defaultNow(),
updatedAt: timestamp('updated_at').notNull().defaultNow(),
```

`createdByUserId` is **nullable, deliberately** (PO ruling 2026-07-31, after an
adversarial pass showed `NOT NULL` without a backfill makes 0001 unappliable to
any database that already ran 0000 and holds catalog rows — reproduced against
PGlite). `NULL` reads as *"created before attribution existed"*. That is the
truthful value for such rows; back-filling them to some admin would put a
fabrication into the audit trail and surface it in the roadmap UI as
"최종 수정 · <someone who never touched it>". Attribution for **new** rows is
enforced by the domain layer and pinned by tests, not by a column constraint.
This is **migration 0001, append-only**; do not regenerate 0000. Regenerating
0001 itself is fine — it has never been applied anywhere permanent.

**Interfaces (Produces):**

```ts
// src/domain/actor.ts
export type UserActor = Extract<Actor, { type: 'user' }>

// src/domain/catalog.ts — attribution rules: create sets createdByUserId
// (+ leaves updatedBy null); every successful update sets updatedByUserId
// + updatedAt. Return types unchanged otherwise; errors are DomainError.
export async function createProduct(db: Db, actor: UserActor, name: string): Promise<{ ok: true; product: Product } | DomainError>
export async function updateProduct(db: Db, actor: UserActor, id: number, patch: { name?: string; active?: boolean }): Promise<{ ok: true; product: Product } | DomainError>
export async function createMilestone(db: Db, actor: UserActor, input: { name: string; startsOn?: Date; endsOn?: Date }): Promise<{ ok: true; milestone: Milestone } | DomainError>
export async function updateMilestone(db: Db, actor: UserActor, id: number, patch: { name?: string; startsOn?: Date | null; endsOn?: Date | null; closed?: boolean }): Promise<{ ok: true; milestone: Milestone } | DomainError>

// src/lib/validation.ts
export const patchProductSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  active: z.boolean().optional(),
})
```

`updateProduct` mirrors `updateMilestone`'s shape: not-found pre-check
(`notFound('제품을 찾을 수 없습니다')`), empty-patch short-circuit, rename
uniqueness pre-check (`ruleViolation('이미 존재하는 제품입니다')` — note the
pre-check race caveat comment, same wording as updateMilestone's).

**`GET /api/v1/users`**: any authenticated actor (agents need it to discover
`requesterPortalId`). Explicit column select — `{ id, portalId, name, role }`
only, **never** `passwordHash`; ordered by `asc(users.name)`.

**`PATCH /api/v1/products/[id]`**: `requireAdmin`; envelope + `failDomain`.

**Test specs:** attribution columns set on create (createdBy = acting admin,
updatedBy null) and update (updatedBy set, updatedAt advanced — compare via
`version`-free fields; use two distinct seeded admins to prove *which* user);
agent Bearer on POST/PATCH product/milestone still 403; `GET /users` excludes
passwordHash (assert key absent on every row) and works with Bearer auth;
`PATCH /products/[id]` renames, toggles `active` both ways, 404 unknown id,
422 duplicate name, 400 empty-invalid body, 403 non-admin. Roadmap payload
assertion (design §9-4): `GET /roadmap` entries carry `milestone.startsOn`,
`milestone.endsOn`, `milestone.closed`, and `total` excluding a seeded
rejected issue — one test pinning the exact serialized shape the UI will
parse.
`tests/helpers/db.ts`: `seedProduct(db, createdByUserId: number, name?)` and
same for a `seedMilestone` helper if one exists (grep; add createdBy
threading); update every call site (mechanical — grep `seedProduct(`).

- [ ] **Step 1**: Schema + `npm run db:generate`; inspect generated 0001 SQL — must contain exactly 8 ALTER TABLE ADD COLUMN + 4 FK constraints, no drops.
- [ ] **Step 2**: Write failing domain tests (attribution, updateProduct behaviors), then implement catalog changes + UserActor.
- [ ] **Step 3**: Write failing API tests (users, product PATCH, roadmap shape), then implement routes + validation.
- [ ] **Step 4**: Update seed helpers + all call sites; full suite + tsc green.
- [ ] **Step 5**: Commit `feat: catalog actor attribution (migration 0001), PATCH /products, GET /users`.

---

### Task 4: UI foundation — stylesheet, fonts, theme, API client, login

**Files:**
- Modify: `src/app/globals.css` (replace content with `design/rudder.css` minus its two `@import url(...)` font lines — tokens/components identical otherwise; keep `design/rudder.css` untouched as the design source), `src/app/layout.tsx`, `package.json` (add `pretendard`)
- Delete: `src/app/page.module.css`; replace `src/app/page.tsx` with a redirect to `/inbox` (`import { redirect } from 'next/navigation'`)
- Create: `src/ui/types.ts`, `src/ui/api.ts`, `src/ui/labels.ts`, `src/app/login/page.tsx`
- Test: `tests/ui/labels.test.ts`, `tests/ui/api.test.ts`
- Modify: `scripts/coverage-gate.sh` (add `src/ui/*.ts` glob — `.ts` only, components excluded; keep the glob-matches-nothing guard working)

**Fonts** (`layout.tsx`): `next/font/google` — `Gothic_A1` weights 500/700/800 with `variable: '--font-display-src'`; `IBM_Plex_Mono` 400/500 with `variable: '--font-mono-src'`; Pretendard via `import 'pretendard/dist/web/variable/pretendardvariable.css'`. In globals.css the three `--font-*` tokens read: `--font-display: var(--font-display-src), 'Pretendard Variable', …` etc. No request to Google at runtime (next/font self-hosts) — design doc §10 requirement.

**Theme**: `<html lang="ko">` gets a `beforeInteractive` inline `<script>` that reads `localStorage.getItem('rudder-theme')` and sets `document.documentElement.dataset.theme` before paint (no flash). Default `light`.

**Interfaces (Produces):**

```ts
// src/ui/types.ts — serialized API shapes (Dates are ISO strings over JSON)
export type IssueStatus = 'inbox' | 'backlog' | 'in_progress' | 'done' | 'rejected' | 'on_hold'
export type Priority = 'p0' | 'p1' | 'p2'
export type IssueType = 'bug' | 'feature' | 'improvement'
export type ApiIssue = { id: number; title: string; description: string; type: IssueType; productId: number; status: IssueStatus; priority: Priority | null; requesterId: number; assigneeId: number | null; milestoneId: number | null; sortOrder: number | null; reason: string | null; version: number; createdAt: string; updatedAt: string }
export type ApiUser = { id: number; portalId: string; name: string; role: 'admin' | 'user' }
export type ApiProduct = { id: number; name: string; active: boolean; createdByUserId: number | null; updatedByUserId: number | null; createdAt: string; updatedAt: string }
export type ApiMilestone = { id: number; name: string; startsOn: string | null; endsOn: string | null; closed: boolean; createdByUserId: number | null; updatedByUserId: number | null; createdAt: string; updatedAt: string }
export type ApiComment = { id: number; issueId: number; actorType: 'user' | 'agent'; actorUserId: number | null; actorTokenId: number | null; body: string; createdAt: string }
export type ApiEvent = { id: number; issueId: number; actorType: 'user' | 'agent'; actorUserId: number | null; actorTokenId: number | null; field: string; oldValue: string | null; newValue: string | null; createdAt: string }
export type ApiRelation = { id: number; issueId: number; relatedIssueId: number; kind: 'duplicate' | 'relates' | 'blocks'; createdAt: string; related: { id: number; title: string; status: IssueStatus } | null }
export type ApiIssueDetail = { issue: ApiIssue; comments: ApiComment[]; events: ApiEvent[]; relations: ApiRelation[] }
export type ApiRoadmapEntry = { milestone: ApiMilestone; total: number; done: number; issues: Array<Pick<ApiIssue, 'id' | 'title' | 'status' | 'priority' | 'productId'>> }

// src/ui/api.ts
export class ApiError extends Error { constructor(public status: number, message: string) }
export async function api<T>(path: string, init?: RequestInit): Promise<T>
// fetch(path, { …init, headers: { 'content-type': 'application/json', …init?.headers } })
// → parse { ok, data | error }; !res.ok || !body.ok → throw new ApiError(res.status, body.error ?? '요청에 실패했습니다')
// → body.data as T. 401 → ALSO window.location.assign('/login') when not already there.
export function useApi<T>(path: string | null): { data: T | null; error: ApiError | null; loading: boolean; refetch: () => void }
// null path = don't fetch (dependent queries). Plain useState/useEffect; no library.

// src/ui/labels.ts — single source for design-doc §8 vocabulary
export const STATUS_LABEL: Record<IssueStatus, { ko: string; en: string }>   // 입항 대기/Inbox … per §8
export const STATUS_CHIP: Record<IssueStatus, string>   // 'chip--inbox' … 'chip--hold'
export const STATUS_FLAG: Record<IssueStatus, string>   // 'flag--inbox' … 'flag--hold'
export const TYPE_LABEL: Record<IssueType, { glyph: string; ko: string }>   // ▲ 버그 / ＋ 기능 / ↑ 개선
export const RELATION_LABEL: Record<'duplicate' | 'relates' | 'blocks', string> // duplicate/relates/blocks (mono, untranslated per mockup)
export const EVENT_FIELD_LABEL: Record<string, string>  // created→등록, status→상태, priority→우선순위, reason→사유, title→제목, description→설명, type→유형, product_id→제품, assignee_id→담당자, milestone_id→마일스톤, sort_order→백로그 순서, relation_added→관계 추가, relation_removed→관계 해제
export function eventFieldLabel(field: string): string  // map hit → label; miss → the raw field (frozen vocabulary may still grow in later phases)
export function statusValueLabel(v: string | null): string // 'backlog' → '선적 대기' etc for history old→new rendering; non-status values pass through
```

**Login page** (`/login`, no shell): centered `.panel` on `--canvas`, brand
mark + `RUDDER` display type, portalId + password fields, submit → `api('/api/v1/auth/login', { method:'POST', body: JSON.stringify({...}) })`
→ success `router.push('/inbox')`; `ApiError` → inline `.hint`-styled error
line showing the server's Korean message (401 body copy is already correct).
Autofocus portalId; submit disabled while pending. Copy: title `순항 준비`,
button `로그인`.

**Test specs:** `labels.test.ts` — every one of the 6 statuses / 3 types /
3 relation kinds / 13 event fields has an entry (iterate the exported record
keys against literal arrays, so adding an enum value without a label fails);
`statusValueLabel('in_progress') === '항해 중'`; `eventFieldLabel('unknown_x') === 'unknown_x'`.
`api.test.ts` — stub `globalThis.fetch`: envelope success returns data;
`{ ok:false, error }` throws ApiError with server message + status; invalid
JSON throws ApiError; 401 triggers redirect (assert via stubbed
`window.location.assign` — vitest `vi.stubGlobal`).

- [ ] **Step 1**: Write failing `labels`/`api` tests → implement `types.ts`, `labels.ts`, `api.ts` until green.
- [ ] **Step 2**: `npm i pretendard`; stylesheet swap + fonts + theme script + layout metadata (`title: 'Rudder'`); root page redirect; delete page.module.css.
- [ ] **Step 3**: Login page. `npm run build` must pass (this is the UI type/lint gate for every UI task).
- [ ] **Step 4**: Coverage gate glob update; run `npm test` + `npm run coverage:gate`.
- [ ] **Step 5**: Smoke (reviewer will repeat): `docker compose up -d`, `npm run db:migrate`, `npm run seed` fixture, `npm run dev` → `/login` renders with Rudder tokens (dark/light both), wrong password shows Korean error, correct login lands on `/inbox` (404 placeholder acceptable this task).
- [ ] **Step 6**: Commit `feat: UI foundation — design tokens live, fonts, theme, API client, login`.

---

### Task 5: App shell + shared components

**Files:**
- Create: `src/app/(app)/layout.tsx` (client shell wrapper), `src/ui/shell.tsx` (Rail + Topbar + theme toggle + auth guard), `src/ui/chips.tsx` (StatusChip, PriorityTag, TypeTag, PilotFlag), `src/ui/sprites.tsx` (BrandMark, Ship, Lighthouse, Buoy, DangerBuoy, FlagPort, Sun, Moon — rects copied exactly from `design/` sprites, each `aria-hidden`), `src/ui/bits.tsx` (Avatar, EmptyState, Gauge)
- Create placeholder pages so nav works: `src/app/(app)/inbox/page.tsx`, `board/page.tsx`, `roadmap/page.tsx`, `requests/page.tsx`, `products/page.tsx` (each: shell-visible `h-view` title + `EmptyState`, replaced by later tasks)

**Interfaces (Produces):**

```tsx
// src/ui/shell.tsx
export type ShellPage = 'inbox' | 'board' | 'roadmap' | 'requests' | 'products' | null
export function Shell({ page, children }: { page: ShellPage; children: React.ReactNode })
// `null` = no active nav item. Required: routes exist inside (app) that are not
// nav destinations — /issues/[id] is the first (T7). A closed union forced the
// first implementation to default unknown paths to 'inbox', which would light
// aria-current on the wrong entry: an accessibility attribute asserting a
// falsehood. Widened 2026-07-31 after review.
// - useApi<ApiUser>('/api/v1/auth/me'): loading → minimal blank; ApiError(401) handled by api.ts redirect
// - rail: nav items exactly as design/shell.js NAV (입항 대기/Inbox, 선적 대기 보드/Board, 로드맵/Roadmap, 내 요청/Mine) + 관리 group (제품 관리/Products); aria-current="page" on active
// - counts on nav items: OMITTED in Phase 2 (would need N extra list calls per render; ponytail: add when a summary endpoint exists)
// - theme toggle button (밝은/어두운 테마) persisting localStorage 'rudder-theme'
// - who-row shows me.name + me.role from /auth/me
export function MeContext / useMe(): ApiUser  // React context set by Shell so views know role/id without refetching

// src/ui/chips.tsx
export function StatusChip({ status }: { status: IssueStatus })       // .chip + .flag pair via labels.ts
export function PriorityTag({ priority }: { priority: Priority | null }) // null → '미정' faint text (mockup 04)
export function TypeTag({ type }: { type: IssueType })
export function PilotFlag()                                           // .flag--pilot with title="도선사(슬랙 봇)가 대신 등록"
```

Markup source: `design/shell.js` rail structure + `design/index.html`
component section. The mockups' `outerHTML` injection is NOT ported (design
doc §10) — this is a plain React component.

**Verification (no unit tests — markup):** `npm run build` green; reviewer
smoke: all five nav routes render inside the shell, active nav item shows the
accent bar, theme toggle persists across reload, logging out via
`curl -X POST /api/v1/auth/logout` + reload bounces to `/login`.

- [ ] **Step 1**: chips/sprites/bits components (pure markup, props typed).
- [ ] **Step 2**: Shell + (app) layout + placeholder pages; wire MeContext.
- [ ] **Step 3**: `npm run build` + full test suite green (nothing broke).
- [ ] **Step 4**: Commit `feat: app shell, nav rail, theme toggle, shared chips/sprites`.

---

### Task 6: New-issue dialog + Inbox view with grooming

**Files:**
- Create: `src/ui/new-issue.tsx` (native `<dialog>`), `src/ui/catalog-data.ts` (shared hooks), `src/app/(app)/inbox/page.tsx` (replace placeholder)
- Test: none new (interaction verified on dev server; all business rules are already API-tested)

**Interfaces:**

```tsx
// src/ui/catalog-data.ts — the id→name maps every view needs
export function useProducts(): { products: ApiProduct[] | null; refetch(): void }   // GET /api/v1/products
export function useUsers(): { users: ApiUser[] | null }                              // GET /api/v1/users (Task 3)
export function useMilestones(): { milestones: ApiMilestone[] | null; refetch(): void } // GET /api/v1/milestones
export function nameOf<T extends { id: number; name: string }>(rows: T[] | null, id: number | null): string | null
// Returns null while `rows` is still loading, '미배정' only for a genuine miss.
// Corrected 2026-07-31: the original signature collapsed both into '미배정', so a
// page whose issues request resolved before its catalog requests rendered a real
// product/assignee as 미배정 until the catalog arrived — a visible flash on a normal
// load, not a rare edge. Callers must handle null (render nothing or a placeholder);
// the nullable return is what forces each of T7-T10 to make that choice consciously
// instead of inheriting a silent lie.

// src/ui/new-issue.tsx
export function NewIssueButton()  // topbar '새 이슈' → opens dialog; on 201 → router.push(`/issues/${issue.id}`)
// dialog fields: 제목(input, required), 제품(select from useProducts, active only), 유형(seg: 버그/기능/개선), 설명(textarea + hint)
// POST /api/v1/issues { title, type, productId, description? } — requesterId is implicit (session)
```

**Inbox page contract** (markup from `design/01-inbox.html`):
- Data: `useApi<ApiIssue[]>('/api/v1/issues?status=inbox')` + catalog hooks.
- Head: `통관을 기다리는 화물 N건`; product filter `fchip`s with per-product counts computed client-side; `전체` chip first.
- Rows: `.row` grid — id, title, TypeTag, product name (mono), requester name, created date (MM-DD). Row click (or 통관 button) expands the inline grooming panel (`row--open` + panel exactly as mockup); one open at a time.
- **Grooming panel** (admin only — non-admin sees rows without 통관 buttons): priority seg P0/P1/P2 (required, no default), milestone + assignee selects (option `미배정` = undefined), actions:
  - `P0으로 통관` (label tracks selected priority: `P1으로 통관`…; `.btn--accent`, disabled until priority picked) → `POST /api/v1/issues/{id}/transition { to:'backlog', priority }`; then if milestone/assignee chosen → `PATCH /api/v1/issues/{id} { milestoneId?, assigneeId? }`; refetch list.
  - `반송` (`.btn--danger`) / `정박` → reveal required reason textarea (`반송·정박은 사유를 남겨야 저장됩니다` hint; submit disabled while empty) → `POST …/transition { to:'rejected'|'on_hold', reason }`.
  - `ApiError` → panel-local error line with server message; 409 message already tells the user to refresh — add a `새로고침` button that refetches.
- Empty state: §8 copy (`입항 대기 중인 화물이 없습니다` / `오늘 바다는 잔잔하네요 ⚓ …`) + `.px-sea`.
- Deliberate cut (documented): the 도선사 PilotFlag does NOT appear on list rows — issue rows don't carry creator actor type and N+1 detail fetches aren't worth it; the flag lives on the detail view (Task 7). `ponytail:` comment at the row render site.

- [ ] **Step 1**: catalog-data hooks + NewIssueButton (wired into Shell topbar area or per-page head, matching mockups' topbar placement).
- [ ] **Step 2**: Inbox rows + filters + empty state.
- [ ] **Step 3**: Grooming panel + actions + error handling.
- [ ] **Step 4**: `npm run build` + suite green. Smoke: create → appears in inbox → 통관 P1+담당자 → disappears (backlog), 반송 without reason blocked, with reason succeeds.
- [ ] **Step 5**: Commit `feat: inbox view — grooming panel, product filters, new-issue dialog`.

---

### Task 7: Issue detail view

**Files:**
- Create: `src/app/(app)/issues/[id]/page.tsx`, `src/ui/history.tsx` (event log renderer), `src/ui/comment-thread.tsx`
- Test: `tests/ui/history.test.ts` (pure formatting fn)

**Interfaces:**

```ts
// src/ui/history.tsx
export function formatEvent(e: ApiEvent, users: ApiUser[] | null): { who: string; text: string; field: string }
// who: users lookup on actorUserId → name; actorType 'agent' → '도선사'
// text per §8: created → '등록'; status → `상태 ${statusValueLabel(old)} → ${statusValueLabel(new)}`;
// priority → `우선순위 ${old ?? '없음'} → ${new}` (upper-cased P0…); sort_order → `백로그 순서 변경`
// (raw float sortOrder values are NOT shown — they're internal); reason set/cleared → '사유 기록'/'사유 삭제';
// relation_added/removed → '관계 추가'/'관계 해제'; other fields → `${EVENT_FIELD_LABEL[field]} 변경`
// field: the raw snake_case value, rendered in .log__field mono (design doc §8 requirement)
```

**Page contract** (markup from `design/05-issue.html`):
- Data: `useApi<ApiIssueDetail>(`/api/v1/issues/${id}`)` + catalog hooks + users.
- Header: StatusChip · PriorityTag · TypeTag · `product · milestone` mono; h1 title; byline `#id · {requester}이 요청 · {도선사(슬랙 봇)가 등록 — only when events[0].field==='created' && events[0].actorType==='agent'} · MM-DD HH:mm 등록 · v{version}`.
- Left column: 설명 (description, `.prose`, preserve newlines via CSS `white-space: pre-wrap`) — **no attachments section** (Phase 3); comments thread (Avatar+name+time, `.cmt` markup) + composer → `POST /api/v1/issues/{id}/comments { body }` → refetch. Placeholder copy: `댓글을 남기면 요청자에게 슬랙으로 전달됩니다` stays (Phase 3 delivers it; copy already promises the product behavior).
- Right column: meta rows (상태/우선순위/제품/마일스톤/담당자/요청자/백로그 순서 `n / total` — backlog only, computed from a `useApi` of `/api/v1/issues?status=backlog` position lookup; hide row otherwise). Admin editing: 담당자/마일스톤/제품 as inline selects firing `PATCH`; 우선순위 seg firing `PATCH { priority }`. Requester (non-admin) editing: title/description only — pencil toggle to input/textarea + 저장 (`PATCH`); everything else read-only. Buttons per current status's legal transitions (`TRANSITIONS` mirror hard-coded client-side would drift — instead: render the fixed action set 항해 시작/배송 완료/정박/반송/선적 대기로 that the mockups show for each status, send the transition, and surface the server's 422 message when illegal; the server matrix is the single authority).
- Relations panel: list with kind mono tag + related title link (`/issues/{relatedId}`); `관계 추가` opens small dialog (issue id number input + kind select) → `POST .../relations`; remove button (admin) → `DELETE .../relations?relatedIssueId=&kind=` (check the actual Phase 1 route signature by reading `relations/route.ts` first and match it exactly).
- History: `formatEvent` rows, `.log` markup, newest last (API ascending order kept).
- 409 anywhere → inline message + refetch button (server copy is the instruction).

**Test specs** (`history.test.ts`): status event renders both Korean labels;
created by agent renders 도선사; unknown user id renders `사용자 #{id}`;
sort_order event omits raw values; priority null→p0 renders `없음 → P0`.

- [ ] **Step 1**: TDD `formatEvent` (failing tests → implement).
- [ ] **Step 2**: Page layout + meta panel + edit affordances by role.
- [ ] **Step 3**: Comments, relations, transitions with reason dialog (shared pattern from Task 6 — extract `ReasonPrompt` into `src/ui/bits.tsx` if Task 6 inlined it).
- [ ] **Step 4**: Build + suite + smoke (admin full loop; second browser profile as non-admin requester: can edit own title, cannot see admin controls).
- [ ] **Step 5**: Commit `feat: issue detail — meta editing, comments, relations, translated history`.

---

### Task 8: Backlog board with drag + keyboard ordering

**Files:**
- Create: `src/app/(app)/board/page.tsx`, `src/ui/board-column.tsx`, `src/ui/reorder.ts` (pure), `src/ui/issue-card.tsx`
- Test: `tests/ui/reorder.test.ts`

**Interfaces:**

```ts
// src/ui/reorder.ts — the ONLY ordering math; UI events call these
export function reorderTarget(orderedIds: number[], draggedId: number, dropIndex: number): { afterId: number } | { beforeId: number } | null
// list without draggedId, inserting at dropIndex: prev exists → { afterId: prev };
// else next exists → { beforeId: next }; else null (single-item list → no-op)
export function keyboardTarget(orderedIds: number[], id: number, dir: 'up' | 'down'): { afterId: number } | { beforeId: number } | null
// up → { beforeId: previous id } (null at top); down → { afterId: next id } (null at bottom)
```

**Page contract** (markup `design/02-backlog.html`):
- Columns: 선적 대기 / 항해 중 / 정박 / 배송 완료 — four parallel `useApi` calls `/api/v1/issues?status=X` (+`&productId=` when one product fchip active; multi-select chips filter client-side over unfiltered fetches — pick ONE: product filter always client-side over the 4 status fetches, since fchips are multi-toggle in the mockup; `ponytail:` note that server-side productId param exists if lists ever get big).
- IssueCard: `.card` markup — id, PriorityTag, title, TypeTag, product mono, footer requester/assignee name + milestone (done column: `.arrived` ✓ MM-DD 도착 from updatedAt). `card--p0` accent edge. Click → `/issues/{id}`. 정박 cards show `.hint` 정박 사유 · {reason}.
- Done column client-side slice 5 + `전체 보기` toggle. 반송 hidden; `반송 보기` button appends a rejected column fetch.
- **Drag (backlog column only)**: HTML5 `draggable` on cards; `dragover` on column computes dropIndex from card midpoints; `.drop` indicator element rendered at the index; on drop → `reorderTarget` → `POST /api/v1/issues/{id}/reorder` body `{ afterId }|{ beforeId }` → optimistic local reorder, rollback + server-message toast on ApiError. `card--lifted` class while dragging. `ponytail:` HTML5 DnD is mouse-only — the keyboard path is the accessible/touch fallback; revisit with a dnd lib only if tablet drag becomes a real need.
- **Keyboard**: cards `tabIndex=0`; `Alt+ArrowUp/Down` → `keyboardTarget` → same endpoint, focus follows the card. Column footer note documents it (mockup copy).
- Board head: `{active milestone name} · 순항 중` is mockup fiction — real head: `선적 대기 보드` + right-aligned mono `{n}건 · P0 {n}건` computed from fetches.

**Test specs** (`reorder.test.ts`): drop at head → beforeId of old first;
drop at tail → afterId of old last; drop between → afterId of left neighbor;
**dropping onto its own current position → `null`** (no API call — the
function removes `draggedId` before indexing, so an unchanged position
yields the same neighbors; callers skip the request when the result is
`null`, and also skip when the computed target equals the dragged id's
existing neighbor); keyboard up at top / down at bottom → `null`;
two-item swaps both directions; `orderedIds` of length 1 → `null`.

- [ ] **Step 1**: TDD `reorder.ts` (failing → green).
- [ ] **Step 2**: Cards + columns + filters (no drag yet); build green.
- [ ] **Step 3**: Drag + drop indicator + optimistic update + rollback; keyboard path.
- [ ] **Step 4**: Suite + build + smoke: drag C after A with real Postgres running, reload — order persists (sortOrder from server); ⌥↑ moves and keeps focus; rejected toggle.
- [ ] **Step 5**: Commit `feat: board — four columns, drag + keyboard backlog ordering`.

---

### Task 9: Roadmap view — timeline + quarter groups + milestone management

**Files:**
- Create: `src/ui/timeline.ts` (pure — ALL date math), `src/ui/horizon.tsx`, `src/app/(app)/roadmap/page.tsx`, `src/ui/milestone-dialog.tsx`
- Test: `tests/ui/timeline.test.ts`

**Interfaces:**

```ts
// src/ui/timeline.ts  (design doc §4 Horizon rules — read it before writing)
export type PortState = 'done' | 'next' | 'future' | 'overdue' | 'dest'
export type TimelinePort = { x: number; row: 'a' | 'b'; state: PortState; endCap: boolean; milestones: Array<{ id: number; name: string; pct: number | null; dday: string }> }
export type Timeline = { qlabels: Array<{ x: number; label: string }>; ticks: number[]; ports: TimelinePort[]; shipX: number; undated: number[] /* milestone ids excluded from the axis */ }
export function buildTimeline(entries: ApiRoadmapEntry[], today: Date): Timeline
```

Rules `buildTimeline` must encode (each is one or more unit tests):
1. Range = quarter-rounded `[min, max]` over dated milestones' `endsOn` ∪ today; mapped linearly to x ∈ [2, 98]. Quarter ticks + labels (`Q2`…) at boundaries inside the range.
2. Milestones with `endsOn == null` go to `undated`, never onto the axis.
3. Same `endsOn` (calendar date) → ONE port, milestones stacked in its list.
4. State per port (from its milestones' aggregate): every milestone closed-or-complete (`closed || (total > 0 && done === total)`) → `done`; else `endsOn <` today (date-only compare, KST semantics = plain `YYYY-MM-DD` string compare) → `overdue`; else `future`.
5. The latest-dated port, if not `done`/`overdue`, becomes `dest` (the one lighthouse). The earliest `future` port that is not `dest` becomes `next` (lit buoy). If they coincide, `dest` wins and no `next` exists.
6. Rows alternate a/b in date order; the last port gets `endCap: true` when x > 90.
7. `shipX` = today's x; `pct` = `done/total` rounded or `null` when `total === 0`; `dday` = `D+n` for overdue (n = whole days past), `MM-DD` otherwise.

**Page contract** (markup `design/03-roadmap.html`):
- Data: `useApi<ApiRoadmapEntry[]>('/api/v1/roadmap')`.
- Horizon: sun/moon sprites (theme-swapped via CSS classes already in stylesheet), sea, head — eyebrow `{year} 항로 · {range}`, h2 `다음 기한: {name} · {n}일 남음` (from the `next` port; no future milestones → `계획된 다음 기한이 없습니다`), `기준 {today}` right. `.tl` rendered from `buildTimeline` output; marker sprite per state (FlagPort/Buoy lit via `--next`/DangerBuoy/Lighthouse) — overdue port with multiple milestones shows one danger buoy.
- Below: sections grouped by `endsOn` quarter (undated last as `기간 미정`), ordered by date; each section head `h-panel {2026 Q3} · {mono date range} · {n}개 마일스톤`; milestone panels exactly as mockup — chip (완료 `chip--done` when done / `지연 D+n` flagless `chip--rejected` when overdue / 항해 중 `chip--progress` when started / 계획 `chip--inbox` otherwise), berth waterline `--fill:{pct}%` (`berth--arrived` at done, `berth--live` on in-window in-progress), counts line `done / total` + `반송 n · 집계 제외` (rejected derived from `entry.issues` statuses), top-3 issue rows (priority-ordered as delivered), footer `최종 수정 · {users lookup of updatedByUserId ?? createdByUserId} · {MM-DD}` — the line Task 3's columns exist for. Both ids are nullable; render `—` for the name when neither resolves (a row created before attribution existed).
- Admin: `마일스톤 추가` (topbar) + panel-head edit button → `milestone-dialog.tsx` — name, `<input type="date">` ×2, closed checkbox (edit only) → `POST /api/v1/milestones` / `PATCH /api/v1/milestones/{id}`; server 422 messages surface inline (dup name, date range).

**Test specs** (`timeline.test.ts`, fixed `today = new Date('2026-07-31')`):
range rounding (06-30 + 12-31 → Q2..Q4, ticks at 07-01/10-01 mapped
positions asserted to 1 decimal); undated exclusion; same-date merge; each
state rule incl. dest-vs-next coincidence and all-done (no dest, no next);
overdue `D+6` string for 07-25; row alternation a,b,a; endCap at 98.

- [ ] **Step 1**: TDD `timeline.ts` — write the full failing spec set, then implement until green.
- [ ] **Step 2**: Horizon component + page sections from `buildTimeline`.
- [ ] **Step 3**: Milestone create/edit dialog + refetch.
- [ ] **Step 4**: Suite + build + smoke: seed milestones incl. one overdue and two sharing a date; verify axis/labels/states in both themes against `design/03-roadmap.html`.
- [ ] **Step 5**: Commit `feat: roadmap — date-axis horizon, quarter groups, milestone management`.

---

### Task 10: My Requests + Products admin

**Files:**
- Create: `src/app/(app)/requests/page.tsx`, `src/app/(app)/products/page.tsx` (replace placeholders)

**My Requests** (markup `design/04-my-requests.html`): data
`/api/v1/issues?requester=me`; split 진행 중 (`inbox|backlog|in_progress|on_hold`)
vs 종료 (`done|rejected`); row grid per mockup (id, title, TypeTag,
StatusChip, PriorityTag or `.arrived` for done / `—` for rejected, date,
열기 link). Rejected rows render the reason block inline (`.stamp` 반송 +
`issue.reason` +, when admin groomed it, the 반송 사유 wording from mockup);
`reason == null` guard → omit block. Inbox hint copy from mockup. Empty
state §8 (`아직 보낸 요청이 없습니다`).

**Products admin** (`requireAdmin` server-side is already enforced by the
API; UI hides the page body for non-admin via `useMe().role`): table of
products — name, active toggle (`PATCH { active }`), inline rename (input +
저장, `PATCH { name }`, 422 dup message inline), `최종 수정` line from
attribution columns; `제품 추가` row (`POST /products`). Milestone
management already lives on the roadmap; this page is products only.

- [ ] **Step 1**: Requests page; smoke as non-admin user (three states visible incl. a rejected-with-reason row).
- [ ] **Step 2**: Products page; smoke rename/toggle/dup-name error; non-admin sees `권한이 없습니다` empty state.
- [ ] **Step 3**: Build + suite green. Commit `feat: my-requests and products admin views`.

---

### Task 11: Phase gate — real Postgres pass, docs, README

**Files:**
- Modify: `README.md` (replace create-next-app boilerplate: what Rudder is, dev setup — docker compose, migrate, seed, create-token, dev server, test/coverage/contrast gates; bootstrap order from final review M1), `docs/superpowers/plans/2026-07-30-rudder-overview.md` (Phase 2 outcome section + obligations discharged/remaining)

**Gate checklist — every line must show its actual output in the report:**
- [ ] **Step 1**: `npm test` (full, 3× for flake check), `npx tsc --noEmit`, `npm run coverage:gate` (now incl. `src/ui/*.ts`), `node design/contrast-check.mjs`, `npm run build` — all green.
- [ ] **Step 2**: Real-Postgres live pass (docker compose): migrate 0000+0001 from scratch; seed users; then via curl + browser walk the whole voyage — login → create product → create issue (web) + one via Bearer token with `requesterPortalId` → inbox 통관 (P0, milestone, assignee) → board drag reorder + ⌥↑ → detail comment/relation/patch (+ provoke a 409 by stale version and confirm the UI message) → roadmap shows waterline/timeline incl. an overdue milestone → requests shows the rejected reason → products rename+deactivate. Both themes screenshotted for the record.
- [ ] **Step 3**: Confirm PGlite/production parity risk points exercised live: transition + PATCH (version CAS) and reorder ran against real Postgres above (the Phase 1 lesson — a green PGlite suite is not proof).
- [ ] **Step 4**: README rewrite + overview doc Phase 2 outcome (state what was discharged: I5/I6/I7/M4/M5/M9, obligation 3 tests; what remains for Phase 3: attachments, Slack, rate limit, deploy, Playwright).
- [ ] **Step 5**: Commit `docs: Phase 2 outcome — UI shipped on real-Postgres verified API` and stop for the phase-level review wave (per process: Claude final review + Codex adversarial, verdicts to files).

---

## Self-Review (performed at write time)

**Spec coverage:** five views ✓ (T6 inbox, T8 board, T9 roadmap, T10 requests, T7 detail); web intake path ✓ (T6 dialog); login ✓ (T4); product management ✓ (T10 + T3 API); milestone management ✓ (T9); design-doc §9 gaps — catalog attribution ✓T3, GET /users ✓T3, PATCH /products ✓T3, roadmap dates/counts ✓T3 test, keyboard reorder ✓T8, error kinds ✓T1. Deliberate cuts named: nav counts (T5), pilot flag on list rows (T6), attachments (global).
**Placeholder scan:** no TBDs; every behavior named with exact copy/endpoint/rule; code blocks where contracts live.
**Type consistency:** `DomainError` (T1) consumed by T3 signatures; `UserActor` defined T3 before use; `ApiMilestone.createdByUserId` (T4 types) matches T3 schema camelCase serialization; `useApi`/`api` names consistent across T5–T10; `reorderTarget`/`keyboardTarget` defined T8 where used; `buildTimeline` consumes `ApiRoadmapEntry` from T4.
**Known risk carried forward:** existing catalog/product API tests will break at T3 signature change — T3 Step 4 owns updating them; T1 must land before T3 (DomainError in signatures). Order is strict T1→T2→T3, then T4→T5 strict, T6–T10 depend on T5 (T6→T7 share ReasonPrompt; run T6 before T7; T8/T9/T10 independent after T5 — parallelizable lanes).
