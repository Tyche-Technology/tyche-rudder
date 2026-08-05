import { and, eq, gte, sql } from 'drizzle-orm'
import { attachments, issues, users } from '@/db/schema'
import type { Db } from '@/db/client'
import type { Actor } from './actor'
import { actorColumns } from './actor'
import { recordEvent } from './events'
import { notFound, ruleViolation, type DomainError } from './result'

type Attachment = Omit<typeof attachments.$inferSelect, 'gcsObject'>

const MAX_ATTACHMENTS_PER_ISSUE = 20
const MAX_TOTAL_BYTES_PER_ISSUE = 100 * 1024 * 1024
const MAX_ATTACHMENTS_PER_USER_PER_DAY = 100
const MAX_BYTES_PER_USER_PER_DAY = 500 * 1024 * 1024

// gcsObject is a bucket key, not a client-facing field — never select() an
// attachment row wholesale for anything that leaves the server (matches the
// explicit-column discipline users/route.ts uses for passwordHash).
export const attachmentColumns = {
  id: attachments.id,
  issueId: attachments.issueId,
  filename: attachments.filename,
  contentType: attachments.contentType,
  sizeBytes: attachments.sizeBytes,
  actorType: attachments.actorType,
  actorUserId: attachments.actorUserId,
  actorTokenId: attachments.actorTokenId,
  createdAt: attachments.createdAt,
}

export async function createAttachment(
  db: Db, actor: Actor, issueId: number,
  meta: { filename: string; contentType: string; sizeBytes: number; gcsObject: string },
): Promise<{ ok: true; attachment: Attachment } | DomainError> {
  return db.transaction(async (tx) => {
    if (actor.type === 'user') {
      const [user] = await tx.select({ id: users.id }).from(users)
        .where(eq(users.id, actor.id)).for('update')
      if (!user) return notFound('사용자를 찾을 수 없습니다')
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const [daily] = await tx.select({
        count: sql<number>`count(*)::int`,
        bytes: sql<string>`coalesce(sum(${attachments.sizeBytes}), 0)::text`,
      }).from(attachments).where(and(
        eq(attachments.actorUserId, actor.id),
        gte(attachments.createdAt, since),
      ))
      if (daily.count >= MAX_ATTACHMENTS_PER_USER_PER_DAY) {
        return ruleViolation('사용자당 24시간 내 첨부파일은 최대 100개까지 등록할 수 있습니다')
      }
      if (Number(daily.bytes) + meta.sizeBytes > MAX_BYTES_PER_USER_PER_DAY) {
        return ruleViolation('사용자당 24시간 내 첨부파일 총 용량은 최대 500MB입니다')
      }
    }
    const [issue] = await tx.select({ id: issues.id }).from(issues)
      .where(eq(issues.id, issueId)).for('update')
    if (!issue) return notFound('이슈를 찾을 수 없습니다')
    const [usage] = await tx.select({
      count: sql<number>`count(*)::int`,
      bytes: sql<string>`coalesce(sum(${attachments.sizeBytes}), 0)::text`,
    }).from(attachments).where(eq(attachments.issueId, issueId))
    if (usage.count >= MAX_ATTACHMENTS_PER_ISSUE) {
      return ruleViolation('이슈당 첨부파일은 최대 20개까지 등록할 수 있습니다')
    }
    if (Number(usage.bytes) + meta.sizeBytes > MAX_TOTAL_BYTES_PER_ISSUE) {
      return ruleViolation('이슈당 첨부파일 총 용량은 최대 100MB입니다')
    }
    const [attachment] = await tx.insert(attachments)
      .values({ issueId, ...meta, ...actorColumns(actor) })
      .returning(attachmentColumns)
    await recordEvent(tx, actor, issueId, 'attachment', null, meta.filename)
    return { ok: true, attachment } as const
  })
}
