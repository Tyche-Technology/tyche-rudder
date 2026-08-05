import { and, eq } from 'drizzle-orm'
import { comments, issueRelations, issues } from '@/db/schema'
import type { RelationKind } from '@/db/schema'
import type { Db } from '@/db/client'
import type { Actor } from './actor'
import { actorColumns } from './actor'
import { recordEvent } from './events'
import { notFound, ruleViolation, type DomainError } from './result'

type Comment = typeof comments.$inferSelect

async function issueExists(db: Db, id: number): Promise<boolean> {
  const [row] = await db.select({ id: issues.id }).from(issues).where(eq(issues.id, id))
  return row != null
}

export async function addComment(
  db: Db, actor: Actor, issueId: number, body: string,
): Promise<{ ok: true; comment: Comment } | DomainError> {
  if (!(await issueExists(db, issueId))) return notFound('이슈를 찾을 수 없습니다')
  const [comment] = await db.insert(comments)
    .values({ issueId, ...actorColumns(actor), body })
    .returning()
  return { ok: true, comment }
}

export async function addRelation(
  db: Db, actor: Actor, issueId: number, relatedIssueId: number, kind: RelationKind,
): Promise<{ ok: true } | DomainError> {
  if (issueId === relatedIssueId) return ruleViolation('자기 자신과는 연결할 수 없습니다')
  if (!(await issueExists(db, issueId)) || !(await issueExists(db, relatedIssueId))) {
    return notFound('이슈를 찾을 수 없습니다')
  }
  // The unique index on (issueId, relatedIssueId, kind) is the authority on
  // duplicates, not a pre-check select — a pre-check outside this transaction
  // can't see a concurrent insert that lands between the check and our own.
  return db.transaction(async (tx) => {
    const [inserted] = await tx.insert(issueRelations)
      .values({ issueId, relatedIssueId, kind })
      .onConflictDoNothing()
      .returning()
    if (!inserted) return ruleViolation('이미 연결되어 있습니다')
    await recordEvent(tx, actor, issueId, 'relation_added', null, `${kind}:#${relatedIssueId}`)
    return { ok: true } as const
  })
}

export async function removeRelation(
  db: Db, actor: Actor, issueId: number, relationId: number,
): Promise<{ ok: true } | DomainError> {
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
    if (!relation) return notFound('관계를 찾을 수 없습니다')
    await recordEvent(
      tx, actor, relation.issueId, 'relation_removed',
      `${relation.kind}:#${relation.relatedIssueId}`, null,
    )
    return { ok: true } as const
  })
}
