import { and, asc, desc, eq, gt, lt, ne, sql } from 'drizzle-orm'
import { issues } from '@/db/schema'
import type { Issue } from '@/db/schema'
import type { Db, DbOrTx } from '@/db/client'
import type { Actor } from './actor'
import { recordEvent, serialize } from './events'
import { notFound, ruleViolation, conflict, CONFLICT_ERROR, type DomainError } from './result'

export const ORDER_GAP = 1024
const MAX_RENUMBER_RETRIES = 1

export async function backlogEntrySortOrder(db: Db): Promise<number> {
  const [row] = await db.select({ max: sql<number | null>`max(${issues.sortOrder})` })
    .from(issues).where(eq(issues.status, 'backlog'))
  return (row?.max ?? 0) + ORDER_GAP
}

// Distinguishes "no such issue" (notFound, 404) from "exists but isn't
// backlog" (ruleViolation, 422) — both used to collapse into the same
// not-found message, which silently misrouted a real domain violation to 404.
async function backlogAnchor(
  db: DbOrTx, id: number | undefined,
): Promise<{ ok: true; sortOrder: number | null } | DomainError> {
  if (id == null) return { ok: true, sortOrder: null }
  const [row] = await db.select({ sortOrder: issues.sortOrder, status: issues.status }).from(issues)
    .where(eq(issues.id, id))
  if (!row) return notFound('이슈를 찾을 수 없습니다')
  if (row.status !== 'backlog') return ruleViolation('기준 이슈가 백로그 상태가 아닙니다')
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
  db: Db, actor: Actor, id: number, target: { afterId?: number; beforeId?: number }, expectedVersion: number,
): Promise<{ ok: true; issue: Issue } | DomainError> {
  return db.transaction((tx) => reorderWithinTx(tx, actor, id, target, expectedVersion, MAX_RENUMBER_RETRIES))
}

// ponytail: midpoint insertion; float precision exhausts after ~50 splits in the same
// gap → one full renumber retry below. A gap still squeezed after that retry (only
// possible if a concurrent writer re-squeezes it between the renumber and the retry's
// read) fails explicitly instead of recursing again.
async function reorderWithinTx(
  tx: DbOrTx, actor: Actor, id: number, target: { afterId?: number; beforeId?: number },
  expectedVersion: number, retriesLeft: number,
): Promise<{ ok: true; issue: Issue } | DomainError> {
  const [current] = await tx.select().from(issues).where(eq(issues.id, id))
  if (!current) return notFound('이슈를 찾을 수 없습니다')
  if (current.status !== 'backlog') return ruleViolation('백로그(선적 대기) 이슈만 순서를 바꿀 수 있습니다')
  if (current.version !== expectedVersion) return conflict(CONFLICT_ERROR)

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
    return ruleViolation('afterId는 beforeId보다 앞에 있어야 합니다')
  }
  if (after != null && before != null && before - after < 1e-6) {
    if (retriesLeft <= 0) {
      return ruleViolation('동시 변경으로 순서를 계산할 수 없습니다. 다시 시도해주세요')
    }
    await renumberBacklog(tx)
    // renumberBacklog only rescales sortOrder, never version, so the same
    // expectedVersion the caller passed in is still the right one to retry with.
    return reorderWithinTx(tx, actor, id, target, expectedVersion, retriesLeft - 1)
  }

  let next: number
  if (after != null && before != null) next = (after + before) / 2
  else if (after != null) next = after + ORDER_GAP
  else if (before != null) next = before - ORDER_GAP
  else return ruleViolation('afterId 또는 beforeId가 필요합니다')

  const [updated] = await tx.update(issues)
    .set({ sortOrder: next, version: current.version + 1, updatedAt: new Date() })
    .where(and(eq(issues.id, id), eq(issues.version, expectedVersion)))
    .returning()
  if (!updated) return conflict(CONFLICT_ERROR)
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
