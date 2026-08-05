import { describe, it, expect, beforeAll, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, seedUser, seedProduct } from '../helpers/db'
import { milestones } from '@/db/schema'
import { createIssue, transitionIssue, updateIssue } from '@/domain/issues'
import { createProduct, updateProduct, createMilestone, updateMilestone, getRoadmap } from '@/domain/catalog'
import type { Db } from '@/db/client'
import type { UserActor } from '@/domain/actor'

let db: Db
let admin: UserActor
let admin2: UserActor
let emptyDb: Db

beforeAll(async () => {
  db = await createTestDb()
  const adminUser = await seedUser(db, { role: 'admin' })
  admin = { type: 'user', id: adminUser.id, role: 'admin' }
  const admin2User = await seedUser(db, { role: 'admin' })
  admin2 = { type: 'user', id: admin2User.id, role: 'admin' }
  emptyDb = await createTestDb()
})

describe('catalog', () => {
  it('returns an empty roadmap when there are no milestones', async () => {
    expect(await getRoadmap(emptyDb)).toEqual([])
  })

  it('rejects duplicate product names without throwing', async () => {
    expect((await createProduct(db, admin, 'lpa')).ok).toBe(true)
    const dup = await createProduct(db, admin, 'lpa')
    expect(dup).toEqual({ ok: false, kind: 'rule', error: '이미 존재하는 제품입니다' })
  })

  it('stamps createdByUserId on create and leaves updatedByUserId null', async () => {
    const created = await createProduct(db, admin2, 'attribution-product-create')
    if (!created.ok) throw new Error(created.error)
    expect(created.product.createdByUserId).toBe(admin2.id)
    expect(created.product.updatedByUserId).toBeNull()
  })

  it('stamps updatedByUserId + advances updatedAt on update, by the acting (different) admin', async () => {
    const created = await createProduct(db, admin2, 'attribution-product-update')
    if (!created.ok) throw new Error(created.error)
    // Compare against JS-sourced timestamps, not created.product.updatedAt: that field
    // came from the DB's defaultNow(), while this assigns updatedAt via `new Date()` in
    // application code (see catalog.ts) — under PGlite's WASM engine those two clocks can
    // disagree by the host's UTC offset, so only a same-provenance comparison is reliable.
    // Bounded on BOTH sides: a lower-only bound can't fail if updatedAt is never touched
    // (defaultNow()'s creation-time value already reads far in the "future" under that same
    // offset, so it satisfies `>= beforeUpdate` by itself) — only the upper bound catches a
    // dropped `updatedAt: new Date()` in updateProduct.
    const beforeUpdate = Date.now()
    const result = await updateProduct(db, admin, created.product.id, { active: false })
    const afterUpdate = Date.now()
    if (!result.ok) throw new Error(result.error)
    expect(result.product.createdByUserId).toBe(admin2.id)
    expect(result.product.updatedByUserId).toBe(admin.id)
    expect(result.product.updatedByUserId).not.toBe(created.product.createdByUserId)
    expect(result.product.updatedAt.getTime()).toBeGreaterThanOrEqual(beforeUpdate)
    expect(result.product.updatedAt.getTime()).toBeLessThanOrEqual(afterUpdate)
  })

  it('fails to update a missing product', async () => {
    const result = await updateProduct(db, admin, 999999, { active: false })
    expect(result).toEqual({ ok: false, kind: 'not_found', error: '제품을 찾을 수 없습니다' })
  })

  it('returns the product unchanged for an empty patch, without throwing', async () => {
    const created = await createProduct(db, admin2, 'attribution-product-empty-patch')
    if (!created.ok) throw new Error(created.error)
    const result = await updateProduct(db, admin, created.product.id, {})
    expect(result).toEqual({ ok: true, product: created.product })
  })

  it('renames a product', async () => {
    const created = await createProduct(db, admin2, 'attribution-product-rename-from')
    if (!created.ok) throw new Error(created.error)
    const result = await updateProduct(db, admin, created.product.id, { name: 'attribution-product-rename-to' })
    if (!result.ok) throw new Error(result.error)
    expect(result.product.name).toBe('attribution-product-rename-to')
  })

  it('rejects renaming a product onto an existing name without throwing', async () => {
    const taken = await createProduct(db, admin2, 'attribution-product-taken')
    const renaming = await createProduct(db, admin2, 'attribution-product-renaming')
    if (!taken.ok || !renaming.ok) throw new Error('setup failed')
    const result = await updateProduct(db, admin, renaming.product.id, { name: taken.product.name })
    expect(result).toEqual({ ok: false, kind: 'rule', error: '이미 존재하는 제품입니다' })
  })

  // The rename pre-check above (nameConflict select) is racy by its own
  // admission: two concurrent renames can both pass it, and the loser hits
  // the DB's unique constraint on the db.update() that follows. Simulate the
  // loser's side by making that single db.update() throw a 23505-shaped
  // error — proving updateProduct's catch translates it into the same
  // friendly 422 the non-racing pre-check gives, not a raw 500.
  it('translates a 23505 from the update call into the same friendly conflict as the pre-check', async () => {
    const created = await createProduct(db, admin2, 'attribution-product-race')
    if (!created.ok) throw new Error(created.error)
    const updateSpy = vi.spyOn(db, 'update').mockImplementationOnce(() => {
      throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' })
    })
    try {
      const result = await updateProduct(db, admin, created.product.id, { name: 'race-survivor-product' })
      expect(result).toEqual({ ok: false, kind: 'rule', error: '이미 존재하는 제품입니다' })
    } finally {
      updateSpy.mockRestore()
    }
  })

  it('rethrows a non-23505 error from the update call instead of swallowing it', async () => {
    const created = await createProduct(db, admin2, 'attribution-product-rethrow')
    if (!created.ok) throw new Error(created.error)
    const updateSpy = vi.spyOn(db, 'update').mockImplementationOnce(() => {
      throw Object.assign(new Error('connection reset'), { code: '57P01' })
    })
    try {
      await expect(updateProduct(db, admin, created.product.id, { active: false })).rejects.toThrow('connection reset')
    } finally {
      updateSpy.mockRestore()
    }
  })

  it('allows renaming a product to the name it already has', async () => {
    const created = await createProduct(db, admin2, 'attribution-product-self-rename')
    if (!created.ok) throw new Error(created.error)
    const result = await updateProduct(db, admin, created.product.id, { name: created.product.name })
    expect(result.ok).toBe(true)
  })

  it('toggles active both ways', async () => {
    const created = await createProduct(db, admin2, 'attribution-product-toggle')
    if (!created.ok) throw new Error(created.error)
    const off = await updateProduct(db, admin, created.product.id, { active: false })
    if (!off.ok) throw new Error(off.error)
    expect(off.product.active).toBe(false)
    const on = await updateProduct(db, admin, created.product.id, { active: true })
    if (!on.ok) throw new Error(on.error)
    expect(on.product.active).toBe(true)
  })

  it('rejects duplicate milestone names without throwing', async () => {
    expect((await createMilestone(db, admin, { name: '2026 Q1' })).ok).toBe(true)
    const dup = await createMilestone(db, admin, { name: '2026 Q1' })
    expect(dup).toEqual({ ok: false, kind: 'rule', error: '이미 존재하는 마일스톤입니다' })
  })

  // startsOn/endsOn are date-mode-string columns now — the wire and the
  // domain layer both carry the bare "YYYY-MM-DD" the admin typed, with no
  // Date object anywhere in between.
  it('round-trips startsOn/endsOn as plain date strings, not Date objects', async () => {
    const created = await createMilestone(db, admin, { name: 'Q3', startsOn: '2026-07-01', endsOn: '2026-09-30' })
    expect(created.ok && created.milestone.startsOn).toBe('2026-07-01')
    expect(created.ok && created.milestone.endsOn).toBe('2026-09-30')
  })

  it('stamps createdByUserId on milestone create and leaves updatedByUserId null', async () => {
    const created = await createMilestone(db, admin2, { name: '2026 Q1 attribution-create' })
    if (!created.ok) throw new Error(created.error)
    expect(created.milestone.createdByUserId).toBe(admin2.id)
    expect(created.milestone.updatedByUserId).toBeNull()
  })

  it('stamps updatedByUserId + advances updatedAt on milestone update, by the acting (different) admin', async () => {
    const created = await createMilestone(db, admin2, { name: '2026 Q1 attribution-update' })
    if (!created.ok) throw new Error(created.error)
    // See the equivalent product test above for why this compares against JS-sourced
    // timestamps, bounded on both sides, instead of created.milestone.updatedAt.
    const beforeUpdate = Date.now()
    const result = await updateMilestone(db, admin, created.milestone.id, { closed: true }, created.milestone.version)
    const afterUpdate = Date.now()
    if (!result.ok) throw new Error(result.error)
    expect(result.milestone.createdByUserId).toBe(admin2.id)
    expect(result.milestone.updatedByUserId).toBe(admin.id)
    expect(result.milestone.updatedByUserId).not.toBe(created.milestone.createdByUserId)
    expect(result.milestone.updatedAt.getTime()).toBeGreaterThanOrEqual(beforeUpdate)
    expect(result.milestone.updatedAt.getTime()).toBeLessThanOrEqual(afterUpdate)
  })

  it('fails to update a missing milestone', async () => {
    const result = await updateMilestone(db, admin, 999999, { closed: true }, 1)
    expect(result.ok).toBe(false)
  })

  it('updates a milestone', async () => {
    const created = await createMilestone(db, admin, { name: '2026 Q2' })
    if (!created.ok) throw new Error(created.error)
    const result = await updateMilestone(db, admin, created.milestone.id, { closed: true }, created.milestone.version)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.milestone.closed).toBe(true)
  })

  it('returns the milestone unchanged for an empty patch, without throwing', async () => {
    const created = await createMilestone(db, admin, { name: '2026 Q2 empty patch' })
    if (!created.ok) throw new Error(created.error)
    const result = await updateMilestone(db, admin, created.milestone.id, {}, created.milestone.version)
    expect(result).toEqual({ ok: true, milestone: created.milestone })
  })

  it('rejects renaming a milestone onto an existing name without throwing', async () => {
    const taken = await createMilestone(db, admin, { name: '2026 Q2 taken' })
    const renaming = await createMilestone(db, admin, { name: '2026 Q2 renaming' })
    if (!taken.ok || !renaming.ok) throw new Error('setup failed')
    const result = await updateMilestone(db, admin, renaming.milestone.id, { name: taken.milestone.name }, renaming.milestone.version)
    expect(result).toEqual({ ok: false, kind: 'rule', error: '이미 존재하는 마일스톤입니다' })
  })

  // The zod refine only sees the payload, so it cannot catch a one-sided
  // PATCH that inverts the range against the STORED counterpart — and the
  // dialog sends only changed fields, making that the normal path.
  it('rejects a single-field patch that inverts the stored date range', async () => {
    const created = await createMilestone(db, admin, {
      name: '2026 Q2 merged-range', startsOn: '2026-09-30', endsOn: '2026-12-31',
    })
    if (!created.ok) throw new Error(created.error)
    const result = await updateMilestone(db, admin, created.milestone.id, { endsOn: '2026-07-25' }, created.milestone.version)
    expect(result).toEqual({ ok: false, kind: 'rule', error: '시작일은 종료일보다 늦을 수 없습니다' })
  })

  it('rejects a single-field patch that moves the start past the stored end', async () => {
    const created = await createMilestone(db, admin, {
      name: '2026 Q2 merged-range start', startsOn: '2026-04-01', endsOn: '2026-07-25',
    })
    if (!created.ok) throw new Error(created.error)
    const result = await updateMilestone(db, admin, created.milestone.id, { startsOn: '2026-09-30' }, created.milestone.version)
    expect(result).toEqual({ ok: false, kind: 'rule', error: '시작일은 종료일보다 늦을 수 없습니다' })
  })

  it('accepts a single-field patch that keeps the merged range valid', async () => {
    const created = await createMilestone(db, admin, {
      name: '2026 Q2 merged-range ok', startsOn: '2026-04-01', endsOn: '2026-07-25',
    })
    if (!created.ok) throw new Error(created.error)
    const result = await updateMilestone(db, admin, created.milestone.id, { endsOn: '2026-08-31' }, created.milestone.version)
    expect(result.ok).toBe(true)
  })

  // Clearing a date removes the constraint rather than tripping it.
  it('accepts clearing one side of the range', async () => {
    const created = await createMilestone(db, admin, {
      name: '2026 Q2 merged-range clear', startsOn: '2026-04-01', endsOn: '2026-07-25',
    })
    if (!created.ok) throw new Error(created.error)
    const result = await updateMilestone(db, admin, created.milestone.id, { startsOn: null }, created.milestone.version)
    expect(result.ok).toBe(true)
  })

  // updateMilestone's merged-range check produces the friendly 422, but it
  // reads-validates-writes without a lock: two concurrent one-sided PATCHes
  // each validate against the stale counterpart and both succeed. Only the DB
  // constraint survives that interleaving, so assert it directly — writing
  // through the raw handle is exactly what the racing second write does.
  it('the database rejects an inverted range even when the domain check is bypassed', async () => {
    const created = await createMilestone(db, admin, {
      name: '2026 Q2 db-constraint', startsOn: '2026-04-01', endsOn: '2026-07-25',
    })
    if (!created.ok) throw new Error(created.error)
    await expect(
      db.update(milestones).set({ endsOn: '2026-01-01' }).where(eq(milestones.id, created.milestone.id)),
    ).rejects.toThrow()
  })

  // Same racy pre-check as updateProduct above — see that test's comment.
  it('translates a 23505 from the update call into the same friendly conflict as the pre-check', async () => {
    const created = await createMilestone(db, admin2, { name: '2026 Q2 race' })
    if (!created.ok) throw new Error(created.error)
    const updateSpy = vi.spyOn(db, 'update').mockImplementationOnce(() => {
      throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' })
    })
    try {
      const result = await updateMilestone(db, admin, created.milestone.id, { name: 'race-survivor-milestone' }, created.milestone.version)
      expect(result).toEqual({ ok: false, kind: 'rule', error: '이미 존재하는 마일스톤입니다' })
    } finally {
      updateSpy.mockRestore()
    }
  })

  it('rethrows a non-23505 error from the update call instead of swallowing it', async () => {
    const created = await createMilestone(db, admin, { name: '2026 Q2 rethrow' })
    if (!created.ok) throw new Error(created.error)
    const updateSpy = vi.spyOn(db, 'update').mockImplementationOnce(() => {
      throw Object.assign(new Error('connection reset'), { code: '57P01' })
    })
    try {
      await expect(
        updateMilestone(db, admin, created.milestone.id, { closed: true }, created.milestone.version),
      ).rejects.toThrow('connection reset')
    } finally {
      updateSpy.mockRestore()
    }
  })

  it('allows renaming a milestone to the name it already has', async () => {
    const created = await createMilestone(db, admin, { name: '2026 Q2 self-rename' })
    if (!created.ok) throw new Error(created.error)
    const result = await updateMilestone(db, admin, created.milestone.id, { name: created.milestone.name }, created.milestone.version)
    expect(result.ok).toBe(true)
  })

  it('rejects a stale expectedVersion with a conflict', async () => {
    const m = await createMilestone(db, admin, { name: 'cas' })
    if (!m.ok) throw new Error('setup')
    const first = await updateMilestone(db, admin, m.milestone.id, { startsOn: '2026-07-01' }, m.milestone.version)
    expect(first.ok).toBe(true)
    const stale = await updateMilestone(db, admin, m.milestone.id, { endsOn: '2026-06-01' }, m.milestone.version) // version 1 again
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.kind).toBe('conflict')
  })

  // Pins the ordering the comment above the version check in updateMilestone
  // names as its reason for existing: the version check must run BEFORE the
  // empty-patch shortcut, or a stale no-op PATCH ({}) would sail through as
  // `{ ok: true, milestone: existing }` instead of learning it's stale.
  it('rejects a stale expectedVersion even with an empty patch', async () => {
    const m = await createMilestone(db, admin, { name: 'cas-empty-patch' })
    if (!m.ok) throw new Error('setup')
    const bump = await updateMilestone(db, admin, m.milestone.id, { closed: true }, m.milestone.version)
    expect(bump.ok).toBe(true)
    const stale = await updateMilestone(db, admin, m.milestone.id, {}, m.milestone.version) // stale: real version is now 2
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.kind).toBe('conflict')
  })

  it('computes roadmap progress per milestone', async () => {
    const requesterId = (await seedUser(db)).id
    const productId = (await seedProduct(db, admin.id)).id
    const ms = await createMilestone(db, admin, { name: '2026 Q3' })
    if (!ms.ok) throw new Error(ms.error)
    const mk = async (title: string) => {
      const issue = await createIssue(db, admin, { title, type: 'feature', productId, requesterId })
      const updated = await updateIssue(db, admin, issue.id, { milestoneId: ms.milestone.id }, issue.version)
      if (!updated.ok) throw new Error(updated.error)
      return updated.issue
    }
    const one = await mk('완료될 화물')
    await mk('아직인 화물')
    const backlogged = await transitionIssue(db, admin, one.id, { to: 'backlog', priority: 'p0' }, one.version)
    if (!backlogged.ok) throw new Error(backlogged.error)
    const inProgress = await transitionIssue(db, admin, one.id, { to: 'in_progress' }, backlogged.issue.version)
    if (!inProgress.ok) throw new Error(inProgress.error)
    await transitionIssue(db, admin, one.id, { to: 'done' }, inProgress.issue.version)
    const roadmap = await getRoadmap(db)
    const entry = roadmap.find((r) => r.milestone.name === '2026 Q3')
    expect(entry).toMatchObject({ total: 2, done: 1 })
  })

  it('excludes rejected issues from the progress denominator', async () => {
    const requesterId = (await seedUser(db)).id
    const productId = (await seedProduct(db, admin.id)).id
    const ms = await createMilestone(db, admin, { name: '2026 Q3 rejected-exclusion' })
    if (!ms.ok) throw new Error(ms.error)

    const done = await createIssue(db, admin, { title: '완료될 화물 2', type: 'feature', productId, requesterId })
    const doneUpdated = await updateIssue(db, admin, done.id, { milestoneId: ms.milestone.id }, done.version)
    if (!doneUpdated.ok) throw new Error(doneUpdated.error)
    const doneBacklogged = await transitionIssue(db, admin, done.id, { to: 'backlog', priority: 'p0' }, doneUpdated.issue.version)
    if (!doneBacklogged.ok) throw new Error(doneBacklogged.error)
    const doneInProgress = await transitionIssue(db, admin, done.id, { to: 'in_progress' }, doneBacklogged.issue.version)
    if (!doneInProgress.ok) throw new Error(doneInProgress.error)
    await transitionIssue(db, admin, done.id, { to: 'done' }, doneInProgress.issue.version)

    const rejected = await createIssue(db, admin, { title: '거절된 화물', type: 'feature', productId, requesterId })
    const rejectedUpdated = await updateIssue(db, admin, rejected.id, { milestoneId: ms.milestone.id }, rejected.version)
    if (!rejectedUpdated.ok) throw new Error(rejectedUpdated.error)
    await transitionIssue(db, admin, rejected.id, { to: 'rejected', reason: '중복 요청' }, rejectedUpdated.issue.version)

    const roadmap = await getRoadmap(db)
    const entry = roadmap.find((r) => r.milestone.name === '2026 Q3 rejected-exclusion')
    expect(entry).toMatchObject({ total: 1, done: 1 })
  })

  it('orders milestones by name and issues within by priority then id', async () => {
    const requesterId = (await seedUser(db)).id
    const productId = (await seedProduct(db, admin.id)).id
    const ms = await createMilestone(db, admin, { name: '2026 Q4' })
    if (!ms.ok) throw new Error(ms.error)
    const mk = async (title: string, priority?: 'p0' | 'p1' | 'p2') => {
      const issue = await createIssue(db, admin, { title, type: 'feature', productId, requesterId })
      const updated = await updateIssue(db, admin, issue.id, { milestoneId: ms.milestone.id }, issue.version)
      if (!updated.ok) throw new Error(updated.error)
      if (priority) {
        const transitioned = await transitionIssue(db, admin, issue.id, { to: 'backlog', priority }, updated.issue.version)
        if (!transitioned.ok) throw new Error(transitioned.error)
        return transitioned.issue
      }
      return updated.issue
    }
    const noPriority = await mk('우선순위 없음')
    const p1 = await mk('p1 이슈', 'p1')
    const p0 = await mk('p0 이슈', 'p0')
    const p2 = await mk('p2 이슈', 'p2')
    const roadmap = await getRoadmap(db)
    const entry = roadmap.find((r) => r.milestone.name === '2026 Q4')
    // p0 first, p1 second, then p2/no-priority (same rank) tied by id ascending.
    const [lowerId, higherId] = [p2.id, noPriority.id].sort((a, b) => a - b)
    expect(entry?.issues.map((i) => i.id)).toEqual([p0.id, p1.id, lowerId, higherId])
  })
})
