import { and, asc, desc, eq, inArray, type SQL } from 'drizzle-orm'
import { attachments, comments, issueRelations, issues, issueEvents, users } from '@/db/schema'
import type { Issue, IssueStatus, IssueType, NewIssue } from '@/db/schema'
import type { Db } from '@/db/client'
import type { Actor } from './actor'
import { attachmentColumns } from './attachments'
import { recordEvent, serialize } from './events'
import { validateTransition, type TransitionInput } from './transitions'
import { backlogEntrySortOrder } from './ordering'
import { notFound, conflict, ruleViolation, CONFLICT_ERROR, type DomainError } from './result'

// Re-exported for existing callers (tests, scripts) — the string itself now
// lives in ./result so ordering.ts doesn't have to import from this file.
export { CONFLICT_ERROR }

export async function createIssue(
  db: Db, actor: Actor,
  input: { title: string; description?: string; type: IssueType; productId: number; requesterId: number },
): Promise<Issue> {
  return db.transaction(async (tx) => {
    // Named explicitly rather than spread: a spread writes whatever the caller
    // put on `input`, including assignee_id, which would sidestep updateIssue's
    // banned-assignee guard. The type already forbids it; this makes it
    // structural rather than a typing convention.
    const [issue] = await tx.insert(issues)
      .values({
        title: input.title,
        description: input.description ?? '',
        type: input.type,
        productId: input.productId,
        requesterId: input.requesterId,
      })
      .returning()
    await recordEvent(tx, actor, issue.id, 'created', null, issue.title)
    return issue
  })
}

export async function listIssues(
  db: Db,
  filter: { status?: IssueStatus; productId?: number; requesterId?: number; milestoneId?: number },
): Promise<Issue[]> {
  const conds = [
    filter.status ? eq(issues.status, filter.status) : undefined,
    filter.productId ? eq(issues.productId, filter.productId) : undefined,
    filter.requesterId ? eq(issues.requesterId, filter.requesterId) : undefined,
    filter.milestoneId ? eq(issues.milestoneId, filter.milestoneId) : undefined,
  ].filter((c): c is SQL => c !== undefined)
  const where = conds.length ? and(...conds) : undefined
  return filter.status === 'backlog'
    // backlog is a manually-ordered queue: ties (equal sortOrder) fall back to
    // insertion order, oldest first, same as any FIFO tie-break.
    ? db.select().from(issues).where(where).orderBy(asc(issues.sortOrder), asc(issues.id))
    // everything else is newest-first: ties (equal createdAt) fall back to
    // highest id first, keeping "newest" consistent for the tie-break too.
    : db.select().from(issues).where(where).orderBy(desc(issues.createdAt), desc(issues.id))
}

export async function getIssueDetail(db: Db, id: number) {
  const [issue] = await db.select().from(issues).where(eq(issues.id, id))
  if (!issue) return null
  const [issueComments, events, relations, issueAttachments] = await Promise.all([
    db.select().from(comments).where(eq(comments.issueId, id)).orderBy(asc(comments.createdAt)),
    db.select().from(issueEvents).where(eq(issueEvents.issueId, id)).orderBy(asc(issueEvents.createdAt)),
    db.select().from(issueRelations).where(eq(issueRelations.issueId, id)),
    db.select(attachmentColumns).from(attachments).where(eq(attachments.issueId, id)).orderBy(asc(attachments.createdAt)),
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
    attachments: issueAttachments,
  }
}

const PATCHABLE = ['title', 'description', 'type', 'productId', 'assigneeId', 'milestoneId', 'priority'] as const
type PatchField = (typeof PATCHABLE)[number]
export type IssuePatch = Partial<Pick<NewIssue, PatchField>>

// issue_events.field is machine-readable history (spec §10.3): always the
// snake_case DB column name, never the TS property name.
const FIELD_COLUMN: Record<PatchField, string> = {
  title: 'title',
  description: 'description',
  type: 'type',
  productId: 'product_id',
  assigneeId: 'assignee_id',
  milestoneId: 'milestone_id',
  priority: 'priority',
}

export async function updateIssue(
  db: Db, actor: Actor, id: number, patch: IssuePatch, expectedVersion: number,
): Promise<{ ok: true; issue: Issue } | DomainError> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(issues).where(eq(issues.id, id))
    if (!current) return notFound('이슈를 찾을 수 없습니다')
    // Checked before the no-change shortcut below: a stale no-op PATCH must
    // still learn it's stale, not silently succeed because it changed nothing.
    if (current.version !== expectedVersion) return conflict(CONFLICT_ERROR)
    const changed = PATCHABLE.filter(
      (f) => patch[f] !== undefined && patch[f] !== current[f],
    )
    if (changed.length === 0) return { ok: true, issue: current }
    // Only when assigneeId is actually changing to somebody: an issue whose
    // assignee was banned after the fact must stay patchable (and clearable),
    // otherwise it is stuck with an assignee nobody can remove.
    if (changed.includes('assigneeId') && patch.assigneeId != null) {
      // FOR SHARE, not a plain read: the transaction is READ COMMITTED, so
      // without a row lock a ban committing between this SELECT and the
      // UPDATE below slips through. PGlite is single-connection and cannot
      // demonstrate the race either way — this is reasoned, not test-proven.
      const [assignee] = await tx.select({ banned: users.banned })
        .from(users).where(eq(users.id, patch.assigneeId)).for('share')
      // Without this the FK violation surfaces as a raw driver error (23503)
      // and becomes a 500 instead of a 4xx.
      // Same wording as issues/[id]/route.ts's userExists pre-check, which
      // fires first over HTTP — this branch is reached by direct domain calls
      // and by a user deleted between that check and here.
      if (!assignee) return ruleViolation(`담당자를 찾을 수 없습니다: ${patch.assigneeId}`)
      // Defense in depth, not a fallback for a bypass: assigneeId is settable
      // only by an admin today (issues/[id]/route.ts:27 refuses agents
      // outright, :34-40 limits a non-admin to title/description on their own
      // issue), and assignableUsers() already filters the picker. This guard
      // is here because assignee_id has an FK to a table whose rows can be
      // banned, and that invariant should not depend on which routes happen
      // to exist — if a bulk or admin path is added later it inherits it.
      if (assignee.banned) return ruleViolation('정지된 사용자에게는 이슈를 배정할 수 없습니다')
    }
    const values = changed.reduce<Partial<NewIssue>>((acc, f) => ({ ...acc, [f]: patch[f] }), {})
    const [updated] = await tx.update(issues)
      .set({ ...values, version: current.version + 1, updatedAt: new Date() })
      .where(and(eq(issues.id, id), eq(issues.version, expectedVersion)))
      .returning()
    if (!updated) return conflict(CONFLICT_ERROR)
    for (const f of changed) {
      await recordEvent(tx, actor, id, FIELD_COLUMN[f], serialize(current[f]), serialize(patch[f]))
    }
    return { ok: true, issue: updated }
  })
}

export async function transitionIssue(
  db: Db, actor: Actor, id: number, input: TransitionInput, expectedVersion: number,
): Promise<{ ok: true; issue: Issue; from: IssueStatus } | DomainError> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(issues).where(eq(issues.id, id))
    if (!current) return notFound('이슈를 찾을 수 없습니다')
    // Checked before validateTransition: a stale expectedVersion is reported
    // as a conflict even when the requested transition would otherwise be
    // illegal — same ordering as updateIssue's guard.
    if (current.version !== expectedVersion) return conflict(CONFLICT_ERROR)
    const check = validateTransition(current, input)
    if (!check.ok) return check
    // A parked sortOrder (kept while the issue is out of the backlog) is invisible
    // to every backlog-neighbour query, so it goes stale and can be handed to
    // another issue by the time this one returns. Leaving the backlog always clears
    // it; a returning issue appends at the end instead of resuming a stale slot —
    // the honest semantics for 선적 대기: it stopped waiting to be loaded.
    const sortOrder = input.to === 'backlog'
      ? (current.sortOrder ?? await backlogEntrySortOrder(tx))
      : null
    const reason = input.to === 'rejected' || input.to === 'on_hold' ? (input.reason ?? null) : null
    const [updated] = await tx.update(issues)
      .set({ status: input.to, priority: check.priority, sortOrder, reason, version: current.version + 1, updatedAt: new Date() })
      .where(and(eq(issues.id, id), eq(issues.version, expectedVersion)))
      .returning()
    if (!updated) return conflict(CONFLICT_ERROR)
    await recordEvent(tx, actor, id, 'status', current.status, input.to)
    if (check.priority !== current.priority) {
      await recordEvent(tx, actor, id, 'priority', current.priority, check.priority)
    }
    // Only the clear is recorded here. Backlog entry doesn't get its own
    // sort_order event (matches the pre-existing convention that
    // reorderIssue, not transitionIssue, is the source of entry/move events).
    if (sortOrder == null && current.sortOrder != null) {
      await recordEvent(tx, actor, id, 'sort_order', serialize(current.sortOrder), null)
    }
    if (reason !== current.reason) {
      await recordEvent(tx, actor, id, 'reason', current.reason, reason)
    }
    return { ok: true, issue: updated, from: current.status }
  })
}
