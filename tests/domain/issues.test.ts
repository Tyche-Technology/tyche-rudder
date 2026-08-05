import { describe, it, expect, beforeAll } from 'vitest'
import { createTestDb, seedUser, seedProduct } from '../helpers/db'
import { createIssue, transitionIssue, updateIssue, getIssueDetail, listIssues } from '@/domain/issues'
import { reorderIssue } from '@/domain/ordering'
import { issueEvents, issues, apiTokens, users } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
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
  productId = (await seedProduct(db, admin.id)).id
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
    const result = await transitionIssue(db, admin, issue.id, { to: 'backlog', priority: 'p0' }, issue.version)
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
    const rejectedNoReason = await transitionIssue(db, admin, issue.id, { to: 'rejected' }, issue.version)
    expect(rejectedNoReason).toEqual({ ok: false, kind: 'rule', error: '반송/정박에는 사유가 필요합니다' })
    // The rule-violation attempt above never reached the version bump, so
    // issue.version is still current for this retry.
    const rejected = await transitionIssue(db, admin, issue.id, { to: 'rejected', reason: '중복 요청' }, issue.version)
    expect(rejected.ok && rejected.issue.reason === '중복 요청').toBe(true)
  })

  it('clears a stale reason when leaving on_hold back to backlog', async () => {
    const issue = await createIssue(db, admin, { title: '보류 해제 대상', type: 'bug', productId, requesterId })
    const parked = await transitionIssue(db, admin, issue.id, { to: 'backlog', priority: 'p2' }, issue.version)
    if (!parked.ok) throw new Error(parked.error)
    const held = await transitionIssue(db, admin, issue.id, { to: 'on_hold', reason: '의존성 대기' }, parked.issue.version)
    if (!held.ok) throw new Error(held.error)
    const resumed = await transitionIssue(db, admin, issue.id, { to: 'backlog' }, held.issue.version)
    expect(resumed.ok && resumed.issue.reason === null).toBe(true)
  })

  it('updateIssue records one event per changed field, skips unchanged', async () => {
    const issue = await createIssue(db, admin, { title: '수정 대상', type: 'bug', productId, requesterId })
    const result = await updateIssue(db, admin, issue.id, { title: '수정 완료', type: 'bug' }, issue.version)
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

  it('records an agent-actor event with actorTokenId set and actorUserId null', async () => {
    const [token] = await db.insert(apiTokens)
      .values({ name: '테스트 토큰', tokenHash: `hash-${Math.random().toString(36).slice(2, 8)}` })
      .returning()
    const agent: Actor = { type: 'agent', id: token.id }
    const issue = await createIssue(db, agent, { title: '에이전트 생성 이슈', type: 'bug', productId, requesterId })
    const events = await db.select().from(issueEvents).where(eq(issueEvents.issueId, issue.id))
    expect(events[0]).toMatchObject({ actorType: 'agent', actorTokenId: token.id, actorUserId: null })
  })

  it('updateIssue rolls back the row change if the event insert fails mid-transaction', async () => {
    const issue = await createIssue(db, admin, { title: '롤백 확인', type: 'bug', productId, requesterId })
    const ghost: Actor = { type: 'user', id: 999_999, role: 'admin' }
    await expect(updateIssue(db, ghost, issue.id, { title: '롤백 시도' }, issue.version)).rejects.toThrow()
    const [row] = await db.select().from(issues).where(eq(issues.id, issue.id))
    expect(row.title).toBe('롤백 확인')
  })

  it('transitionIssue rolls back the status change if the event insert fails mid-transaction', async () => {
    const issue = await createIssue(db, admin, { title: '전이 롤백 확인', type: 'bug', productId, requesterId })
    const ghost: Actor = { type: 'user', id: 999_999, role: 'admin' }
    await expect(transitionIssue(db, ghost, issue.id, { to: 'backlog', priority: 'p1' }, issue.version)).rejects.toThrow()
    const [row] = await db.select().from(issues).where(eq(issues.id, issue.id))
    expect(row.status).toBe('inbox')
  })

  it('createIssue leaves no issue row if the created-event insert fails mid-transaction', async () => {
    const ghost: Actor = { type: 'user', id: 999_999, role: 'admin' }
    await expect(
      createIssue(db, ghost, { title: '유령 생성 시도', type: 'bug', productId, requesterId }),
    ).rejects.toThrow()
    const rows = await db.select().from(issues).where(eq(issues.title, '유령 생성 시도'))
    expect(rows).toHaveLength(0)
  })

  it('updateIssue records null (not an empty string) when a nullable field is cleared', async () => {
    const issue = await createIssue(db, admin, { title: '담당자 해제 대상', type: 'bug', productId, requesterId })
    const assigned = await updateIssue(db, admin, issue.id, { assigneeId: requesterId }, issue.version)
    if (!assigned.ok) throw new Error(assigned.error)
    const cleared = await updateIssue(db, admin, issue.id, { assigneeId: null }, assigned.issue.version)
    expect(cleared.ok).toBe(true)
    const events = await db.select().from(issueEvents)
      .where(and(eq(issueEvents.issueId, issue.id), eq(issueEvents.field, 'assignee_id')))
    const clearEvent = events.find((e) => e.newValue === null)
    expect(clearEvent).toBeDefined()
    expect(clearEvent?.oldValue).toBe(String(requesterId))
  })

  // assigneeId is admin-only over HTTP today and assignableUsers() filters the
  // picker, so this guard is defense in depth on a column with an FK to a
  // bannable table — it keeps the invariant true for whatever path is added
  // next, and turns a raw 23503 into a domain error.
  it('updateIssue refuses to assign a banned user, and still allows unassigning one', async () => {
    const banned = await seedUser(db, { name: '정지된 선원', banned: true })
    const issue = await createIssue(db, admin, { title: '정지자 배정 시도', type: 'bug', productId, requesterId })

    const refused = await updateIssue(db, admin, issue.id, { assigneeId: banned.id }, issue.version)
    expect(refused.ok).toBe(false)
    if (refused.ok) throw new Error('expected a refusal')
    expect(refused.kind).toBe('rule')

    // The refusal must not have written anything — version and row unchanged.
    const [after] = await db.select().from(issues).where(eq(issues.id, issue.id))
    expect(after.assigneeId).toBeNull()
    expect(after.version).toBe(issue.version)

    // A member banned AFTER being assigned must still be removable, or the
    // issue is stuck with an assignee nobody can clear.
    await db.update(users).set({ banned: false }).where(eq(users.id, banned.id))
    const assigned = await updateIssue(db, admin, issue.id, { assigneeId: banned.id }, issue.version)
    if (!assigned.ok) throw new Error(assigned.error)
    await db.update(users).set({ banned: true }).where(eq(users.id, banned.id))
    const cleared = await updateIssue(db, admin, issue.id, { assigneeId: null }, assigned.issue.version)
    expect(cleared.ok).toBe(true)
  })

  it('updateIssue refuses an assigneeId that matches no user', async () => {
    const issue = await createIssue(db, admin, { title: '유령 배정 시도', type: 'bug', productId, requesterId })
    const result = await updateIssue(db, admin, issue.id, { assigneeId: 999_999 }, issue.version)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a refusal')
    expect(result.kind).toBe('rule')
  })

  it('listIssues breaks backlog sortOrder ties by ascending id (oldest-inserted first)', async () => {
    const a = await createIssue(db, admin, { title: '정렬 동률 A', type: 'bug', productId, requesterId })
    const b = await createIssue(db, admin, { title: '정렬 동률 B', type: 'bug', productId, requesterId })
    await transitionIssue(db, admin, a.id, { to: 'backlog', priority: 'p1' }, a.version)
    await transitionIssue(db, admin, b.id, { to: 'backlog', priority: 'p1' }, b.version)
    await db.update(issues).set({ sortOrder: 5000 }).where(eq(issues.id, a.id))
    await db.update(issues).set({ sortOrder: 5000 }).where(eq(issues.id, b.id))
    const list = await listIssues(db, { status: 'backlog' })
    const tied = list.filter((i) => i.id === a.id || i.id === b.id)
    expect(tied.map((i) => i.id)).toEqual([a.id, b.id].sort((x, y) => x - y))
  })

  it('listIssues breaks non-backlog createdAt ties by descending id (newest-inserted first)', async () => {
    const a = await createIssue(db, admin, { title: '생성일 동률 A', type: 'bug', productId, requesterId })
    const b = await createIssue(db, admin, { title: '생성일 동률 B', type: 'bug', productId, requesterId })
    const sameInstant = new Date()
    await db.update(issues).set({ createdAt: sameInstant }).where(eq(issues.id, a.id))
    await db.update(issues).set({ createdAt: sameInstant }).where(eq(issues.id, b.id))
    const list = await listIssues(db, { requesterId })
    const tied = list.filter((i) => i.id === a.id || i.id === b.id)
    expect(tied.map((i) => i.id)).toEqual([a.id, b.id].sort((x, y) => y - x))
  })

  it('updateIssue records events under the snake_case column name, not the TS property name', async () => {
    const issue = await createIssue(db, admin, { title: '필드명 확인 대상', type: 'bug', productId, requesterId })
    await updateIssue(db, admin, issue.id, { productId, assigneeId: requesterId, milestoneId: null }, issue.version)
    const events = await db.select().from(issueEvents).where(eq(issueEvents.issueId, issue.id))
    const fields = events.map((e) => e.field)
    expect(fields).toContain('assignee_id')
    expect(fields).not.toContain('assigneeId')
  })

  it('clears sortOrder on backlog exit so a returning issue cannot land on another issue\'s parked slot', async () => {
    const a = await createIssue(db, admin, { title: '슬롯 A', type: 'bug', productId, requesterId })
    const b = await createIssue(db, admin, { title: '슬롯 B', type: 'bug', productId, requesterId })
    const c = await createIssue(db, admin, { title: '슬롯 C', type: 'bug', productId, requesterId })
    await transitionIssue(db, admin, a.id, { to: 'backlog', priority: 'p1' }, a.version)
    const bBacklogged = await transitionIssue(db, admin, b.id, { to: 'backlog', priority: 'p1' }, b.version)
    if (!bBacklogged.ok) throw new Error(bBacklogged.error)
    const cBacklogged = await transitionIssue(db, admin, c.id, { to: 'backlog', priority: 'p1' }, c.version)
    if (!cBacklogged.ok) throw new Error(cBacklogged.error)

    // B starts work: leaving the backlog must clear its parked slot.
    const started = await transitionIssue(db, admin, b.id, { to: 'in_progress' }, bBacklogged.issue.version)
    expect(started.ok && started.issue.sortOrder).toBeNull()
    if (!started.ok) throw new Error(started.error)

    // Admin reorders the rest of the backlog while B is out of it.
    const reordered = await reorderIssue(db, admin, c.id, { afterId: a.id }, cBacklogged.issue.version)
    expect(reordered.ok).toBe(true)

    // B comes back — it must append at the end, not resume its old (now
    // possibly reused) slot.
    const resumed = await transitionIssue(db, admin, b.id, { to: 'backlog' }, started.issue.version)
    expect(resumed.ok).toBe(true)

    const backlogList = await listIssues(db, { status: 'backlog' })
    const sortOrders = backlogList
      .filter((i) => [a.id, b.id, c.id].includes(i.id))
      .map((i) => i.sortOrder)
    expect(new Set(sortOrders).size).toBe(sortOrders.length)

    const sortOrderEvents = await db.select().from(issueEvents)
      .where(and(eq(issueEvents.issueId, b.id), eq(issueEvents.field, 'sort_order')))
    expect(sortOrderEvents).toHaveLength(1) // the clear on exit; entry/reorder don't get their own event
    expect(sortOrderEvents[0]).toMatchObject({ newValue: null })
  })

  it('updateIssue rejects a stale expectedVersion', async () => {
    const issue = await createIssue(db, admin, { title: '버전 충돌 대상', type: 'bug', productId, requesterId })
    await updateIssue(db, admin, issue.id, { title: '첫 번째 수정' }, issue.version)
    const stale = await updateIssue(db, admin, issue.id, { title: '두 번째 수정' }, issue.version)
    expect(!stale.ok && stale.kind).toBe('conflict')
  })

  it('transitionIssue rejects a stale expectedVersion', async () => {
    const issue = await createIssue(db, admin, { title: '전이 버전 충돌 대상', type: 'bug', productId, requesterId })
    await transitionIssue(db, admin, issue.id, { to: 'backlog', priority: 'p1' }, issue.version)
    const stale = await transitionIssue(db, admin, issue.id, { to: 'in_progress' }, issue.version)
    expect(!stale.ok && stale.kind).toBe('conflict')
  })

  // Pins the ordering the comment above the version check in updateIssue
  // names as its reason for existing: the version check must run BEFORE the
  // no-change shortcut, or a stale PATCH that happens to match the current
  // row's value would silently succeed instead of reporting the conflict.
  it('rejects a stale expectedVersion even when the patch changes nothing', async () => {
    const issue = await createIssue(db, admin, { title: '변경 없음 충돌 대상', type: 'bug', productId, requesterId })
    const bump = await updateIssue(db, admin, issue.id, { title: '한 번 수정' }, issue.version)
    if (!bump.ok) throw new Error(bump.error)
    // stale: real version is now 2, and the patch below matches the row's
    // current title exactly, so changed.length would be 0.
    const stale = await updateIssue(db, admin, issue.id, { title: bump.issue.title }, issue.version)
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.kind).toBe('conflict')
  })
})
