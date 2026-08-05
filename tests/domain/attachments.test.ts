import { describe, it, expect, beforeAll } from 'vitest'
import { createTestDb, seedUser, seedProduct } from '../helpers/db'
import { createIssue, getIssueDetail } from '@/domain/issues'
import { createAttachment } from '@/domain/attachments'
import { issueEvents, apiTokens } from '@/db/schema'
import { eq } from 'drizzle-orm'
import type { Db } from '@/db/client'
import type { Actor } from '@/domain/actor'
import type { Issue } from '@/db/schema'

let db: Db
let admin: Actor
let agent: Actor
let issue: Issue

const META = { filename: '스크린샷.png', contentType: 'image/png', sizeBytes: 1234, gcsObject: 'issues/1/one' }

beforeAll(async () => {
  db = await createTestDb()
  const adminUser = await seedUser(db, { role: 'admin' })
  admin = { type: 'user', id: adminUser.id, role: 'admin' }
  const requesterId = (await seedUser(db)).id
  const productId = (await seedProduct(db, admin.id)).id
  issue = await createIssue(db, admin, { title: '첨부 테스트', type: 'bug', productId, requesterId })
  const [token] = await db.insert(apiTokens).values({ name: '테스트 에이전트', tokenHash: 'hash-attachments' }).returning()
  agent = { type: 'agent', id: token.id }
})

describe('createAttachment', () => {
  it('inserts a row attributed to a user actor and records an attachment event', async () => {
    const result = await createAttachment(db, admin, issue.id, { ...META, gcsObject: 'issues/1/user' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.attachment.actorType).toBe('user')
    expect(result.attachment.actorUserId).toBe(admin.id)
    expect(result.attachment.actorTokenId).toBeNull()
    expect(result.attachment.filename).toBe(META.filename)
    const events = await db.select().from(issueEvents).where(eq(issueEvents.issueId, issue.id))
    const event = events.find((e) => e.field === 'attachment')
    expect(event).toMatchObject({ field: 'attachment', newValue: META.filename, oldValue: null, actorType: 'user' })
  })

  it('inserts a row attributed to an agent actor (XOR check holds)', async () => {
    const result = await createAttachment(db, agent, issue.id, { ...META, gcsObject: 'issues/1/agent' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.attachment.actorType).toBe('agent')
    expect(result.attachment.actorTokenId).toBe(agent.id)
    expect(result.attachment.actorUserId).toBeNull()
  })

  it('returns not-found for a missing issue', async () => {
    const result = await createAttachment(db, admin, 999_999, { ...META, gcsObject: 'issues/999999/x' })
    expect(result).toEqual({ ok: false, kind: 'not_found', error: '이슈를 찾을 수 없습니다' })
  })

  it('getIssueDetail returns attachments ordered by createdAt', async () => {
    const fresh = await createIssue(db, admin, {
      title: '정렬 테스트', type: 'bug', productId: issue.productId, requesterId: issue.requesterId,
    })
    const first = await createAttachment(db, admin, fresh.id, { ...META, filename: 'a.png', gcsObject: 'issues/order/a' })
    const second = await createAttachment(db, admin, fresh.id, { ...META, filename: 'b.png', gcsObject: 'issues/order/b' })
    expect(first.ok && second.ok).toBe(true)
    const detail = await getIssueDetail(db, fresh.id)
    expect(detail?.attachments.map((a) => a.filename)).toEqual(['a.png', 'b.png'])
  })
})
