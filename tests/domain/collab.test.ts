import { describe, it, expect, beforeAll } from 'vitest'
import { createTestDb, seedUser, seedProduct } from '../helpers/db'
import { createIssue, getIssueDetail } from '@/domain/issues'
import { addComment, addRelation, removeRelation } from '@/domain/collab'
import { issueEvents, issueRelations } from '@/db/schema'
import { eq } from 'drizzle-orm'
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
  const productId = (await seedProduct(db, admin.id)).id
  x = await createIssue(db, admin, { title: 'X', type: 'bug', productId, requesterId })
  y = await createIssue(db, admin, { title: 'Y', type: 'bug', productId, requesterId })
})

describe('collab', () => {
  it('adds a comment attributed to the actor', async () => {
    const result = await addComment(db, admin, x.id, '통관 심사 의견입니다')
    expect(result.ok && result.comment.actorType === 'user').toBe(true)
    expect(result.ok && result.comment.actorUserId === admin.id).toBe(true)
  })

  it('rejects a comment on a missing issue', async () => {
    expect((await addComment(db, admin, 999_999, '유령 화물')).ok).toBe(false)
  })

  it('links two issues, rejects self-relation and duplicates', async () => {
    await expect(addRelation(db, admin, x.id, x.id, 'relates'))
      .resolves.toEqual({ ok: false, kind: 'rule', error: '자기 자신과는 연결할 수 없습니다' })
    expect((await addRelation(db, admin, x.id, y.id, 'duplicate')).ok).toBe(true)
    // second call hits the unique index inside the transaction (ON CONFLICT DO
    // NOTHING), not a pre-check select — must come back as the Korean error,
    // not an unhandled constraint-violation exception.
    await expect(addRelation(db, admin, x.id, y.id, 'duplicate'))
      .resolves.toEqual({ ok: false, kind: 'rule', error: '이미 연결되어 있습니다' })
    const detail = await getIssueDetail(db, x.id)
    expect(detail?.relations[0]?.related?.title).toBe('Y')
  })

  it('rejects addRelation on a missing issue and removeRelation on a missing relation', async () => {
    expect(await addRelation(db, admin, 999_999, y.id, 'relates'))
      .toEqual({ ok: false, kind: 'not_found', error: '이슈를 찾을 수 없습니다' })
    expect(await removeRelation(db, admin, x.id, 999_999))
      .toEqual({ ok: false, kind: 'not_found', error: '관계를 찾을 수 없습니다' })
  })

  it('removes a relation', async () => {
    const detail = await getIssueDetail(db, x.id)
    const relationId = detail!.relations[0].id
    expect((await removeRelation(db, admin, x.id, relationId)).ok).toBe(true)
    expect((await getIssueDetail(db, x.id))?.relations).toHaveLength(0)
  })

  it('refuses to remove a relation that belongs to a different issue', async () => {
    // 'relates' (not 'blocks') so this insert doesn't collide with the
    // x/y 'blocks' pair the next test adds — this one is left in place.
    const added = await addRelation(db, admin, x.id, y.id, 'relates')
    expect(added.ok).toBe(true)
    const detail = await getIssueDetail(db, x.id)
    const relation = detail!.relations.find((r) => r.kind === 'relates')!
    // y.id names the wrong parent — the relation belongs to x, not y. The
    // combined WHERE (id + issueId) must delete nothing rather than deleting
    // by relationId alone.
    expect(await removeRelation(db, admin, y.id, relation.id))
      .toEqual({ ok: false, kind: 'not_found', error: '관계를 찾을 수 없습니다' })
    expect((await getIssueDetail(db, x.id))?.relations.some((r) => r.id === relation.id)).toBe(true)
  })

  it('returns not-found and records no event when the relation row is already gone', async () => {
    const added = await addRelation(db, admin, x.id, y.id, 'blocks')
    expect(added.ok).toBe(true)
    const detail = await getIssueDetail(db, x.id)
    const relation = detail!.relations.find((r) => r.kind === 'blocks')!
    expect((await removeRelation(db, admin, x.id, relation.id)).ok).toBe(true)
    const eventsBefore = await db.select().from(issueEvents).where(eq(issueEvents.issueId, x.id))
    // DELETE ... RETURNING affects zero rows the second time — this must not
    // fabricate a relation_removed event for a removal that didn't happen.
    await expect(removeRelation(db, admin, x.id, relation.id))
      .resolves.toEqual({ ok: false, kind: 'not_found', error: '관계를 찾을 수 없습니다' })
    const eventsAfter = await db.select().from(issueEvents).where(eq(issueEvents.issueId, x.id))
    expect(eventsAfter).toHaveLength(eventsBefore.length)
  })

  it('rolls back the relation insert if the event insert fails mid-transaction', async () => {
    const ghost: Actor = { type: 'user', id: 999_999, role: 'admin' }
    await expect(addRelation(db, ghost, x.id, y.id, 'blocks')).rejects.toThrow()
    const rows = await db.select().from(issueRelations).where(eq(issueRelations.issueId, x.id))
    expect(rows.find((r) => r.kind === 'blocks')).toBeUndefined()
  })
})
