# Rudder Phase 1 (Core API) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fully tested REST API core for Rudder — schema, issue lifecycle domain logic, auth (sessions + agent tokens), and all `/api/v1` endpoints — runnable locally, no UI yet.

**Architecture:** Next.js 16 App Router serves both future UI and the REST API (`/api/v1/*`). All business logic lives in `src/domain/*` functions that take a `Db` handle and an `Actor`, record attributed events for every mutation (spec §10 guardrails), and are tested against PGlite. Route handlers only do: auth → zod parse → domain call → HTTP mapping.

**Tech Stack:** Next.js 16 (TypeScript), Drizzle ORM, postgres.js (prod driver), PGlite (test driver), drizzle-kit (migrations), zod, iron-session, bcryptjs, Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-30-issue-tracker-design.md`. Its §7 naming rules and §10 AI-readiness guardrails bind every task.
- Status enum values exactly: `inbox | backlog | in_progress | done | rejected | on_hold`. Priorities: `p0 | p1 | p2`. Types: `bug | feature | improvement`. Relations: `duplicate | relates | blocks`. Roles: `admin | user`. Actor types: `user | agent`.
- Every mutation records an event row with `actorType` plus exactly one of `actorUserId` / `actorTokenId` (an XOR CHECK enforces this pairing) — who did what, when. No mutation path may bypass `src/domain/*`.
- API error messages are Korean (UI language is Korean); code identifiers English.
- User-facing API responses: `{ ok: true, data }` or `{ ok: false, error }`.
- Coding rules: immutability (no object mutation), functions < 50 lines, files < 400 lines, no `console.log` (use `console.error` in catch paths only), no hardcoded secrets (env vars via `.env.local`).
- TDD for every task: failing test → implement → pass → commit. Conventional commits (`feat:`, `test:`, `chore:`); no attribution trailer.
- New dependencies limited to the Tech Stack list above. Do not add others.

## File Structure (locked)

```
docker-compose.yml            # local Postgres 16
drizzle.config.ts             # drizzle-kit config, out: ./drizzle
vitest.config.ts
src/db/schema.ts              # all tables + enums + exported TS types
src/db/client.ts              # getDb() — postgres.js in app, test override hook
src/domain/actor.ts           # Actor type
src/domain/transitions.ts     # pure transition matrix + validateTransition
src/domain/events.ts          # recordEvent
src/domain/issues.ts          # createIssue/listIssues/getIssueDetail/updateIssue/transitionIssue
src/domain/ordering.ts        # backlogSortOrder helpers + reorderIssue
src/domain/collab.ts          # addComment, addRelation, removeRelation
src/domain/catalog.ts         # products, milestones, roadmap query
src/lib/validation.ts         # zod schemas (single import surface for routes)
src/lib/session.ts            # iron-session wrapper
src/lib/auth.ts               # verifyCredentials (portal-swappable), login/logout helpers
src/lib/api-auth.ts           # actorFromRequest (session cookie OR Bearer token)
src/app/api/health/route.ts
src/app/api/v1/auth/{login,logout,me}/route.ts
src/app/api/v1/issues/route.ts                    # GET list, POST create
src/app/api/v1/issues/[id]/route.ts               # GET detail, PATCH
src/app/api/v1/issues/[id]/transition/route.ts    # POST
src/app/api/v1/issues/[id]/reorder/route.ts       # POST
src/app/api/v1/issues/[id]/comments/route.ts      # POST
src/app/api/v1/issues/[id]/relations/route.ts     # POST, DELETE
src/app/api/v1/products/route.ts                  # GET, POST
src/app/api/v1/milestones/route.ts                # GET, POST
src/app/api/v1/milestones/[id]/route.ts           # PATCH
src/app/api/v1/roadmap/route.ts                   # GET
scripts/seed.ts               # seed users (portalId,name,role,password)
scripts/create-token.ts       # mint agent API token, print once
tests/helpers/db.ts           # PGlite test db + fixtures
tests/domain/*.test.ts
tests/api/*.test.ts
```

**Authorization matrix (route layer enforces; domain trusts its caller):**

| Endpoint | user | admin | agent |
|---|---|---|---|
| POST /issues | ✅ (requester=self) | ✅ | ✅ (must send `requesterPortalId`) |
| GET /issues, GET /issues/:id, GET roadmap/products/milestones | ✅ | ✅ | ✅ |
| PATCH /issues/:id | own issue, `title`/`description` only | ✅ all fields | ❌ |
| POST transition / reorder / relations, DELETE relations | ❌ | ✅ | ❌ |
| POST comments | ✅ | ✅ | ❌ (future: 도선사 comments as suggestions, spec §10) |
| POST products / milestones, PATCH milestones | ❌ | ✅ | ❌ |

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts` (via create-next-app), `vitest.config.ts`, `docker-compose.yml`, `.env.example`, `src/app/api/health/route.ts`
- Test: `tests/api/health.test.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: running Next.js app; `npm test` runs Vitest; alias `@/*` → `src/*`

- [ ] **Step 1: Scaffold app and install dependencies**

```bash
cd /path/to/tyche-rudder
npx create-next-app@latest . --ts --app --src-dir --no-tailwind --no-eslint --import-alias "@/*" --use-npm
npm i drizzle-orm postgres zod iron-session bcryptjs
npm i -D drizzle-kit @electric-sql/pglite vitest @vitest/coverage-v8 @types/bcryptjs tsx
```

(create-next-app in a non-empty dir: it accepts existing `docs/`, `.omc/` etc. If it refuses, scaffold in a temp dir and move files in, keeping `docs/`.)

- [ ] **Step 2: Write configs**

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/domain/**', 'src/lib/**'],
      thresholds: { lines: 80, functions: 80, branches: 80 },
    },
  },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
})
```

`docker-compose.yml`:
```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: rudder
      POSTGRES_PASSWORD: rudder
      POSTGRES_DB: rudder
    ports: ["127.0.0.1:5432:5432"]
    volumes: [rudder-pgdata:/var/lib/postgresql/data]
volumes:
  rudder-pgdata:
```

`.env.example`:
```
DATABASE_URL=postgres://rudder:rudder@localhost:5432/rudder
SESSION_SECRET=change-me-32-chars-minimum-secret!!
```

Add to `package.json` scripts: `"test": "vitest run", "test:watch": "vitest", "db:generate": "drizzle-kit generate", "db:migrate": "drizzle-kit migrate", "seed": "tsx scripts/seed.ts", "create-token": "tsx scripts/create-token.ts"`.

- [ ] **Step 3: Write the failing health test**

`tests/api/health.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { GET } from '@/app/api/health/route'

describe('GET /api/health', () => {
  it('returns ok', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, data: { status: 'sailing' } })
  })
})
```

Run: `npm test` → Expected: FAIL (module not found).

- [ ] **Step 4: Implement health route**

`src/app/api/health/route.ts`:
```ts
import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({ ok: true, data: { status: 'sailing' } })
}
```

Run: `npm test` → Expected: PASS. Also `npm run dev` briefly and `curl localhost:3000/api/health`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: scaffold Next.js app with Vitest, Drizzle deps, local Postgres"
```

---

### Task 2: Database Schema & Migrations

**Files:**
- Create: `src/db/schema.ts`, `src/db/client.ts`, `drizzle.config.ts`, `tests/helpers/db.ts`
- Test: `tests/domain/schema.test.ts`

**Interfaces:**
- Consumes: Task 1 scaffold
- Produces: all tables; exported types `IssueStatus, Priority, IssueType, Role, ActorType, RelationKind, Issue, NewIssue, User, Db`; `getDb(): Db`; test helper `createTestDb(): Promise<Db>` and fixtures `seedUser(db, overrides?)`, `seedProduct(db, name?)`

- [ ] **Step 1: Write schema**

`drizzle.config.ts`:
```ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://rudder:rudder@localhost:5432/rudder' },
})
```

`src/db/schema.ts`:
```ts
import {
  pgTable, pgEnum, serial, text, integer, timestamp, doublePrecision, boolean, uniqueIndex, check,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const roleEnum = pgEnum('role', ['admin', 'user'])
export const issueTypeEnum = pgEnum('issue_type', ['bug', 'feature', 'improvement'])
export const priorityEnum = pgEnum('priority', ['p0', 'p1', 'p2'])
export const statusEnum = pgEnum('status', ['inbox', 'backlog', 'in_progress', 'done', 'rejected', 'on_hold'])
export const actorTypeEnum = pgEnum('actor_type', ['user', 'agent'])
export const relationKindEnum = pgEnum('relation_kind', ['duplicate', 'relates', 'blocks'])

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  portalId: text('portal_id').notNull().unique(),
  name: text('name').notNull(),
  role: roleEnum('role').notNull().default('user'),
  passwordHash: text('password_hash'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  active: boolean('active').notNull().default(true),
})

export const milestones = pgTable('milestones', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  startsOn: timestamp('starts_on'),
  endsOn: timestamp('ends_on'),
  closed: boolean('closed').notNull().default(false),
})

export const issues = pgTable('issues', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  type: issueTypeEnum('type').notNull(),
  productId: integer('product_id').notNull().references(() => products.id),
  status: statusEnum('status').notNull().default('inbox'),
  priority: priorityEnum('priority'),
  requesterId: integer('requester_id').notNull().references(() => users.id),
  assigneeId: integer('assignee_id').references(() => users.id),
  milestoneId: integer('milestone_id').references(() => milestones.id),
  sortOrder: doublePrecision('sort_order'),
  reason: text('reason'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const comments = pgTable('comments', {
  id: serial('id').primaryKey(),
  issueId: integer('issue_id').notNull().references(() => issues.id),
  actorType: actorTypeEnum('actor_type').notNull(),
  actorUserId: integer('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
  actorTokenId: integer('actor_token_id').references(() => apiTokens.id, { onDelete: 'restrict' }),
  body: text('body').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  check(
    'comments_actor_xor',
    sql`(${t.actorType} = 'user' AND ${t.actorUserId} IS NOT NULL AND ${t.actorTokenId} IS NULL)
     OR (${t.actorType} = 'agent' AND ${t.actorTokenId} IS NOT NULL AND ${t.actorUserId} IS NULL)`,
  ),
])

export const issueEvents = pgTable('issue_events', {
  id: serial('id').primaryKey(),
  issueId: integer('issue_id').notNull().references(() => issues.id),
  actorType: actorTypeEnum('actor_type').notNull(),
  actorUserId: integer('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
  actorTokenId: integer('actor_token_id').references(() => apiTokens.id, { onDelete: 'restrict' }),
  field: text('field').notNull(),
  oldValue: text('old_value'),
  newValue: text('new_value'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  check(
    'issue_events_actor_xor',
    sql`(${t.actorType} = 'user' AND ${t.actorUserId} IS NOT NULL AND ${t.actorTokenId} IS NULL)
     OR (${t.actorType} = 'agent' AND ${t.actorTokenId} IS NOT NULL AND ${t.actorUserId} IS NULL)`,
  ),
])

export const issueRelations = pgTable('issue_relations', {
  id: serial('id').primaryKey(),
  issueId: integer('issue_id').notNull().references(() => issues.id),
  relatedIssueId: integer('related_issue_id').notNull().references(() => issues.id),
  kind: relationKindEnum('kind').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('uniq_relation').on(t.issueId, t.relatedIssueId, t.kind)])

export const apiTokens = pgTable('api_tokens', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at'),
})

export type Role = (typeof roleEnum.enumValues)[number]
export type IssueType = (typeof issueTypeEnum.enumValues)[number]
export type Priority = (typeof priorityEnum.enumValues)[number]
export type IssueStatus = (typeof statusEnum.enumValues)[number]
export type ActorType = (typeof actorTypeEnum.enumValues)[number]
export type RelationKind = (typeof relationKindEnum.enumValues)[number]
export type User = typeof users.$inferSelect
export type Issue = typeof issues.$inferSelect
export type NewIssue = typeof issues.$inferInsert
```

`src/db/client.ts`:
```ts
import { drizzle } from 'drizzle-orm/postgres-js'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import postgres from 'postgres'
import * as schema from './schema'

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>

let cached: Db | null = null

// Tests inject a PGlite-backed Db here (tests/helpers/db.ts); the app lazily
// connects postgres.js. ponytail: global override instead of DI plumbing —
// swap to per-request injection only if we ever need parallel isolated DBs.
export function getDb(): Db {
  const testDb = (globalThis as { __rudderTestDb?: Db }).__rudderTestDb
  if (testDb) return testDb
  if (!cached) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL not configured')
    cached = drizzle(postgres(url), { schema }) as unknown as Db
  }
  return cached
}
```

- [ ] **Step 2: Generate migration**

```bash
npx drizzle-kit generate
```
Expected: SQL file appears under `drizzle/`.

- [ ] **Step 3: Write test helper and failing schema test**

`tests/helpers/db.ts`:
```ts
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import * as schema from '@/db/schema'
import type { Db } from '@/db/client'

export async function createTestDb(): Promise<Db> {
  const db = drizzle(new PGlite(), { schema }) as unknown as Db
  await migrate(db as never, { migrationsFolder: 'drizzle' })
  ;(globalThis as { __rudderTestDb?: Db }).__rudderTestDb = db
  return db
}

export async function seedUser(db: Db, overrides: Partial<typeof schema.users.$inferInsert> = {}) {
  const [user] = await db.insert(schema.users)
    .values({ portalId: `user-${Math.random().toString(36).slice(2, 8)}`, name: '테스트 유저', ...overrides })
    .returning()
  return user
}

export async function seedProduct(db: Db, name = `product-${Math.random().toString(36).slice(2, 8)}`) {
  const [product] = await db.insert(schema.products).values({ name }).returning()
  return product
}
```

`tests/domain/schema.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { createTestDb, seedUser, seedProduct } from '../helpers/db'
import { issues } from '@/db/schema'
import type { Db } from '@/db/client'

describe('schema', () => {
  let db: Db
  beforeAll(async () => { db = await createTestDb() })

  it('round-trips an issue with defaults', async () => {
    const user = await seedUser(db)
    const product = await seedProduct(db)
    const [issue] = await db.insert(issues)
      .values({ title: '재고 동기화 오류', type: 'bug', productId: product.id, requesterId: user.id })
      .returning()
    expect(issue.status).toBe('inbox')
    expect(issue.priority).toBeNull()
    expect(issue.description).toBe('')
  })
})
```

Run: `npm test tests/domain/schema.test.ts` → Expected: PASS once schema+helper exist (fails before they do).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add Rudder database schema, migrations, PGlite test harness"
```

---

### Task 3: Transition Rules (pure domain)

**Files:**
- Create: `src/domain/transitions.ts`, `src/domain/actor.ts`
- Test: `tests/domain/transitions.test.ts`

**Interfaces:**
- Consumes: types from `@/db/schema`
- Produces:
  - `type Actor = { type: 'user'; id: number; role: Role } | { type: 'agent'; id: number }`
  - `validateTransition(issue: { status: IssueStatus; priority: Priority | null }, input: { to: IssueStatus; priority?: Priority; reason?: string }): { ok: true; priority: Priority | null } | { ok: false; error: string }`
  - `TRANSITIONS: Record<IssueStatus, readonly IssueStatus[]>`

- [ ] **Step 1: Write failing tests**

`tests/domain/transitions.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { validateTransition } from '@/domain/transitions'

describe('validateTransition', () => {
  it('inbox → backlog requires a priority', () => {
    const noPrio = validateTransition({ status: 'inbox', priority: null }, { to: 'backlog' })
    expect(noPrio).toEqual({ ok: false, error: '백로그 진입에는 우선순위(P0/P1/P2)가 필요합니다' })
    const withPrio = validateTransition({ status: 'inbox', priority: null }, { to: 'backlog', priority: 'p1' })
    expect(withPrio).toEqual({ ok: true, priority: 'p1' })
  })

  it('keeps existing priority when re-entering backlog', () => {
    expect(validateTransition({ status: 'done', priority: 'p2' }, { to: 'backlog' }))
      .toEqual({ ok: true, priority: 'p2' })
  })

  it('rejected/on_hold require a reason', () => {
    expect(validateTransition({ status: 'inbox', priority: null }, { to: 'rejected' }).ok).toBe(false)
    expect(validateTransition({ status: 'inbox', priority: null }, { to: 'on_hold', reason: '3분기 이후 재검토' }).ok).toBe(true)
  })

  it('blocks illegal jumps and terminal states', () => {
    expect(validateTransition({ status: 'inbox', priority: null }, { to: 'done' }).ok).toBe(false)
    expect(validateTransition({ status: 'rejected', priority: null }, { to: 'backlog', priority: 'p1' }).ok).toBe(false)
    expect(validateTransition({ status: 'done', priority: 'p1' }, { to: 'backlog' }).ok).toBe(true) // reopen
  })
})
```

The 4 cases above are the minimum; the finished test file must also cover the remaining legal matrix edges (all 12 total) and the whitespace-only-reason guard on `rejected`/`on_hold`.

Run: `npm test tests/domain/transitions.test.ts` → Expected: FAIL (module not found).

- [ ] **Step 2: Implement**

`src/domain/actor.ts`:
```ts
import type { Role } from '@/db/schema'

export type Actor =
  | { type: 'user'; id: number; role: Role }
  | { type: 'agent'; id: number }
```

`src/domain/transitions.ts`:
```ts
import type { IssueStatus, Priority } from '@/db/schema'

export const TRANSITIONS: Record<IssueStatus, readonly IssueStatus[]> = {
  inbox: ['backlog', 'rejected', 'on_hold'],
  backlog: ['in_progress', 'rejected', 'on_hold'],
  in_progress: ['done', 'backlog', 'on_hold'],
  on_hold: ['backlog', 'rejected'],
  done: ['backlog'], // reopen
  rejected: [],      // terminal
}

export type TransitionInput = { to: IssueStatus; priority?: Priority; reason?: string }
export type TransitionCheck =
  | { ok: true; priority: Priority | null }
  | { ok: false; error: string }

export function validateTransition(
  issue: { status: IssueStatus; priority: Priority | null },
  input: TransitionInput,
): TransitionCheck {
  if (!TRANSITIONS[issue.status].includes(input.to)) {
    return { ok: false, error: `${issue.status} → ${input.to} 전이는 허용되지 않습니다` }
  }
  if (input.to === 'backlog') {
    const priority = input.priority ?? issue.priority
    if (!priority) return { ok: false, error: '백로그 진입에는 우선순위(P0/P1/P2)가 필요합니다' }
    return { ok: true, priority }
  }
  if ((input.to === 'rejected' || input.to === 'on_hold') && !input.reason?.trim()) {
    return { ok: false, error: '반송/정박에는 사유가 필요합니다' }
  }
  return { ok: true, priority: input.priority ?? issue.priority }
}
```

- [ ] **Step 3: Run tests to verify pass**

Run: `npm test tests/domain/transitions.test.ts` → Expected: PASS (all 11).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add issue transition rules with grooming gates"
```

---

### Task 4: Issue Domain Operations & Event Recording

**Files:**
- Create: `src/domain/events.ts`, `src/domain/issues.ts`
- Test: `tests/domain/issues.test.ts`

**Interfaces:**
- Consumes: `Db`, `Actor`, `validateTransition`, schema tables; `backlogEntrySortOrder(db)` from Task 5 — until Task 5 lands, `transitionIssue` inlines `null` for sortOrder (Task 5 replaces it).
- Produces (exact signatures — later tasks and routes rely on these):
  - `recordEvent(db: Db, actor: Actor, issueId: number, field: string, oldValue: string | null, newValue: string | null): Promise<void>`
  - `createIssue(db, actor, input: { title: string; description?: string; type: IssueType; productId: number; requesterId: number }): Promise<Issue>`
  - `listIssues(db, filter: { status?: IssueStatus; productId?: number; requesterId?: number; milestoneId?: number }): Promise<Issue[]>` — backlog sorted by `sortOrder` asc, everything else `createdAt` desc
  - `getIssueDetail(db, id): Promise<{ issue: Issue; comments: Comment[]; events: IssueEvent[]; relations: RelationWithTitle[] } | null>`
  - `updateIssue(db, actor, id, patch: Partial<Pick<NewIssue, 'title' | 'description' | 'type' | 'productId' | 'assigneeId' | 'milestoneId' | 'priority'>>): Promise<{ ok: true; issue: Issue } | { ok: false; error: string }>`
  - `transitionIssue(db, actor, id, input: TransitionInput): Promise<{ ok: true; issue: Issue } | { ok: false; error: string }>`

Note: `issue_events.actorId` no longer exists. The columns are now `actorUserId` and `actorTokenId`, guarded by an XOR CHECK constraint tied to `actorType`. `recordEvent` must set exactly one of them from `actor` (the `users.id` when `actor.type === 'user'`, the `apiTokens.id` when `actor.type === 'agent'`) via a small helper rather than writing a single `actorId` field.

- [ ] **Step 1: Write failing tests**

`tests/domain/issues.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { createTestDb, seedUser, seedProduct } from '../helpers/db'
import { createIssue, transitionIssue, updateIssue, getIssueDetail, listIssues } from '@/domain/issues'
import { issueEvents } from '@/db/schema'
import { eq } from 'drizzle-orm'
import type { Db } from '@/db/client'
import type { Actor } from '@/domain/actor'

let db: Db
let admin: Actor
let requesterId: number
let productId: number

beforeAll(async () => {
  db = await createTestDb()
  const adminUser = await seedUser(db, { role: 'admin' })
  admin = { type: 'user', id: adminUser.id, role: 'admin' }
  requesterId = (await seedUser(db)).id
  productId = (await seedProduct(db)).id
})

describe('issue lifecycle', () => {
  it('creates an inbox issue and records a created event', async () => {
    const issue = await createIssue(db, admin, { title: '입고 폼 개선', type: 'improvement', productId, requesterId })
    expect(issue.status).toBe('inbox')
    const events = await db.select().from(issueEvents).where(eq(issueEvents.issueId, issue.id))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ field: 'created', actorType: 'user', actorUserId: admin.id })
  })

  it('grooms into backlog with priority, recording status+priority events', async () => {
    const issue = await createIssue(db, admin, { title: '그루밍 대상', type: 'feature', productId, requesterId })
    const result = await transitionIssue(db, admin, issue.id, { to: 'backlog', priority: 'p0' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.issue.status).toBe('backlog')
      expect(result.issue.priority).toBe('p0')
    }
    const events = await db.select().from(issueEvents).where(eq(issueEvents.issueId, issue.id))
    const fields = events.map((e) => e.field)
    expect(fields).toContain('status')
    expect(fields).toContain('priority')
  })

  it('rejects without reason fails; with reason stores it', async () => {
    const issue = await createIssue(db, admin, { title: '거절 대상', type: 'bug', productId, requesterId })
    expect((await transitionIssue(db, admin, issue.id, { to: 'rejected' })).ok).toBe(false)
    const rejected = await transitionIssue(db, admin, issue.id, { to: 'rejected', reason: '중복 요청' })
    expect(rejected.ok && rejected.issue.reason === '중복 요청').toBe(true)
  })

  it('updateIssue records one event per changed field, skips unchanged', async () => {
    const issue = await createIssue(db, admin, { title: '수정 대상', type: 'bug', productId, requesterId })
    const result = await updateIssue(db, admin, issue.id, { title: '수정 완료', type: 'bug' })
    expect(result.ok).toBe(true)
    const events = await db.select().from(issueEvents).where(eq(issueEvents.issueId, issue.id))
    expect(events.filter((e) => e.field === 'title')).toHaveLength(1)
    expect(events.filter((e) => e.field === 'type')).toHaveLength(0)
  })

  it('getIssueDetail returns null for missing, full bundle for existing', async () => {
    expect(await getIssueDetail(db, 999_999)).toBeNull()
    const issue = await createIssue(db, admin, { title: '상세 조회', type: 'feature', productId, requesterId })
    const detail = await getIssueDetail(db, issue.id)
    expect(detail?.issue.id).toBe(issue.id)
    expect(detail?.events.length).toBeGreaterThan(0)
  })

  it('listIssues filters by status and requester', async () => {
    const mine = await listIssues(db, { requesterId })
    expect(mine.every((i) => i.requesterId === requesterId)).toBe(true)
    const inbox = await listIssues(db, { status: 'inbox' })
    expect(inbox.every((i) => i.status === 'inbox')).toBe(true)
  })
})
```

Run: `npm test tests/domain/issues.test.ts` → Expected: FAIL (module not found).

- [ ] **Step 2: Implement events + issues domain**

`src/domain/events.ts`:
```ts
import { issueEvents } from '@/db/schema'
import type { Db } from '@/db/client'
import type { Actor } from './actor'
import { actorColumns } from './actor'

export async function recordEvent(
  db: Db, actor: Actor, issueId: number,
  field: string, oldValue: string | null, newValue: string | null,
): Promise<void> {
  await db.insert(issueEvents).values({ issueId, ...actorColumns(actor), field, oldValue, newValue })
}
```

`recordEvent` uses the `actorColumns` helper added to `src/domain/actor.ts`:
```ts
export function actorColumns(actor: Actor) {
  return actor.type === 'user'
    ? { actorType: 'user' as const, actorUserId: actor.id, actorTokenId: null }
    : { actorType: 'agent' as const, actorUserId: null, actorTokenId: actor.id }
}
```

`src/domain/issues.ts`:
```ts
import { and, asc, desc, eq, inArray, type SQL } from 'drizzle-orm'
import { comments, issueRelations, issues, issueEvents } from '@/db/schema'
import type { Issue, IssueStatus, IssueType, NewIssue, Priority } from '@/db/schema'
import type { Db } from '@/db/client'
import type { Actor } from './actor'
import { recordEvent } from './events'
import { validateTransition, type TransitionInput } from './transitions'
import { backlogEntrySortOrder } from './ordering'

export async function createIssue(
  db: Db, actor: Actor,
  input: { title: string; description?: string; type: IssueType; productId: number; requesterId: number },
): Promise<Issue> {
  const [issue] = await db.insert(issues)
    .values({ ...input, description: input.description ?? '' })
    .returning()
  await recordEvent(db, actor, issue.id, 'created', null, issue.title)
  return issue
}

export async function listIssues(
  db: Db,
  filter: { status?: IssueStatus; productId?: number; requesterId?: number; milestoneId?: number },
): Promise<Issue[]> {
  const conds: SQL[] = []
  if (filter.status) conds.push(eq(issues.status, filter.status))
  if (filter.productId) conds.push(eq(issues.productId, filter.productId))
  if (filter.requesterId) conds.push(eq(issues.requesterId, filter.requesterId))
  if (filter.milestoneId) conds.push(eq(issues.milestoneId, filter.milestoneId))
  const order = filter.status === 'backlog' ? asc(issues.sortOrder) : desc(issues.createdAt)
  return db.select().from(issues).where(conds.length ? and(...conds) : undefined).orderBy(order)
}

export async function getIssueDetail(db: Db, id: number) {
  const [issue] = await db.select().from(issues).where(eq(issues.id, id))
  if (!issue) return null
  const [issueComments, events, relations] = await Promise.all([
    db.select().from(comments).where(eq(comments.issueId, id)).orderBy(asc(comments.createdAt)),
    db.select().from(issueEvents).where(eq(issueEvents.issueId, id)).orderBy(asc(issueEvents.createdAt)),
    db.select().from(issueRelations).where(eq(issueRelations.issueId, id)),
  ])
  const relatedIds = relations.map((r) => r.relatedIssueId)
  const related = relatedIds.length
    ? await db.select({ id: issues.id, title: issues.title, status: issues.status })
        .from(issues).where(inArray(issues.id, relatedIds))
    : []
  const titleById = new Map(related.map((r) => [r.id, r]))
  return {
    issue,
    comments: issueComments,
    events,
    relations: relations.map((r) => ({ ...r, related: titleById.get(r.relatedIssueId) ?? null })),
  }
}

const PATCHABLE = ['title', 'description', 'type', 'productId', 'assigneeId', 'milestoneId', 'priority'] as const
type PatchField = (typeof PATCHABLE)[number]
export type IssuePatch = Partial<Pick<NewIssue, PatchField>>

const CONFLICT_ERROR = '다른 사용자가 먼저 이 이슈를 변경했습니다. 새로 고침 후 다시 시도해주세요'
const serialize = (v: unknown): string | null => (v == null ? null : String(v))

export async function updateIssue(
  db: Db, actor: Actor, id: number, patch: IssuePatch,
): Promise<{ ok: true; issue: Issue } | { ok: false; error: string }> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(issues).where(eq(issues.id, id))
    if (!current) return { ok: false, error: '이슈를 찾을 수 없습니다' }
    const changed = PATCHABLE.filter(
      (f) => patch[f] !== undefined && patch[f] !== current[f],
    )
    if (changed.length === 0) return { ok: true, issue: current }
    const values = changed.reduce<Partial<NewIssue>>((acc, f) => ({ ...acc, [f]: patch[f] }), {})
    const [updated] = await tx.update(issues)
      .set({ ...values, version: current.version + 1, updatedAt: new Date() })
      .where(and(eq(issues.id, id), eq(issues.version, current.version)))
      .returning()
    if (!updated) return { ok: false, error: CONFLICT_ERROR }
    for (const f of changed) {
      await recordEvent(tx, actor, id, f, serialize(current[f]), serialize(patch[f]))
    }
    return { ok: true, issue: updated }
  })
}

export async function transitionIssue(
  db: Db, actor: Actor, id: number, input: TransitionInput,
): Promise<{ ok: true; issue: Issue } | { ok: false; error: string }> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(issues).where(eq(issues.id, id))
    if (!current) return { ok: false, error: '이슈를 찾을 수 없습니다' }
    const check = validateTransition(current, input)
    if (!check.ok) return check
    const enteringBacklog = input.to === 'backlog'
    const sortOrder = enteringBacklog && current.sortOrder == null
      ? await backlogEntrySortOrder(tx) : current.sortOrder
    const reason = input.to === 'rejected' || input.to === 'on_hold' ? (input.reason ?? null) : null
    const [updated] = await tx.update(issues)
      .set({ status: input.to, priority: check.priority, sortOrder, reason, version: current.version + 1, updatedAt: new Date() })
      .where(and(eq(issues.id, id), eq(issues.version, current.version)))
      .returning()
    if (!updated) return { ok: false, error: CONFLICT_ERROR }
    await recordEvent(tx, actor, id, 'status', current.status, input.to)
    if (check.priority !== current.priority) {
      await recordEvent(tx, actor, id, 'priority', current.priority, check.priority)
    }
    if (reason !== current.reason) {
      await recordEvent(tx, actor, id, 'reason', current.reason, reason)
    }
    return { ok: true, issue: updated }
  })
}
```

Note: the version check is a real, dedicated `version` integer column (default `1`, incremented on every write), not a comparison against `updatedAt`. An earlier revision of this guard compared `updatedAt` instead; against real Postgres that failed on every call, because `postgres-js` parses `timestamp` into a millisecond-precision JS `Date` while Postgres `now()` has microsecond precision, so the round-tripped value never equals what's stored. PGlite's `now()` happens to be millisecond-exact, so the unit suite never caught it. A dedicated integer column has no such precision dependency.

Note: `backlogEntrySortOrder` comes from Task 5. To keep this task green in isolation, create `src/domain/ordering.ts` now with the minimal version (Task 5 extends the same file — do not rename):

```ts
import { eq, sql } from 'drizzle-orm'
import { issues } from '@/db/schema'
import type { Db } from '@/db/client'

export const ORDER_GAP = 1024

export async function backlogEntrySortOrder(db: Db): Promise<number> {
  const [row] = await db.select({ max: sql<number | null>`max(${issues.sortOrder})` })
    .from(issues).where(eq(issues.status, 'backlog'))
  return (row?.max ?? 0) + ORDER_GAP
}
```

- [ ] **Step 3: Run tests to verify pass**

Run: `npm test tests/domain/issues.test.ts` → Expected: PASS (6 tests).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add issue domain operations with actor-attributed events"
```

---

### Task 5: Backlog Ordering

**Files:**
- Modify: `src/domain/ordering.ts` (extend Task 4's file)
- Test: `tests/domain/ordering.test.ts`

**Interfaces:**
- Consumes: `Db`, `Actor`, issues in `backlog` status
- Produces: `reorderIssue(db: Db, actor: Actor, id: number, target: { afterId?: number; beforeId?: number }): Promise<{ ok: true; issue: Issue } | { ok: false; error: string }>` — `afterId` = the issue this one should come after (higher priority position = lower sortOrder is earlier; list ascending)

- [ ] **Step 1: Write failing tests**

`tests/domain/ordering.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { createTestDb, seedUser, seedProduct } from '../helpers/db'
import { createIssue, transitionIssue, listIssues } from '@/domain/issues'
import { reorderIssue } from '@/domain/ordering'
import type { Db } from '@/db/client'
import type { Actor } from '@/domain/actor'
import type { Issue } from '@/db/schema'

let db: Db
let admin: Actor
let a: Issue, b: Issue, c: Issue

beforeAll(async () => {
  db = await createTestDb()
  const adminUser = await seedUser(db, { role: 'admin' })
  admin = { type: 'user', id: adminUser.id, role: 'admin' }
  const requesterId = (await seedUser(db)).id
  const productId = (await seedProduct(db)).id
  const mk = async (title: string) => {
    const issue = await createIssue(db, admin, { title, type: 'feature', productId, requesterId })
    const r = await transitionIssue(db, admin, issue.id, { to: 'backlog', priority: 'p1' })
    if (!r.ok) throw new Error(r.error)
    return r.issue
  }
  a = await mk('A'); b = await mk('B'); c = await mk('C')
})

describe('reorderIssue', () => {
  it('appends in creation order by default', async () => {
    const list = await listIssues(db, { status: 'backlog' })
    expect(list.map((i) => i.title)).toEqual(['A', 'B', 'C'])
  })

  it('moves C between A and B', async () => {
    const result = await reorderIssue(db, admin, c.id, { afterId: a.id, beforeId: b.id })
    expect(result.ok).toBe(true)
    const list = await listIssues(db, { status: 'backlog' })
    expect(list.map((i) => i.title)).toEqual(['A', 'C', 'B'])
  })

  it('moves B to the front with only beforeId', async () => {
    const result = await reorderIssue(db, admin, b.id, { beforeId: a.id })
    expect(result.ok).toBe(true)
    const list = await listIssues(db, { status: 'backlog' })
    expect(list[0].title).toBe('B')
  })

  it('refuses to reorder a non-backlog issue', async () => {
    const requesterId = (await seedUser(db)).id
    const productId = (await seedProduct(db)).id
    const inboxIssue = await createIssue(db, admin, { title: 'inbox만', type: 'bug', productId, requesterId })
    expect((await reorderIssue(db, admin, inboxIssue.id, { afterId: a.id })).ok).toBe(false)
  })
})
```

Run: `npm test tests/domain/ordering.test.ts` → Expected: FAIL (`reorderIssue` not exported).

- [ ] **Step 2: Implement reorder**

Append to `src/domain/ordering.ts`:
```ts
import { and, asc, desc, gt, lt, ne } from 'drizzle-orm'
import type { Issue } from '@/db/schema'
import type { Db, DbOrTx } from '@/db/client'
import type { Actor } from './actor'
import { recordEvent } from './events'

const MAX_RENUMBER_RETRIES = 1

// Distinguishes "no such issue" (404, not-found) from "exists but isn't
// backlog" (422, domain rule) — collapsing both into one not-found message
// silently misroutes a real domain violation to 404 at the HTTP layer, where
// the not-found status is mapped by matching that message's substring.
async function backlogAnchor(
  db: DbOrTx, id: number | undefined,
): Promise<{ ok: true; sortOrder: number | null } | { ok: false; error: string }> {
  if (id == null) return { ok: true, sortOrder: null }
  const [row] = await db.select({ sortOrder: issues.sortOrder, status: issues.status }).from(issues)
    .where(eq(issues.id, id))
  if (!row) return { ok: false, error: '이슈를 찾을 수 없습니다' }
  if (row.status !== 'backlog') return { ok: false, error: '기준 이슈가 백로그 상태가 아닙니다' }
  return { ok: true, sortOrder: row.sortOrder }
}

async function nextBacklogSortOrder(db: DbOrTx, excludeId: number, after: number): Promise<number | null> {
  const [row] = await db.select({ sortOrder: issues.sortOrder }).from(issues)
    .where(and(eq(issues.status, 'backlog'), gt(issues.sortOrder, after), ne(issues.id, excludeId)))
    .orderBy(asc(issues.sortOrder)).limit(1)
  return row?.sortOrder ?? null
}

async function prevBacklogSortOrder(db: DbOrTx, excludeId: number, before: number): Promise<number | null> {
  const [row] = await db.select({ sortOrder: issues.sortOrder }).from(issues)
    .where(and(eq(issues.status, 'backlog'), lt(issues.sortOrder, before), ne(issues.id, excludeId)))
    .orderBy(desc(issues.sortOrder)).limit(1)
  return row?.sortOrder ?? null
}

// All reads (current issue, anchors, derived neighbours) happen inside the same
// transaction as the write, so a concurrent writer can't slip a change in between.
export async function reorderIssue(
  db: Db, actor: Actor, id: number, target: { afterId?: number; beforeId?: number },
): Promise<{ ok: true; issue: Issue } | { ok: false; error: string }> {
  return db.transaction((tx) => reorderWithinTx(tx, actor, id, target, MAX_RENUMBER_RETRIES))
}

// ponytail: midpoint insertion; float precision exhausts after ~50 splits in the same
// gap → one full renumber retry below. A gap still squeezed after that retry (only
// possible if a concurrent writer re-squeezes it between the renumber and the retry's
// read) fails explicitly instead of recursing again.
async function reorderWithinTx(
  tx: DbOrTx, actor: Actor, id: number, target: { afterId?: number; beforeId?: number }, retriesLeft: number,
): Promise<{ ok: true; issue: Issue } | { ok: false; error: string }> {
  const [current] = await tx.select().from(issues).where(eq(issues.id, id))
  if (!current) return { ok: false, error: '이슈를 찾을 수 없습니다' }
  if (current.status !== 'backlog') return { ok: false, error: '백로그(선적 대기) 이슈만 순서를 바꿀 수 있습니다' }

  const afterAnchor = await backlogAnchor(tx, target.afterId)
  if (!afterAnchor.ok) return afterAnchor
  const beforeAnchor = await backlogAnchor(tx, target.beforeId)
  if (!beforeAnchor.ok) return beforeAnchor
  let after = afterAnchor.sortOrder
  let before = beforeAnchor.sortOrder

  // A single anchor must respect its real neighbour, or the moved issue can land
  // exactly on top of it (anchor ± ORDER_GAP alone doesn't check what's already there).
  if (after != null && before == null) before = await nextBacklogSortOrder(tx, id, after)
  else if (before != null && after == null) after = await prevBacklogSortOrder(tx, id, before)

  // A contradictory pair (beforeId already sorts at or before afterId) can never be
  // resolved by renumbering — renumbering preserves relative order, so retrying after
  // it would hit this same branch forever. Reject it instead of recursing.
  if (after != null && before != null && before <= after) {
    return { ok: false, error: 'afterId는 beforeId보다 앞에 있어야 합니다' }
  }
  if (after != null && before != null && before - after < 1e-6) {
    if (retriesLeft <= 0) {
      return { ok: false, error: '동시 변경으로 순서를 계산할 수 없습니다. 다시 시도해주세요' }
    }
    await renumberBacklog(tx)
    return reorderWithinTx(tx, actor, id, target, retriesLeft - 1)
  }

  let next: number
  if (after != null && before != null) next = (after + before) / 2
  else if (after != null) next = after + ORDER_GAP
  else if (before != null) next = before - ORDER_GAP
  else return { ok: false, error: 'afterId 또는 beforeId가 필요합니다' }

  const [updated] = await tx.update(issues)
    .set({ sortOrder: next, updatedAt: new Date() })
    .where(eq(issues.id, id)).returning()
  await recordEvent(tx, actor, id, 'sort_order', serialize(current.sortOrder), serialize(next))
  return { ok: true, issue: updated }
}

// Runs inside the caller's transaction (never opens its own) so the renumber and the
// reorder that triggered it commit or fail together.
//
// Deliberately does NOT record a per-row audit event: a renumber only rescales existing
// sortOrder values without changing anyone's relative order, so it isn't a semantic
// change any actor made — logging one event per backlog row would bury the real history
// (which actor moved which issue between which anchors) under noise. That fact is
// already captured by the caller's own 'sort_order' event. This is a deliberate, scoped
// exception to "every mutation records an event," not an oversight.
async function renumberBacklog(db: DbOrTx): Promise<void> {
  const rows = await db.select({ id: issues.id }).from(issues)
    .where(eq(issues.status, 'backlog')).orderBy(asc(issues.sortOrder), asc(issues.id))
  for (const [index, row] of rows.entries()) {
    await db.update(issues).set({ sortOrder: (index + 1) * ORDER_GAP }).where(eq(issues.id, row.id))
  }
}
```

(Merge imports with the existing minimal file from Task 4 — final file has one import block. `serialize` is the null-preserving helper duplicated from `src/domain/issues.ts` — see that file's own `serialize`. Renumber's secondary `asc(issues.id)` sort matches `listIssues`' tie-break so a renumber can't silently reverse two issues that share a `sortOrder`.)

- [ ] **Step 3: Run tests to verify pass**

Run: `npm test tests/domain/ordering.test.ts` → Expected: PASS (4 tests). Also run the full suite: `npm test` → all green.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add backlog drag-order domain logic with midpoint insertion"
```

---

### Task 6: Comments & Relations

**Files:**
- Create: `src/domain/collab.ts`
- Test: `tests/domain/collab.test.ts`

**Interfaces:**
- Consumes: `Db`, `Actor`, schema tables
- Produces:
  - `addComment(db, actor, issueId, body: string): Promise<{ ok: true; comment: Comment } | { ok: false; error: string }>`
  - `addRelation(db, actor, issueId, relatedIssueId, kind: RelationKind): Promise<{ ok: true } | { ok: false; error: string }>` — rejects self-relation and duplicates
  - `removeRelation(db, actor, relationId): Promise<{ ok: true } | { ok: false; error: string }>`

Note: `comments.actorId` no longer exists. The columns are now `actorUserId` and `actorTokenId`, guarded by an XOR CHECK constraint tied to `actorType`. `addComment` must set exactly one of them from `actor` (the `users.id` when `actor.type === 'user'`, the `apiTokens.id` when `actor.type === 'agent'`) via a small helper rather than writing a single `actorId` field.

- [ ] **Step 1: Write failing tests**

`tests/domain/collab.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { createTestDb, seedUser, seedProduct } from '../helpers/db'
import { createIssue, getIssueDetail } from '@/domain/issues'
import { addComment, addRelation, removeRelation } from '@/domain/collab'
import type { Db } from '@/db/client'
import type { Actor } from '@/domain/actor'
import type { Issue } from '@/db/schema'

let db: Db
let admin: Actor
let x: Issue, y: Issue

beforeAll(async () => {
  db = await createTestDb()
  const adminUser = await seedUser(db, { role: 'admin' })
  admin = { type: 'user', id: adminUser.id, role: 'admin' }
  const requesterId = (await seedUser(db)).id
  const productId = (await seedProduct(db)).id
  x = await createIssue(db, admin, { title: 'X', type: 'bug', productId, requesterId })
  y = await createIssue(db, admin, { title: 'Y', type: 'bug', productId, requesterId })
})

describe('collab', () => {
  it('adds a comment attributed to the actor', async () => {
    const result = await addComment(db, admin, x.id, '통관 심사 의견입니다')
    expect(result.ok && result.comment.actorType === 'user').toBe(true)
  })

  it('rejects a comment on a missing issue', async () => {
    expect((await addComment(db, admin, 999_999, '유령 화물')).ok).toBe(false)
  })

  it('links two issues, rejects self-relation and duplicates', async () => {
    expect((await addRelation(db, admin, x.id, x.id, 'relates')).ok).toBe(false)
    expect((await addRelation(db, admin, x.id, y.id, 'duplicate')).ok).toBe(true)
    expect((await addRelation(db, admin, x.id, y.id, 'duplicate')).ok).toBe(false)
    const detail = await getIssueDetail(db, x.id)
    expect(detail?.relations[0]?.related?.title).toBe('Y')
  })

  it('removes a relation', async () => {
    const detail = await getIssueDetail(db, x.id)
    const relationId = detail!.relations[0].id
    expect((await removeRelation(db, admin, relationId)).ok).toBe(true)
    expect((await getIssueDetail(db, x.id))?.relations).toHaveLength(0)
  })
})
```

Run: `npm test tests/domain/collab.test.ts` → Expected: FAIL (module not found).

- [ ] **Step 2: Implement**

`src/domain/collab.ts`:
```ts
import { and, eq } from 'drizzle-orm'
import { comments, issueRelations, issues } from '@/db/schema'
import type { RelationKind } from '@/db/schema'
import type { Db } from '@/db/client'
import type { Actor } from './actor'
import { actorColumns } from './actor'
import { recordEvent } from './events'

type Comment = typeof comments.$inferSelect

async function issueExists(db: Db, id: number): Promise<boolean> {
  const [row] = await db.select({ id: issues.id }).from(issues).where(eq(issues.id, id))
  return row != null
}

export async function addComment(
  db: Db, actor: Actor, issueId: number, body: string,
): Promise<{ ok: true; comment: Comment } | { ok: false; error: string }> {
  if (!(await issueExists(db, issueId))) return { ok: false, error: '이슈를 찾을 수 없습니다' }
  const [comment] = await db.insert(comments)
    .values({ issueId, ...actorColumns(actor), body })
    .returning()
  return { ok: true, comment }
}

export async function addRelation(
  db: Db, actor: Actor, issueId: number, relatedIssueId: number, kind: RelationKind,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (issueId === relatedIssueId) return { ok: false, error: '자기 자신과는 연결할 수 없습니다' }
  if (!(await issueExists(db, issueId)) || !(await issueExists(db, relatedIssueId))) {
    return { ok: false, error: '이슈를 찾을 수 없습니다' }
  }
  // The unique index on (issueId, relatedIssueId, kind) is the authority on
  // duplicates, not a pre-check select — a pre-check outside this transaction
  // can't see a concurrent insert that lands between the check and our own.
  return db.transaction(async (tx) => {
    const [inserted] = await tx.insert(issueRelations)
      .values({ issueId, relatedIssueId, kind })
      .onConflictDoNothing()
      .returning()
    if (!inserted) return { ok: false, error: '이미 연결되어 있습니다' }
    await recordEvent(tx, actor, issueId, 'relation_added', null, `${kind}:#${relatedIssueId}`)
    return { ok: true } as const
  })
}

export async function removeRelation(
  db: Db, actor: Actor, issueId: number, relationId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // DELETE ... RETURNING is the authority on whether a row existed to remove —
  // a separate pre-read can no longer be trusted by the time we delete, and an
  // event recorded off a stale read would attribute a removal that didn't happen.
  // issueId is part of the WHERE, not a separate check, so a relation that
  // belongs to a different issue is indistinguishable from one that doesn't
  // exist at all: zero rows returned, same not-found result either way.
  return db.transaction(async (tx) => {
    const [relation] = await tx.delete(issueRelations)
      .where(and(eq(issueRelations.id, relationId), eq(issueRelations.issueId, issueId)))
      .returning()
    if (!relation) return { ok: false, error: '관계를 찾을 수 없습니다' }
    await recordEvent(
      tx, actor, relation.issueId, 'relation_removed',
      `${relation.kind}:#${relation.relatedIssueId}`, null,
    )
    return { ok: true } as const
  })
}
```

- [ ] **Step 3: Run tests to verify pass**

Run: `npm test tests/domain/collab.test.ts` → Expected: PASS (4 tests).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add comments and issue relations"
```

---

### Task 7: Human Auth — Sessions, Login Routes, Seed Script

**Files:**
- Create: `src/lib/session.ts`, `src/lib/auth.ts`, `src/lib/with-error-envelope.ts`, `src/app/api/v1/auth/login/route.ts`, `src/app/api/v1/auth/logout/route.ts`, `src/app/api/v1/auth/me/route.ts`, `scripts/seed.ts`
- Test: `tests/domain/auth.test.ts`, `tests/domain/validation.test.ts`, `tests/api/auth-envelope.test.ts`

**Interfaces:**
- Consumes: `users` table, `Db`
- Produces:
  - `verifyCredentials(db, portalId: string, password: string): Promise<User | null>`
  - `getSession(): Promise<IronSession<SessionData>>` with `SessionData = { userId?: number }` (no `role` — role is always re-read from the DB, see Task 8's `actorFromRequest`)
  - Routes: `POST /api/v1/auth/login {portalId, password}` → sets cookie; `POST /api/v1/auth/logout`; `GET /api/v1/auth/me`
  - `npm run seed users.csv` — CSV lines `portalId,name,role,password`

**IT Portal investigation (spike, timeboxed 30min):** before implementing, ask Hansol for IT Portal auth details (does it expose a login API or DB we can verify credentials against?). If yes → `verifyCredentials` internals call the portal and `passwordHash` stays unused. If no/unclear → ship the local-hash fallback below (portal IDs shared as account names, passwords set by seed script). Either way the function signature is identical — the swap later touches only this function body.

- [ ] **Step 1: Write failing tests (local-hash fallback path)**

`tests/domain/auth.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest'
import bcrypt from 'bcryptjs'
import { createTestDb, seedUser } from '../helpers/db'
import { verifyCredentials } from '@/lib/auth'
import type { Db } from '@/db/client'

let db: Db

beforeAll(async () => {
  db = await createTestDb()
  await seedUser(db, { portalId: 'hansol', passwordHash: bcrypt.hashSync('anchor123', 10) })
  await seedUser(db, { portalId: 'nopass', passwordHash: null })
})

describe('verifyCredentials', () => {
  it('returns the user on correct password', async () => {
    const user = await verifyCredentials(db, 'hansol', 'anchor123')
    expect(user?.portalId).toBe('hansol')
  })
  it('returns null on wrong password, unknown id, or unset password', async () => {
    expect(await verifyCredentials(db, 'hansol', 'wrong')).toBeNull()
    expect(await verifyCredentials(db, 'ghost', 'x')).toBeNull()
    expect(await verifyCredentials(db, 'nopass', '')).toBeNull()
  })
})
```

Run: `npm test tests/domain/auth.test.ts` → Expected: FAIL.

- [ ] **Step 2: Implement auth lib + routes + seed script**

`src/lib/auth.ts`:
```ts
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { users, type User } from '@/db/schema'
import type { Db } from '@/db/client'

// Constant valid bcrypt hash so unknown users / no-password accounts pay the
// same bcrypt.compare cost as a real wrong-password check. Not a secret.
const TIMING_EQUALIZER_HASH = '$2b$10$ZNBUlTnuhyXuUGJtdSQLDume0eEKcddP8Gy.dFggC8U2y7RGZeRVG'

// ponytail: local hashes now; IT Portal 연동이 확정되면 이 함수 내부만 교체
export async function verifyCredentials(db: Db, portalId: string, password: string): Promise<User | null> {
  if (password.length === 0) return null
  const [user] = await db.select().from(users).where(eq(users.portalId, portalId))
  const match = await bcrypt.compare(password, user?.passwordHash ?? TIMING_EQUALIZER_HASH)
  return user?.passwordHash && match ? user : null
}
```

`src/lib/session.ts`:
```ts
import { getIronSession, type IronSession } from 'iron-session'
import { cookies } from 'next/headers'

// Role is deliberately not stored here: it must always come from a fresh DB
// read (see src/lib/api-auth.ts) so a demoted/deleted user loses authority
// immediately instead of at cookie expiry. Keep this to just the identifier.
export type SessionData = { userId?: number }

export async function getSession(): Promise<IronSession<SessionData>> {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET not configured')
  return getIronSession<SessionData>(await cookies(), {
    cookieName: 'rudder_session',
    password: secret,
    cookieOptions: { secure: process.env.NODE_ENV === 'production' },
  })
}
```

`src/app/api/v1/auth/login/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { getDb } from '@/db/client'
import { verifyCredentials } from '@/lib/auth'
import { getSession } from '@/lib/session'
import { loginSchema } from '@/lib/validation'
import { withErrorEnvelope } from '@/lib/with-error-envelope'

export const POST = withErrorEnvelope(async (req: Request) => {
  const parsed = loginSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: '입력값이 올바르지 않습니다' }, { status: 400 })
  const user = await verifyCredentials(getDb(), parsed.data.portalId, parsed.data.password)
  if (!user) return NextResponse.json({ ok: false, error: '아이디 또는 비밀번호가 올바르지 않습니다' }, { status: 401 })
  const session = await getSession()
  session.userId = user.id
  await session.save()
  return NextResponse.json({ ok: true, data: { id: user.id, portalId: user.portalId, name: user.name, role: user.role } })
})
```

`src/lib/with-error-envelope.ts`:
```ts
import { NextResponse } from 'next/server'

// Route handlers can throw (missing SESSION_SECRET, DB down, etc). Without
// this, Next.js returns its own HTML 500 page instead of our { ok, error }
// contract, which breaks every client built against that envelope.
export function withErrorEnvelope<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args)
    } catch (error) {
      console.error('request failed:', error)
      return NextResponse.json({ ok: false, error: '서버 오류가 발생했습니다' }, { status: 500 })
    }
  }
}
```

`src/app/api/v1/auth/logout/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { withErrorEnvelope } from '@/lib/with-error-envelope'

export const POST = withErrorEnvelope(async () => {
  const session = await getSession()
  session.destroy()
  return NextResponse.json({ ok: true, data: null })
})
```

`src/app/api/v1/auth/me/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { users } from '@/db/schema'
import { getSession } from '@/lib/session'
import { withErrorEnvelope } from '@/lib/with-error-envelope'

export const GET = withErrorEnvelope(async () => {
  const session = await getSession()
  if (!session.userId) return NextResponse.json({ ok: false, error: '로그인이 필요합니다' }, { status: 401 })
  const [user] = await getDb().select().from(users).where(eq(users.id, session.userId))
  if (!user) return NextResponse.json({ ok: false, error: '로그인이 필요합니다' }, { status: 401 })
  return NextResponse.json({ ok: true, data: { id: user.id, portalId: user.portalId, name: user.name, role: user.role } })
})
```
Task 9 creates `src/app/api/v1/respond.ts` for the wider API surface's response helpers; it wraps/points at `withErrorEnvelope` above rather than duplicating it.

Add to `src/lib/validation.ts` (create the file; later tasks extend it):
```ts
import { z } from 'zod'
import bcrypt from 'bcryptjs'

// bcrypt silently truncates at 72 bytes, so two different passwords past that
// point can authenticate as the same credential. Reject before that happens.
export function passwordExceedsBcryptLimit(password: string): boolean {
  return bcrypt.truncates(password)
}

export const loginSchema = z.object({
  portalId: z.string().min(1).max(100),
  password: z.string().min(1).max(200).refine(
    (password) => !passwordExceedsBcryptLimit(password),
    { error: '비밀번호가 너무 깁니다' },
  ),
})
```

`scripts/seed.ts`:
```ts
import fs from 'node:fs'
import bcrypt from 'bcryptjs'
import { getDb } from '@/db/client'
import { users } from '@/db/schema'
import { passwordExceedsBcryptLimit } from '@/lib/validation'

type SeedRow = { portalId: string; name: string; role: 'admin' | 'user'; password: string }

function parseLine(line: string): SeedRow {
  const fields = line.split(',').map((s) => s.trim())
  const [portalId, name, role, password] = fields
  if (fields.length !== 4 || !portalId || !name || (role !== 'admin' && role !== 'user') || !password) {
    throw new Error(`invalid line for portalId "${portalId || '(missing)'}"`)
  }
  if (passwordExceedsBcryptLimit(password)) {
    throw new Error(`password too long for portalId "${portalId}" (72바이트 초과)`)
  }
  return { portalId, name, role, password }
}

async function main() {
  const file = process.argv[2]
  if (!file) throw new Error('usage: npm run seed <users.csv>  (lines: portalId,name,role,password)')
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n')
  const rows = lines.map(parseLine)
  const db = getDb()
  await db.transaction(async (tx) => {
    for (const { portalId, name, role, password } of rows) {
      const passwordHash = bcrypt.hashSync(password, 10)
      await tx.insert(users)
        .values({ portalId, name, role, passwordHash })
        .onConflictDoUpdate({ target: users.portalId, set: { name, role, passwordHash } })
    }
  })
  process.stdout.write(`seeded ${rows.length} users\n`)
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
```
Validation happens for the whole file before any DB write (a malformed row anywhere rejects the entire run with nothing written), and everything that does get written happens inside one transaction as defense-in-depth against a mid-batch failure. Each row's bcrypt hash is computed once and reused for both the insert and the conflict-update path.

(`tsx` needs the alias: run via `tsx --tsconfig tsconfig.json`; if `@/` fails under tsx, use relative imports in scripts — scripts are allowed to import `../src/...`.)

- [ ] **Step 3: Run tests to verify pass**

Run: `npm test tests/domain/auth.test.ts` → Expected: PASS. Manual smoke: `docker compose up -d`, `npm run db:migrate`, seed a CSV, `npm run dev`, `curl -X POST localhost:3000/api/v1/auth/login -H 'content-type: application/json' -d '{"portalId":"...","password":"..."}'` → 200 + Set-Cookie.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add session auth with portal-swappable credential check and user seed script"
```

---

### Task 8: Agent Tokens & Unified Request Auth

**Files:**
- Create: `src/lib/api-auth.ts`, `scripts/create-token.ts`
- Test: `tests/domain/api-auth.test.ts`

**Interfaces:**
- Consumes: `apiTokens` table, `users` table, `getSession`, `Actor`
- Produces:
  - `actorFromRequest(db: Db, req: Request): Promise<Actor | null>` — Bearer token → `{ type: 'agent', id }`; else session cookie's `userId` is looked up fresh in `users` and the actor's `role` comes from that row (never from the cookie — `SessionData` no longer carries `role`, see Task 7); missing user or missing session → `null`
  - `hashToken(raw: string): string` (sha256 hex)
  - `npm run create-token <name>` — prints `rud_<48 hex>` once, stores only the hash

- [ ] **Step 1: Write failing tests**

`tests/domain/api-auth.test.ts`:
```ts
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { createTestDb } from '../helpers/db'
import { apiTokens } from '@/db/schema'
import { actorFromRequest, hashToken } from '@/lib/api-auth'
import type { Db } from '@/db/client'

vi.mock('@/lib/session', () => ({ getSession: async () => ({}) }))

let db: Db

beforeAll(async () => {
  db = await createTestDb()
  await db.insert(apiTokens).values({ name: '도선사-테스트', tokenHash: hashToken('rud_testtoken') })
})

describe('actorFromRequest', () => {
  it('resolves a valid bearer token to an agent actor', async () => {
    const req = new Request('http://x', { headers: { authorization: 'Bearer rud_testtoken' } })
    const actor = await actorFromRequest(db, req)
    expect(actor?.type).toBe('agent')
  })
  it('returns null for invalid token and empty session', async () => {
    const bad = new Request('http://x', { headers: { authorization: 'Bearer rud_wrong' } })
    expect(await actorFromRequest(db, bad)).toBeNull()
    expect(await actorFromRequest(db, new Request('http://x'))).toBeNull()
  })
})
```

Run: `npm test tests/domain/api-auth.test.ts` → Expected: FAIL.

- [ ] **Step 2: Implement**

`src/lib/api-auth.ts`:
```ts
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { apiTokens, users } from '@/db/schema'
import type { Db } from '@/db/client'
import type { Actor } from '@/domain/actor'
import { getSession } from './session'

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export async function actorFromRequest(db: Db, req: Request): Promise<Actor | null> {
  const header = req.headers.get('authorization')
  if (header && header.slice(0, 7).toLowerCase() === 'bearer ') {
    const [token] = await db.select().from(apiTokens)
      .where(eq(apiTokens.tokenHash, hashToken(header.slice(7))))
    if (!token) return null
    await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, token.id)).catch(() => null)
    return { type: 'agent', id: token.id }
  }
  const session = await getSession().catch(() => null)
  if (!session?.userId) return null
  // Role comes from the DB, not the cookie: a demoted or deleted user must
  // lose/change authority immediately, not wait out the session's lifetime.
  const [user] = await db.select().from(users).where(eq(users.id, session.userId))
  if (!user) return null
  return { type: 'user', id: user.id, role: user.role }
}
```

`scripts/create-token.ts`:
```ts
import { randomBytes } from 'node:crypto'
import { getDb } from '@/db/client'
import { apiTokens } from '@/db/schema'
import { hashToken } from '@/lib/api-auth'

async function main() {
  const name = process.argv[2]
  if (!name) throw new Error('usage: npm run create-token <name>')
  const raw = `rud_${randomBytes(24).toString('hex')}`
  await getDb().insert(apiTokens).values({ name, tokenHash: hashToken(raw) })
  process.stdout.write(`token for "${name}" (한 번만 표시됩니다):\n${raw}\n`)
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 3: Run tests to verify pass**

Run: `npm test tests/domain/api-auth.test.ts` → Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add agent API tokens and unified request auth"
```

---

### Task 9: Issues REST API

**Files:**
- Create: `src/app/api/v1/issues/route.ts`, `src/app/api/v1/issues/[id]/route.ts`, `src/app/api/v1/issues/[id]/transition/route.ts`, `src/app/api/v1/issues/[id]/reorder/route.ts`, `src/app/api/v1/issues/[id]/comments/route.ts`, `src/app/api/v1/issues/[id]/relations/route.ts`
- Modify: `src/lib/validation.ts` (add issue schemas)
- Test: `tests/api/issues.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 3-8
- Produces: the HTTP surface per the authorization matrix in the header. Response shapes: list → `{ ok: true, data: Issue[] }`; detail → `{ ok: true, data: { issue, comments, events, relations } }`; errors → `{ ok: false, error }` with 400 (validation) / 401 (no actor) / 403 (권한 없음) / 404 / 422 (domain rule).

- [ ] **Step 1: Add validation schemas**

Append to `src/lib/validation.ts`:
```ts
export const createIssueSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(10_000).optional(),
  type: z.enum(['bug', 'feature', 'improvement']),
  productId: z.number().int().positive(),
  requesterPortalId: z.string().min(1).max(100).optional(), // agents only
})

export const listIssuesSchema = z.object({
  status: z.enum(['inbox', 'backlog', 'in_progress', 'done', 'rejected', 'on_hold']).optional(),
  productId: z.coerce.number().int().positive().optional(),
  milestoneId: z.coerce.number().int().positive().optional(),
  requester: z.literal('me').optional(),
})

export const patchIssueSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(10_000).optional(),
  type: z.enum(['bug', 'feature', 'improvement']).optional(),
  productId: z.number().int().positive().optional(),
  assigneeId: z.number().int().positive().nullable().optional(),
  milestoneId: z.number().int().positive().nullable().optional(),
  priority: z.enum(['p0', 'p1', 'p2']).nullable().optional(),
})

export const transitionSchema = z.object({
  to: z.enum(['inbox', 'backlog', 'in_progress', 'done', 'rejected', 'on_hold']),
  priority: z.enum(['p0', 'p1', 'p2']).optional(),
  reason: z.string().max(2_000).optional(),
})

export const reorderSchema = z.object({
  afterId: z.number().int().positive().optional(),
  beforeId: z.number().int().positive().optional(),
}).refine((v) => v.afterId != null || v.beforeId != null, { message: 'afterId 또는 beforeId가 필요합니다' })

export const commentSchema = z.object({ body: z.string().min(1).max(10_000) })

export const relationSchema = z.object({
  relatedIssueId: z.number().int().positive(),
  kind: z.enum(['duplicate', 'relates', 'blocks']),
})
```

- [ ] **Step 2: Write failing API tests**

`tests/api/issues.test.ts` — mock the session module, drive routes as functions:
```ts
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { createTestDb, seedUser, seedProduct } from '../helpers/db'
import type { Db } from '@/db/client'
import type { User } from '@/db/schema'

const sessionState: { userId?: number; role?: 'admin' | 'user' } = {}
vi.mock('@/lib/session', () => ({ getSession: async () => sessionState }))

import { GET as listIssuesRoute, POST as createIssueRoute } from '@/app/api/v1/issues/route'
import { POST as transitionRoute } from '@/app/api/v1/issues/[id]/transition/route'

let db: Db
let adminUser: User
let plainUser: User
let productId: number

function asUser(u: User) { sessionState.userId = u.id; sessionState.role = u.role }
function loggedOut() { delete sessionState.userId; delete sessionState.role }
const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

beforeAll(async () => {
  db = await createTestDb()
  adminUser = await seedUser(db, { role: 'admin' })
  plainUser = await seedUser(db, { role: 'user' })
  productId = (await seedProduct(db)).id
})

describe('/api/v1/issues', () => {
  it('401s when logged out', async () => {
    loggedOut()
    const res = await createIssueRoute(new Request('http://x/api/v1/issues', json({ title: 't', type: 'bug', productId })))
    expect(res.status).toBe(401)
  })

  it('creates an issue as the session user (requester=self)', async () => {
    asUser(plainUser)
    const res = await createIssueRoute(new Request('http://x/api/v1/issues', json({ title: '통관 요청', type: 'feature', productId })))
    expect(res.status).toBe(201)
    const { data } = await res.json()
    expect(data.requesterId).toBe(plainUser.id)
    expect(data.status).toBe('inbox')
  })

  it('400s on invalid payload', async () => {
    asUser(plainUser)
    const res = await createIssueRoute(new Request('http://x/api/v1/issues', json({ title: '', type: 'nope' })))
    expect(res.status).toBe(400)
  })

  it('lists with status filter', async () => {
    asUser(plainUser)
    const res = await listIssuesRoute(new Request('http://x/api/v1/issues?status=inbox'))
    const { data } = await res.json()
    expect(data.every((i: { status: string }) => i.status === 'inbox')).toBe(true)
  })

  it('forbids transition for non-admin, allows for admin', async () => {
    asUser(plainUser)
    const createRes = await createIssueRoute(new Request('http://x/api/v1/issues', json({ title: '전이 대상', type: 'bug', productId })))
    const { data: issue } = await createRes.json()
    const forbidden = await transitionRoute(
      new Request(`http://x/api/v1/issues/${issue.id}/transition`, json({ to: 'backlog', priority: 'p1' })),
      { params: Promise.resolve({ id: String(issue.id) }) },
    )
    expect(forbidden.status).toBe(403)
    asUser(adminUser)
    const allowed = await transitionRoute(
      new Request(`http://x/api/v1/issues/${issue.id}/transition`, json({ to: 'backlog', priority: 'p1' })),
      { params: Promise.resolve({ id: String(issue.id) }) },
    )
    expect(allowed.status).toBe(200)
  })

  it('422s on an illegal transition', async () => {
    asUser(adminUser)
    const createRes = await createIssueRoute(new Request('http://x/api/v1/issues', json({ title: '불법 전이', type: 'bug', productId })))
    const { data: issue } = await createRes.json()
    const res = await transitionRoute(
      new Request(`http://x/api/v1/issues/${issue.id}/transition`, json({ to: 'done' })),
      { params: Promise.resolve({ id: String(issue.id) }) },
    )
    expect(res.status).toBe(422)
  })
})
```

Run: `npm test tests/api/issues.test.ts` → Expected: FAIL (routes missing).

- [ ] **Step 3: Implement routes**

Shared helpers — create `src/app/api/v1/respond.ts`:
```ts
import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { CONFLICT_ERROR } from '@/domain/issues'
import type { Db } from '@/db/client'
import { products, users, milestones } from '@/db/schema'

export const ok = (data: unknown, status = 200) => NextResponse.json({ ok: true, data }, { status })
export const fail = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status })
export const unauthorized = () => fail('로그인이 필요합니다', 401)
export const forbidden = () => fail('권한이 없습니다', 403)

// Postgres's `integer` column range. A value outside this crashes the query
// (error 22P02) instead of failing validation, surfacing as a 500.
const PG_INT_MAX = 2_147_483_647

// Canonical decimal digits only — `Number()` also accepts hex ("0x10"),
// exponent ("1e3"), and leading +/-, which is more than "a positive integer
// id" should mean for a path segment or query param. Bounded to PG_INT_MAX
// so an oversized id (e.g. a 24-digit string) can't reach the database.
function parsePgId(raw: string | null): number | null {
  if (raw == null || !/^[1-9]\d*$/.test(raw)) return null
  const n = Number(raw)
  return n <= PG_INT_MAX ? n : null
}

export async function idFromParams(params: Promise<{ id: string }>): Promise<number | null> {
  const { id } = await params
  return parsePgId(id)
}

export function idFromQuery(url: string, key: string): number | null {
  return parsePgId(new URL(url).searchParams.get(key))
}

// Existence checks, not FK-violation translation: a pre-check has a benign
// race (the row could vanish between check and insert) ONLY if something can
// delete it, and Phase 1 has no endpoint that deletes a product, user, or
// milestone. If one is ever added, these checks inherit that race and need
// revisiting (or the insert's FK violation needs translating instead).
export async function productExists(db: Db, id: number): Promise<boolean> {
  const [row] = await db.select({ id: products.id }).from(products).where(eq(products.id, id))
  return row != null
}
export async function userExists(db: Db, id: number): Promise<boolean> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, id))
  return row != null
}
export async function milestoneExists(db: Db, id: number): Promise<boolean> {
  const [row] = await db.select({ id: milestones.id }).from(milestones).where(eq(milestones.id, id))
  return row != null
}
```

`domainErrorStatus` (also in `respond.ts`, added post-review) maps a domain
`{ ok: false, error }` string to its HTTP status: the exact `CONFLICT_ERROR`
string → 409, anything containing `찾을 수 없습니다` → 404, else 422.

`src/app/api/v1/issues/route.ts`:
```ts
import { eq } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { users } from '@/db/schema'
import { actorFromRequest } from '@/lib/api-auth'
import { createIssueSchema, listIssuesSchema } from '@/lib/validation'
import { createIssue, listIssues } from '@/domain/issues'
import { ok, fail, unauthorized, productExists } from '../respond'

export async function GET(req: Request) {
  const db = getDb()
  const actor = await actorFromRequest(db, req)
  if (!actor) return unauthorized()
  const raw = Object.fromEntries(new URL(req.url).searchParams)
  const parsed = listIssuesSchema.safeParse(raw)
  if (!parsed.success) return fail('검색 조건이 올바르지 않습니다', 400)
  const { requester, ...filter } = parsed.data
  const requesterId = requester === 'me' && actor.type === 'user' ? actor.id : undefined
  return ok(await listIssues(db, { ...filter, requesterId }))
}

export async function POST(req: Request) {
  const db = getDb()
  const actor = await actorFromRequest(db, req)
  if (!actor) return unauthorized()
  const parsed = createIssueSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail('입력값이 올바르지 않습니다', 400)
  const { requesterPortalId, ...input } = parsed.data
  if (!(await productExists(db, input.productId))) {
    return fail(`제품을 찾을 수 없습니다: ${input.productId}`, 422)
  }
  let requesterId: number
  if (actor.type === 'agent') {
    if (!requesterPortalId) return fail('에이전트 등록에는 requesterPortalId가 필요합니다', 400)
    const [requester] = await db.select().from(users).where(eq(users.portalId, requesterPortalId))
    if (!requester) return fail(`요청자 계정을 찾을 수 없습니다: ${requesterPortalId}`, 422)
    requesterId = requester.id
  } else {
    requesterId = actor.id
  }
  const issue = await createIssue(db, actor, { ...input, requesterId })
  return ok(issue, 201)
}
```

`src/app/api/v1/issues/[id]/route.ts`:
```ts
import { getDb } from '@/db/client'
import { actorFromRequest } from '@/lib/api-auth'
import { patchIssueSchema } from '@/lib/validation'
import { getIssueDetail, updateIssue } from '@/domain/issues'
import {
  ok, fail, unauthorized, forbidden, idFromParams, domainErrorStatus,
  productExists, userExists, milestoneExists,
} from '../../respond'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: Ctx) {
  const db = getDb()
  const actor = await actorFromRequest(db, req)
  if (!actor) return unauthorized()
  const id = await idFromParams(ctx.params)
  if (!id) return fail('이슈를 찾을 수 없습니다', 404)
  const detail = await getIssueDetail(db, id)
  return detail ? ok(detail) : fail('이슈를 찾을 수 없습니다', 404)
}

export async function PATCH(req: Request, ctx: Ctx) {
  const db = getDb()
  const actor = await actorFromRequest(db, req)
  if (!actor || actor.type === 'agent') return actor ? forbidden() : unauthorized()
  const id = await idFromParams(ctx.params)
  if (!id) return fail('이슈를 찾을 수 없습니다', 404)
  const parsed = patchIssueSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail('입력값이 올바르지 않습니다', 400)
  if (actor.role !== 'admin') {
    const detail = await getIssueDetail(db, id)
    if (!detail) return fail('이슈를 찾을 수 없습니다', 404)
    const requestedFields = Object.keys(parsed.data)
    const allowed = requestedFields.every((f) => f === 'title' || f === 'description')
    if (detail.issue.requesterId !== actor.id || !allowed) return forbidden()
  }
  // Existence checks, not FK-violation translation — see the comment on
  // productExists in respond.ts for why a pre-check is sufficient here.
  if (parsed.data.productId != null && !(await productExists(db, parsed.data.productId))) {
    return fail(`제품을 찾을 수 없습니다: ${parsed.data.productId}`, 422)
  }
  if (parsed.data.assigneeId != null && !(await userExists(db, parsed.data.assigneeId))) {
    return fail(`담당자를 찾을 수 없습니다: ${parsed.data.assigneeId}`, 422)
  }
  if (parsed.data.milestoneId != null && !(await milestoneExists(db, parsed.data.milestoneId))) {
    return fail(`마일스톤을 찾을 수 없습니다: ${parsed.data.milestoneId}`, 422)
  }
  const result = await updateIssue(db, actor, id, parsed.data)
  return result.ok ? ok(result.issue) : fail(result.error, domainErrorStatus(result.error))
}
```

`src/app/api/v1/issues/[id]/transition/route.ts`:
```ts
import { getDb } from '@/db/client'
import { actorFromRequest } from '@/lib/api-auth'
import { transitionSchema } from '@/lib/validation'
import { transitionIssue } from '@/domain/issues'
import { ok, fail, unauthorized, forbidden, idFromParams } from '../../../respond'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const db = getDb()
  const actor = await actorFromRequest(db, req)
  if (!actor) return unauthorized()
  if (actor.type !== 'user' || actor.role !== 'admin') return forbidden()
  const id = await idFromParams(ctx.params)
  if (!id) return fail('이슈를 찾을 수 없습니다', 404)
  const parsed = transitionSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail('입력값이 올바르지 않습니다', 400)
  const result = await transitionIssue(db, actor, id, parsed.data)
  if (!result.ok) return fail(result.error, result.error.includes('찾을 수 없습니다') ? 404 : 422)
  return ok(result.issue)
}
```

`src/app/api/v1/issues/[id]/reorder/route.ts` — identical shape to transition: admin-only guard, `reorderSchema`, call `reorderIssue(db, actor, id, parsed.data)`, map `{ok:false}` with '찾을 수 없습니다' → 404 else 422.

```ts
import { getDb } from '@/db/client'
import { actorFromRequest } from '@/lib/api-auth'
import { reorderSchema } from '@/lib/validation'
import { reorderIssue } from '@/domain/ordering'
import { ok, fail, unauthorized, forbidden, idFromParams } from '../../../respond'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const db = getDb()
  const actor = await actorFromRequest(db, req)
  if (!actor) return unauthorized()
  if (actor.type !== 'user' || actor.role !== 'admin') return forbidden()
  const id = await idFromParams(ctx.params)
  if (!id) return fail('이슈를 찾을 수 없습니다', 404)
  const parsed = reorderSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail('afterId 또는 beforeId가 필요합니다', 400)
  const result = await reorderIssue(db, actor, id, parsed.data)
  if (!result.ok) return fail(result.error, result.error.includes('찾을 수 없습니다') ? 404 : 422)
  return ok(result.issue)
}
```

`src/app/api/v1/issues/[id]/comments/route.ts`:
```ts
import { getDb } from '@/db/client'
import { actorFromRequest } from '@/lib/api-auth'
import { commentSchema } from '@/lib/validation'
import { addComment } from '@/domain/collab'
import { ok, fail, unauthorized, forbidden, idFromParams } from '../../../respond'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const db = getDb()
  const actor = await actorFromRequest(db, req)
  if (!actor) return unauthorized()
  if (actor.type === 'agent') return forbidden() // 도선사 댓글은 spec §10 이후
  const id = await idFromParams(ctx.params)
  if (!id) return fail('이슈를 찾을 수 없습니다', 404)
  const parsed = commentSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail('댓글 내용을 입력해주세요', 400)
  const result = await addComment(db, actor, id, parsed.data.body)
  return result.ok ? ok(result.comment, 201) : fail(result.error, 404)
}
```

`src/app/api/v1/issues/[id]/relations/route.ts`:
```ts
import { getDb } from '@/db/client'
import { actorFromRequest } from '@/lib/api-auth'
import { relationSchema } from '@/lib/validation'
import { addRelation, removeRelation } from '@/domain/collab'
import { ok, fail, unauthorized, forbidden, idFromParams, idFromQuery, domainErrorStatus } from '../../../respond'

type Ctx = { params: Promise<{ id: string }> }

async function requireAdmin(req: Request) {
  const db = getDb()
  const actor = await actorFromRequest(db, req)
  if (!actor) return { error: unauthorized() } as const
  if (actor.type !== 'user' || actor.role !== 'admin') return { error: forbidden() } as const
  return { db, actor } as const
}

export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireAdmin(req)
  if ('error' in auth) return auth.error
  const id = await idFromParams(ctx.params)
  if (!id) return fail('이슈를 찾을 수 없습니다', 404)
  const parsed = relationSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail('입력값이 올바르지 않습니다', 400)
  const result = await addRelation(auth.db, auth.actor, id, parsed.data.relatedIssueId, parsed.data.kind)
  return result.ok ? ok(null, 201) : fail(result.error, 422)
}

export async function DELETE(req: Request, ctx: Ctx) {
  const auth = await requireAdmin(req)
  if ('error' in auth) return auth.error
  const id = await idFromParams(ctx.params)
  if (!id) return fail('이슈를 찾을 수 없습니다', 404)
  const relationId = idFromQuery(req.url, 'relationId')
  if (!relationId) return fail('relationId가 필요합니다', 400)
  // issueId is part of removeRelation's own WHERE clause (atomic), so a
  // relation that belongs to a different issue than :id simply isn't found.
  const result = await removeRelation(auth.db, auth.actor, id, relationId)
  return result.ok ? ok(null) : fail(result.error, domainErrorStatus(result.error))
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test tests/api/issues.test.ts` → Expected: PASS (6 tests). Then the full suite `npm test` → all green.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add issues REST API with role/agent authorization"
```

---

### Task 10: Products, Milestones, Roadmap API

**Files:**
- Create: `src/domain/catalog.ts`, `src/app/api/v1/products/route.ts`, `src/app/api/v1/milestones/route.ts`, `src/app/api/v1/milestones/[id]/route.ts`, `src/app/api/v1/roadmap/route.ts`
- Modify: `src/lib/validation.ts`
- Test: `tests/domain/catalog.test.ts`, `tests/api/catalog.test.ts`

**Interfaces:**
- Consumes: Tasks 2-9
- Produces:
  - `createProduct(db, name): Promise<{ ok: true; product } | { ok: false; error }>` (duplicate name → error)
  - `createMilestone(db, input: { name: string; startsOn?: Date; endsOn?: Date }): Promise<{ ok: true; milestone } | { ok: false; error }>`
  - `updateMilestone(db, id, patch: { name?: string; startsOn?: Date | null; endsOn?: Date | null; closed?: boolean }): Promise<{ ok: true; milestone } | { ok: false; error }>`
  - `getRoadmap(db): Promise<Array<{ milestone: Milestone; total: number; done: number; issues: Array<Pick<Issue, 'id' | 'title' | 'status' | 'priority' | 'productId'>> }>>` — ordered by milestone name; issues within by priority asc then id
  - Routes: `GET/POST /products` · `GET/POST /milestones` · `PATCH /milestones/:id` · `GET /roadmap` per the authorization matrix

- [ ] **Step 1: Write failing domain tests**

`tests/domain/catalog.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { createTestDb, seedUser, seedProduct } from '../helpers/db'
import { createIssue, transitionIssue, updateIssue } from '@/domain/issues'
import { createProduct, createMilestone, getRoadmap } from '@/domain/catalog'
import type { Db } from '@/db/client'
import type { Actor } from '@/domain/actor'

let db: Db
let admin: Actor

beforeAll(async () => {
  db = await createTestDb()
  const adminUser = await seedUser(db, { role: 'admin' })
  admin = { type: 'user', id: adminUser.id, role: 'admin' }
})

describe('catalog', () => {
  it('rejects duplicate product names', async () => {
    expect((await createProduct(db, 'lpa')).ok).toBe(true)
    expect((await createProduct(db, 'lpa')).ok).toBe(false)
  })

  it('computes roadmap progress per milestone', async () => {
    const requesterId = (await seedUser(db)).id
    const productId = (await seedProduct(db)).id
    const ms = await createMilestone(db, { name: '2026 Q3' })
    if (!ms.ok) throw new Error(ms.error)
    const mk = async (title: string) => {
      const issue = await createIssue(db, admin, { title, type: 'feature', productId, requesterId })
      await updateIssue(db, admin, issue.id, { milestoneId: ms.milestone.id })
      return issue
    }
    const one = await mk('완료될 화물')
    await mk('아직인 화물')
    await transitionIssue(db, admin, one.id, { to: 'backlog', priority: 'p0' })
    await transitionIssue(db, admin, one.id, { to: 'in_progress' })
    await transitionIssue(db, admin, one.id, { to: 'done' })
    const roadmap = await getRoadmap(db)
    const entry = roadmap.find((r) => r.milestone.name === '2026 Q3')
    expect(entry).toMatchObject({ total: 2, done: 1 })
  })
})
```

Run: `npm test tests/domain/catalog.test.ts` → Expected: FAIL.

- [ ] **Step 2: Implement domain**

`src/domain/catalog.ts`:
```ts
import { and, asc, eq, inArray, ne } from 'drizzle-orm'
import { issues, milestones, products } from '@/db/schema'
import type { Issue } from '@/db/schema'
import type { Db } from '@/db/client'

type Milestone = typeof milestones.$inferSelect
type Product = typeof products.$inferSelect

export async function createProduct(
  db: Db, name: string,
): Promise<{ ok: true; product: Product } | { ok: false; error: string }> {
  // onConflictDoNothing (not check-then-insert) so two concurrent identical
  // creates can't both pass the check and race the unique constraint.
  const [product] = await db.insert(products).values({ name })
    .onConflictDoNothing({ target: products.name }).returning()
  if (!product) return { ok: false, error: '이미 존재하는 제품입니다' }
  return { ok: true, product }
}

export async function createMilestone(
  db: Db, input: { name: string; startsOn?: Date; endsOn?: Date },
): Promise<{ ok: true; milestone: Milestone } | { ok: false; error: string }> {
  const [milestone] = await db.insert(milestones).values(input)
    .onConflictDoNothing({ target: milestones.name }).returning()
  if (!milestone) return { ok: false, error: '이미 존재하는 마일스톤입니다' }
  return { ok: true, milestone }
}

export async function updateMilestone(
  db: Db, id: number,
  patch: { name?: string; startsOn?: Date | null; endsOn?: Date | null; closed?: boolean },
): Promise<{ ok: true; milestone: Milestone } | { ok: false; error: string }> {
  const [existing] = await db.select().from(milestones).where(eq(milestones.id, id))
  if (!existing) return { ok: false, error: '마일스톤을 찾을 수 없습니다' }
  // drizzle's .set({}) throws before issuing SQL, so an all-optional empty
  // patch (a valid request) must short-circuit instead of reaching .update().
  if (Object.keys(patch).length === 0) return { ok: true, milestone: existing }
  if (patch.name !== undefined) {
    // ON CONFLICT has no UPDATE equivalent, so this is a pre-check (racy in
    // principle). Phase 1 has no milestone delete and only this path renames
    // one, so the window is narrow — revisit if either of those is added.
    const [conflict] = await db.select().from(milestones)
      .where(and(eq(milestones.name, patch.name), ne(milestones.id, id)))
    if (conflict) return { ok: false, error: '이미 존재하는 마일스톤입니다' }
  }
  const [milestone] = await db.update(milestones).set(patch).where(eq(milestones.id, id)).returning()
  return { ok: true, milestone }
}

// A missing priority ranks with p2 (lowest of the three): an unprioritized
// issue shouldn't outrank an explicitly p0/p1 one, and this avoids inventing
// a fourth rank below p2.
const PRIORITY_RANK = { p0: 0, p1: 1, p2: 2 } as const

export async function getRoadmap(db: Db) {
  const allMilestones = await db.select().from(milestones).orderBy(asc(milestones.name))
  if (allMilestones.length === 0) return []
  const assigned = await db.select().from(issues)
    .where(inArray(issues.milestoneId, allMilestones.map((m) => m.id)))
  const byMilestone = new Map<number, Issue[]>()
  for (const issue of assigned) {
    // inArray(issues.milestoneId, ...) guarantees non-null at runtime, but
    // the column type is still `number | null` — narrow instead of casting.
    if (issue.milestoneId == null) continue
    const list = byMilestone.get(issue.milestoneId) ?? []
    byMilestone.set(issue.milestoneId, [...list, issue])
  }
  return allMilestones.map((milestone) => {
    const group = [...(byMilestone.get(milestone.id) ?? [])].sort((a, b) =>
      (PRIORITY_RANK[a.priority ?? 'p2'] - PRIORITY_RANK[b.priority ?? 'p2']) || a.id - b.id)
    return {
      milestone,
      total: group.length,
      done: group.filter((i) => i.status === 'done').length,
      issues: group.map(({ id, title, status, priority, productId }) => ({ id, title, status, priority, productId })),
    }
  })
}
```

- [ ] **Step 3: Add validation + routes and failing API test**

Append to `src/lib/validation.ts`:
```ts
export const createProductSchema = z.object({ name: z.string().min(1).max(100) })

// z.coerce.date() accepts numbers/booleans/null (all silently become epoch-ish
// dates) and rolls calendar-impossible strings forward (e.g. Feb 30 -> Mar 2)
// instead of rejecting them. z.iso.date() only accepts a strict, calendar-
// validated YYYY-MM-DD string, so both classes of bad input are caught before
// they ever become a Date.
const isoDate = z.iso.date().transform((s) => new Date(s))

// Only meaningful when both ends are concrete dates in *this* payload — a
// PATCH that omits or nulls one side can't be range-checked against a value
// that lives only in the DB.
const validDateRange = (v: { startsOn?: Date | null; endsOn?: Date | null }) =>
  !(v.startsOn instanceof Date && v.endsOn instanceof Date) || v.startsOn <= v.endsOn

export const createMilestoneSchema = z.object({
  name: z.string().min(1).max(100),
  // Not nullable: `startsOn: null` on create isn't "no date", it's malformed
  // input, and shouldn't silently mean epoch.
  startsOn: isoDate.optional(),
  endsOn: isoDate.optional(),
}).refine(validDateRange, { error: '시작일은 종료일보다 늦을 수 없습니다', path: ['endsOn'] })

export const patchMilestoneSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  // Nullable here only: clearing a date is a legitimate patch operation.
  startsOn: isoDate.nullable().optional(),
  endsOn: isoDate.nullable().optional(),
  closed: z.boolean().optional(),
}).refine(validDateRange, { error: '시작일은 종료일보다 늦을 수 없습니다', path: ['endsOn'] })
```

`src/app/api/v1/products/route.ts`:
```ts
import { asc } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { products } from '@/db/schema'
import { actorFromRequest } from '@/lib/api-auth'
import { createProductSchema } from '@/lib/validation'
import { createProduct } from '@/domain/catalog'
import { ok, fail, unauthorized, forbidden } from '../respond'

export async function GET(req: Request) {
  const db = getDb()
  if (!(await actorFromRequest(db, req))) return unauthorized()
  return ok(await db.select().from(products).orderBy(asc(products.name)))
}

export async function POST(req: Request) {
  const db = getDb()
  const actor = await actorFromRequest(db, req)
  if (!actor) return unauthorized()
  if (actor.type !== 'user' || actor.role !== 'admin') return forbidden()
  const parsed = createProductSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail('제품 이름을 입력해주세요', 400)
  const result = await createProduct(db, parsed.data.name)
  return result.ok ? ok(result.product, 201) : fail(result.error, 422)
}
```

`src/app/api/v1/milestones/route.ts` — same shape: GET lists `milestones` ordered by name (any actor); POST admin-only, `createMilestoneSchema`, `createMilestone`, 201/422.

```ts
import { asc } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { milestones } from '@/db/schema'
import { actorFromRequest } from '@/lib/api-auth'
import { createMilestoneSchema } from '@/lib/validation'
import { createMilestone } from '@/domain/catalog'
import { ok, fail, unauthorized, forbidden } from '../respond'

export async function GET(req: Request) {
  const db = getDb()
  if (!(await actorFromRequest(db, req))) return unauthorized()
  return ok(await db.select().from(milestones).orderBy(asc(milestones.name)))
}

export async function POST(req: Request) {
  const db = getDb()
  const actor = await actorFromRequest(db, req)
  if (!actor) return unauthorized()
  if (actor.type !== 'user' || actor.role !== 'admin') return forbidden()
  const parsed = createMilestoneSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail('마일스톤 이름을 입력해주세요', 400)
  const result = await createMilestone(db, parsed.data)
  return result.ok ? ok(result.milestone, 201) : fail(result.error, 422)
}
```

`src/app/api/v1/milestones/[id]/route.ts`:
```ts
import { getDb } from '@/db/client'
import { actorFromRequest } from '@/lib/api-auth'
import { patchMilestoneSchema } from '@/lib/validation'
import { updateMilestone } from '@/domain/catalog'
import { ok, fail, unauthorized, forbidden, idFromParams } from '../../respond'

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const db = getDb()
  const actor = await actorFromRequest(db, req)
  if (!actor) return unauthorized()
  if (actor.type !== 'user' || actor.role !== 'admin') return forbidden()
  const id = await idFromParams(ctx.params)
  if (!id) return fail('마일스톤을 찾을 수 없습니다', 404)
  const parsed = patchMilestoneSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail('입력값이 올바르지 않습니다', 400)
  const result = await updateMilestone(db, id, parsed.data)
  return result.ok ? ok(result.milestone) : fail(result.error, 404)
}
```

`src/app/api/v1/roadmap/route.ts`:
```ts
import { getDb } from '@/db/client'
import { actorFromRequest } from '@/lib/api-auth'
import { getRoadmap } from '@/domain/catalog'
import { ok, unauthorized } from '../respond'

export async function GET(req: Request) {
  const db = getDb()
  if (!(await actorFromRequest(db, req))) return unauthorized()
  return ok(await getRoadmap(db))
}
```

`tests/api/catalog.test.ts`:
```ts
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { createTestDb, seedUser } from '../helpers/db'
import type { Db } from '@/db/client'
import type { User } from '@/db/schema'

const sessionState: { userId?: number; role?: 'admin' | 'user' } = {}
vi.mock('@/lib/session', () => ({ getSession: async () => sessionState }))

import { POST as createProductRoute } from '@/app/api/v1/products/route'
import { GET as roadmapRoute } from '@/app/api/v1/roadmap/route'

let db: Db
let adminUser: User
let plainUser: User
const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

beforeAll(async () => {
  db = await createTestDb()
  adminUser = await seedUser(db, { role: 'admin' })
  plainUser = await seedUser(db, { role: 'user' })
})

describe('catalog API', () => {
  it('non-admin cannot create a product; admin can', async () => {
    sessionState.userId = plainUser.id; sessionState.role = 'user'
    const forbidden = await createProductRoute(new Request('http://x/api/v1/products', json({ name: 'partslink' })))
    expect(forbidden.status).toBe(403)
    sessionState.userId = adminUser.id; sessionState.role = 'admin'
    const created = await createProductRoute(new Request('http://x/api/v1/products', json({ name: 'partslink' })))
    expect(created.status).toBe(201)
  })

  it('roadmap requires auth and returns milestone groups', async () => {
    delete sessionState.userId; delete sessionState.role
    expect((await roadmapRoute(new Request('http://x/api/v1/roadmap'))).status).toBe(401)
    sessionState.userId = adminUser.id; sessionState.role = 'admin'
    const res = await roadmapRoute(new Request('http://x/api/v1/roadmap'))
    expect(res.status).toBe(200)
    expect(Array.isArray((await res.json()).data)).toBe(true)
  })
})
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test` → Expected: full suite PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add products, milestones, and roadmap API"
```

---

### Task 11: Phase Gate — Coverage & Smoke

**Files:**
- Modify: none expected (fix whatever the gate finds)

**Interfaces:**
- Consumes: everything above
- Produces: green suite with coverage thresholds met; a locally runnable API

- [ ] **Step 1: Run coverage**

Run: `npm test -- --coverage`
Expected: PASS with lines/functions/branches ≥ 80% on `src/domain/**` and `src/lib/**`. If below: add tests for the uncovered branches (likely error paths in routes' domain calls) — do not lower thresholds.

- [ ] **Step 2: End-to-end local smoke (real Postgres, real HTTP)**

```bash
docker compose up -d
npm run db:migrate
printf 'hansol,김한솔,admin,changeme' > /tmp/seed-users.csv && npm run seed /tmp/seed-users.csv
npm run create-token slack-bot
npm run dev &
# login → cookie
curl -s -c /tmp/rudder.jar -X POST localhost:3000/api/v1/auth/login -H 'content-type: application/json' -d '{"portalId":"hansol","password":"changeme"}'
# create product + issue → groom → verify roadmap/backlog
curl -s -b /tmp/rudder.jar -X POST localhost:3000/api/v1/products -H 'content-type: application/json' -d '{"name":"<internal-dashboard>"}'
curl -s -b /tmp/rudder.jar -X POST localhost:3000/api/v1/issues -H 'content-type: application/json' -d '{"title":"스모크 화물","type":"bug","productId":1}'
curl -s -b /tmp/rudder.jar -X POST localhost:3000/api/v1/issues/1/transition -H 'content-type: application/json' -d '{"to":"backlog","priority":"p1"}'
# agent path with the minted token
curl -s -H "Authorization: Bearer rud_..." -X POST localhost:3000/api/v1/issues -H 'content-type: application/json' -d '{"title":"봇이 올린 화물","type":"feature","productId":1,"requesterPortalId":"hansol"}'
curl -s -b /tmp/rudder.jar 'localhost:3000/api/v1/issues?status=backlog'
```
Expected: every call returns `{ ok: true, ... }`; the agent-created issue's event log shows `actorType: 'agent'`.

- [ ] **Step 3: Commit any gate fixes**

```bash
git add -A && git commit -m "test: close coverage gaps found by phase gate"
```

---

## Plan Self-Review (done at authoring time)

1. **Spec coverage**: intake (web=API+UI later, agent ✅ Task 9, Slack → Phase 3), grooming gate ✅ T3/T4, priority+manual order ✅ T5, comments/history/relations ✅ T4/T6, products ✅ T10, milestones/roadmap ✅ T10, roles ✅ T7-T9, AI guardrails (§10: API parity, actor attribution, machine-readable events) ✅ T4/T8/T9. UI/attachments/Slack/deploy → Phases 2-3 (overview doc).
2. **Placeholder scan**: none; the two "same shape" route references include full code anyway.
3. **Type consistency**: `Actor` (T3) used by T4-T10; `validateTransition` signature matches T4's usage; `backlogEntrySortOrder` defined in T4-note and extended in T5 in the same file; result-object convention `{ok:...}` uniform.
