import { describe, it, expect, beforeAll } from 'vitest'
import { createTestDb, seedUser, seedProduct } from '../helpers/db'
import { issues, issueEvents, comments, apiTokens, milestones } from '@/db/schema'
import type { Db } from '@/db/client'

describe('schema', () => {
  let db: Db
  beforeAll(async () => { db = await createTestDb() })

  it('round-trips an issue with defaults', async () => {
    const user = await seedUser(db)
    const product = await seedProduct(db, user.id)
    const [issue] = await db.insert(issues)
      .values({ title: '재고 동기화 오류', type: 'bug', productId: product.id, requesterId: user.id })
      .returning()
    expect(issue.status).toBe('inbox')
    expect(issue.priority).toBeNull()
    expect(issue.description).toBe('')
  })

  describe('actor XOR check on issue_events', () => {
    it('accepts a user actor with a valid actorUserId', async () => {
      const user = await seedUser(db)
      const product = await seedProduct(db, user.id)
      const [issue] = await db.insert(issues)
        .values({ title: '이벤트 테스트', type: 'bug', productId: product.id, requesterId: user.id })
        .returning()
      const [event] = await db.insert(issueEvents)
        .values({ issueId: issue.id, actorType: 'user', actorUserId: user.id, field: 'status', oldValue: null, newValue: 'inbox' })
        .returning()
      expect(event.actorUserId).toBe(user.id)
    })

    it('rejects a user actor whose actorUserId has no matching user', async () => {
      const user = await seedUser(db)
      const product = await seedProduct(db, user.id)
      const [issue] = await db.insert(issues)
        .values({ title: '이벤트 테스트', type: 'bug', productId: product.id, requesterId: user.id })
        .returning()
      await expect(
        db.insert(issueEvents)
          .values({ issueId: issue.id, actorType: 'user', actorUserId: 2147483647, field: 'status', oldValue: null, newValue: 'inbox' })
          .returning(),
      ).rejects.toThrow()
    })

    it('rejects a user actor whose token column is populated instead', async () => {
      const user = await seedUser(db)
      const product = await seedProduct(db, user.id)
      const [issue] = await db.insert(issues)
        .values({ title: '이벤트 테스트', type: 'bug', productId: product.id, requesterId: user.id })
        .returning()
      const [token] = await db.insert(apiTokens)
        .values({ name: '에이전트 토큰', tokenHash: 'hash-1' })
        .returning()
      await expect(
        db.insert(issueEvents)
          .values({ issueId: issue.id, actorType: 'user', actorUserId: null, actorTokenId: token.id, field: 'status', oldValue: null, newValue: 'inbox' })
          .returning(),
      ).rejects.toThrow()
    })

    it('accepts an agent actor with a valid actorTokenId', async () => {
      const user = await seedUser(db)
      const product = await seedProduct(db, user.id)
      const [issue] = await db.insert(issues)
        .values({ title: '이벤트 테스트', type: 'bug', productId: product.id, requesterId: user.id })
        .returning()
      const [token] = await db.insert(apiTokens)
        .values({ name: '에이전트 토큰', tokenHash: 'hash-2' })
        .returning()
      const [event] = await db.insert(issueEvents)
        .values({ issueId: issue.id, actorType: 'agent', actorUserId: null, actorTokenId: token.id, field: 'status', oldValue: null, newValue: 'inbox' })
        .returning()
      expect(event.actorTokenId).toBe(token.id)
    })
  })

  describe('milestones date columns', () => {
    // starts_on/ends_on are `date(mode: 'string')` — the driver must hand back
    // the same plain "YYYY-MM-DD" string that went in, never a Date instance,
    // or every caller downstream (domain, wire) would need its own conversion.
    it('round-trips starts_on/ends_on as plain date strings, not Date instances', async () => {
      const [milestone] = await db.insert(milestones)
        .values({ name: 'schema-date-roundtrip', startsOn: '2026-07-01', endsOn: '2026-09-30' })
        .returning()
      expect(milestone.startsOn).toBe('2026-07-01')
      expect(milestone.endsOn).toBe('2026-09-30')
    })
  })

  describe('actor XOR check on comments', () => {
    it('rejects a user actor whose actorUserId has no matching user', async () => {
      const user = await seedUser(db)
      const product = await seedProduct(db, user.id)
      const [issue] = await db.insert(issues)
        .values({ title: '댓글 테스트', type: 'bug', productId: product.id, requesterId: user.id })
        .returning()
      await expect(
        db.insert(comments)
          .values({ issueId: issue.id, actorType: 'user', actorUserId: 2147483647, body: '오류입니다' })
          .returning(),
      ).rejects.toThrow()
    })
  })
})
