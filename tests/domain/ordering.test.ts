import { describe, it, expect, beforeAll } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { createTestDb, seedUser, seedProduct } from '../helpers/db'
import { createIssue, transitionIssue, listIssues } from '@/domain/issues'
import { reorderIssue } from '@/domain/ordering'
import { issueEvents, issues } from '@/db/schema'
import type { Db } from '@/db/client'
import type { Actor } from '@/domain/actor'
import type { Issue } from '@/db/schema'

let db: Db
let admin: Actor
let a: Issue, b: Issue, c: Issue

async function mkBacklogIssue(title: string): Promise<Issue> {
  const requesterId = (await seedUser(db)).id
  const productId = (await seedProduct(db, admin.id)).id
  const issue = await createIssue(db, admin, { title, type: 'feature', productId, requesterId })
  const r = await transitionIssue(db, admin, issue.id, { to: 'backlog', priority: 'p1' }, issue.version)
  if (!r.ok) throw new Error(r.error)
  return r.issue
}

beforeAll(async () => {
  db = await createTestDb()
  const adminUser = await seedUser(db, { role: 'admin' })
  admin = { type: 'user', id: adminUser.id, role: 'admin' }
  const requesterId = (await seedUser(db)).id
  const productId = (await seedProduct(db, admin.id)).id
  const mk = async (title: string) => {
    const issue = await createIssue(db, admin, { title, type: 'feature', productId, requesterId })
    const r = await transitionIssue(db, admin, issue.id, { to: 'backlog', priority: 'p1' }, issue.version)
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
    const result = await reorderIssue(db, admin, c.id, { afterId: a.id, beforeId: b.id }, c.version)
    expect(result.ok).toBe(true)
    const list = await listIssues(db, { status: 'backlog' })
    expect(list.map((i) => i.title)).toEqual(['A', 'C', 'B'])
  })

  it('moves B to the front with only beforeId', async () => {
    const result = await reorderIssue(db, admin, b.id, { beforeId: a.id }, b.version)
    expect(result.ok).toBe(true)
    const list = await listIssues(db, { status: 'backlog' })
    expect(list[0].title).toBe('B')
  })

  it('refuses to reorder a non-backlog issue', async () => {
    const requesterId = (await seedUser(db)).id
    const productId = (await seedProduct(db, admin.id)).id
    const inboxIssue = await createIssue(db, admin, { title: 'inbox만', type: 'bug', productId, requesterId })
    expect((await reorderIssue(db, admin, inboxIssue.id, { afterId: a.id }, inboxIssue.version)).ok).toBe(false)
  })

  it('renumbers when the gap between neighbours is squeezed below float precision', async () => {
    const d = await mkBacklogIssue('D')
    const e = await mkBacklogIssue('E')
    // Force a near-exhausted gap directly, rather than doing ~30 real midpoint
    // splits, so the test stays fast while still exercising the real guard.
    await db.update(issues).set({ sortOrder: 1000 }).where(eq(issues.id, d.id))
    await db.update(issues).set({ sortOrder: 1000 + 5e-7 }).where(eq(issues.id, e.id))
    const f = await mkBacklogIssue('F')

    const result = await reorderIssue(db, admin, f.id, { afterId: d.id, beforeId: e.id }, f.version)
    expect(result.ok).toBe(true)

    const list = await listIssues(db, { status: 'backlog' })
    const dIdx = list.findIndex((i) => i.id === d.id)
    const fIdx = list.findIndex((i) => i.id === f.id)
    const eIdx = list.findIndex((i) => i.id === e.id)
    expect(dIdx).toBeLessThan(fIdx)
    expect(fIdx).toBeLessThan(eIdx)

    const dOrder = list[dIdx].sortOrder
    const fOrder = list[fIdx].sortOrder
    if (dOrder == null || fOrder == null) throw new Error('backlog issues must have a sortOrder')
    // Renumbering resets everyone to clean ORDER_GAP multiples, so neighbours
    // are no longer a sub-micro gap apart. Confirms the renumber actually ran.
    expect(fOrder - dOrder).toBeGreaterThan(1)
  })

  it('rejects a contradictory afterId/beforeId pair instead of looping forever', async () => {
    const g = await mkBacklogIssue('G')
    const h = await mkBacklogIssue('H')
    // G entered the backlog before H, so G.sortOrder < H.sortOrder. Asking to
    // place a new issue after H but before G is contradictory: renumbering
    // preserves relative order, so a naive renumber-and-retry would recurse
    // on this same input forever instead of resolving it.
    const target = await mkBacklogIssue('I')
    const result = await reorderIssue(db, admin, target.id, { afterId: h.id, beforeId: g.id }, target.version)
    expect(result.ok).toBe(false)
  })

  it('places an issue after an anchor that already has a real successor, without colliding', async () => {
    const d2 = await mkBacklogIssue('D2')
    const e2 = await mkBacklogIssue('E2') // d2's real, adjacent successor
    const f2 = await mkBacklogIssue('F2')

    const result = await reorderIssue(db, admin, f2.id, { afterId: d2.id }, f2.version)
    expect(result.ok).toBe(true)

    const list = await listIssues(db, { status: 'backlog' })
    const dIdx = list.findIndex((i) => i.id === d2.id)
    const fIdx = list.findIndex((i) => i.id === f2.id)
    const eIdx = list.findIndex((i) => i.id === e2.id)
    expect(dIdx).toBeLessThan(fIdx)
    expect(fIdx).toBeLessThan(eIdx)
    // Naively landing on anchor + ORDER_GAP would tie with e2's own sortOrder
    // (also anchor + ORDER_GAP) instead of slotting between the two.
    expect(list[fIdx].sortOrder).not.toBe(list[eIdx].sortOrder)
  })

  it('places an issue before an anchor that already has a real predecessor, without colliding', async () => {
    const g2 = await mkBacklogIssue('G2')
    const h2 = await mkBacklogIssue('H2') // g2 is h2's real, adjacent predecessor
    const i2 = await mkBacklogIssue('I2')

    const result = await reorderIssue(db, admin, i2.id, { beforeId: h2.id }, i2.version)
    expect(result.ok).toBe(true)

    const list = await listIssues(db, { status: 'backlog' })
    const gIdx = list.findIndex((x) => x.id === g2.id)
    const iIdx = list.findIndex((x) => x.id === i2.id)
    const hIdx = list.findIndex((x) => x.id === h2.id)
    expect(gIdx).toBeLessThan(iIdx)
    expect(iIdx).toBeLessThan(hIdx)
    expect(list[iIdx].sortOrder).not.toBe(list[gIdx].sortOrder)
  })

  it('rejects an afterId that does not reference any issue', async () => {
    const target = await mkBacklogIssue('J2')
    const result = await reorderIssue(db, admin, target.id, { afterId: 999999 }, target.version)
    expect(result.ok).toBe(false)
  })

  it('rejects an afterId that exists but is not a backlog issue', async () => {
    // A plain inbox issue never got a sortOrder at all, so it wouldn't exercise the
    // status filter. Build the real risk instead: an issue that WAS in backlog (so it
    // has a real, non-null sortOrder) and then left backlog — transitionIssue does not
    // clear sortOrder on the way out, so a stale value remains on the row.
    const staleAnchor = await mkBacklogIssue('N2')
    const moved = await transitionIssue(db, admin, staleAnchor.id, { to: 'in_progress' }, staleAnchor.version)
    if (!moved.ok) throw new Error(moved.error)
    const target = await mkBacklogIssue('K2')
    const result = await reorderIssue(db, admin, target.id, { afterId: staleAnchor.id }, target.version)
    expect(result.ok).toBe(false)
  })

  it('returns an error when the issue to reorder does not exist', async () => {
    const result = await reorderIssue(db, admin, 999999, { afterId: a.id }, 1)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('이슈를 찾을 수 없습니다')
  })

  it('records a sort_order audit event with the old and new values', async () => {
    const l1 = await mkBacklogIssue('L2')
    const l2 = await mkBacklogIssue('M2')
    const oldSortOrder = l1.sortOrder

    const result = await reorderIssue(db, admin, l1.id, { beforeId: l2.id }, l1.version)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const events = await db.select().from(issueEvents)
      .where(and(eq(issueEvents.issueId, l1.id), eq(issueEvents.field, 'sort_order')))
    expect(events).toHaveLength(1)
    expect(events[0].oldValue).toBe(String(oldSortOrder ?? ''))
    expect(events[0].newValue).toBe(String(result.issue.sortOrder))
  })

  it('records a null old sortOrder as null, not an empty string', async () => {
    const n1 = await mkBacklogIssue('N3')
    const n2 = await mkBacklogIssue('O3')
    // transitionIssue always assigns a real sortOrder on backlog entry, so this state
    // isn't reachable through the app today — but the column is nullable, so force it
    // directly to prove the event write stays null-safe regardless.
    await db.update(issues).set({ sortOrder: null }).where(eq(issues.id, n1.id))

    const result = await reorderIssue(db, admin, n1.id, { beforeId: n2.id }, n1.version)
    expect(result.ok).toBe(true)

    const events = await db.select().from(issueEvents)
      .where(and(eq(issueEvents.issueId, n1.id), eq(issueEvents.field, 'sort_order')))
    expect(events).toHaveLength(1)
    expect(events[0].oldValue).toBeNull()
  })

  it('renumber tie-break matches listIssues (sortOrder, then id ascending)', async () => {
    const p1 = await mkBacklogIssue('P1')
    const p2 = await mkBacklogIssue('P2') // p2.id > p1.id
    // A tie: same sortOrder, so only the id tie-break decides who sorts first.
    await db.update(issues).set({ sortOrder: 50000 }).where(eq(issues.id, p1.id))
    await db.update(issues).set({ sortOrder: 50000 }).where(eq(issues.id, p2.id))

    // Trigger a renumber via the existing squeeze mechanism, on an unrelated pair —
    // renumberBacklog rewrites the whole backlog, including the p1/p2 tie above.
    const q1 = await mkBacklogIssue('Q1')
    const q2 = await mkBacklogIssue('Q2')
    await db.update(issues).set({ sortOrder: 1000 }).where(eq(issues.id, q1.id))
    await db.update(issues).set({ sortOrder: 1000 + 5e-7 }).where(eq(issues.id, q2.id))
    const q3 = await mkBacklogIssue('Q3')
    const result = await reorderIssue(db, admin, q3.id, { afterId: q1.id, beforeId: q2.id }, q3.version)
    expect(result.ok).toBe(true)

    const list = await listIssues(db, { status: 'backlog' })
    const p1Idx = list.findIndex((i) => i.id === p1.id)
    const p2Idx = list.findIndex((i) => i.id === p2.id)
    // p1 was created (and tied) first, so id-ascending keeps it first — a renumber
    // that only sorted by sortOrder could reverse this arbitrarily.
    expect(p1Idx).toBeLessThan(p2Idx)
  })

  it('rejects a stale expectedVersion', async () => {
    const target = await mkBacklogIssue('R1')
    await reorderIssue(db, admin, target.id, { afterId: a.id }, target.version)
    const stale = await reorderIssue(db, admin, target.id, { beforeId: a.id }, target.version)
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.kind).toBe('conflict')
  })

  it('increments version on a successful reorder', async () => {
    const target = await mkBacklogIssue('R2')
    const result = await reorderIssue(db, admin, target.id, { afterId: a.id }, target.version)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.issue.version).toBe(target.version + 1)
  })
})
