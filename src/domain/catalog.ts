import { and, asc, eq, inArray, ne } from 'drizzle-orm'
import { issues, milestones, products } from '@/db/schema'
import type { Issue } from '@/db/schema'
import type { Db } from '@/db/client'
import { isUniqueViolation } from '@/app/api/v1/respond'
import type { UserActor } from './actor'
import { notFound, ruleViolation, conflict, type DomainError } from './result'

export const MILESTONE_CONFLICT_ERROR = '다른 사용자가 먼저 이 마일스톤을 변경했습니다. 새로 고침 후 다시 시도해주세요'

type Milestone = typeof milestones.$inferSelect
type Product = typeof products.$inferSelect

export async function createProduct(
  db: Db, actor: UserActor, name: string,
): Promise<{ ok: true; product: Product } | DomainError> {
  // onConflictDoNothing (not check-then-insert) so two concurrent identical
  // creates can't both pass the check and race the unique constraint.
  const [product] = await db.insert(products).values({ name, createdByUserId: actor.id })
    .onConflictDoNothing({ target: products.name }).returning()
  if (!product) return ruleViolation('이미 존재하는 제품입니다')
  return { ok: true, product }
}

export async function updateProduct(
  db: Db, actor: UserActor, id: number,
  patch: { name?: string; active?: boolean },
): Promise<{ ok: true; product: Product } | DomainError> {
  const [existing] = await db.select().from(products).where(eq(products.id, id))
  if (!existing) return notFound('제품을 찾을 수 없습니다')
  // drizzle's .set({}) throws before issuing SQL, so an all-optional empty
  // patch (a valid request) must short-circuit instead of reaching .update().
  if (Object.keys(patch).length === 0) return { ok: true, product: existing }
  if (patch.name !== undefined) {
    // ON CONFLICT has no UPDATE equivalent, so this is a pre-check (racy in
    // principle). Phase 1 has no product delete and only this path renames
    // one, so the window is narrow — revisit if either of those is added.
    const [nameConflict] = await db.select().from(products)
      .where(and(eq(products.name, patch.name), ne(products.id, id)))
    if (nameConflict) return ruleViolation('이미 존재하는 제품입니다')
  }
  // The pre-check above is racy (see its own comment): two concurrent renames
  // can both pass it, and the loser hits the DB's unique constraint here
  // instead. Translate that into the same friendly 422 the pre-check gives
  // the non-racing caller, instead of a raw 500 — but only for 23505;
  // anything else is a real failure and must keep propagating.
  try {
    const [product] = await db.update(products)
      .set({ ...patch, updatedByUserId: actor.id, updatedAt: new Date() })
      .where(eq(products.id, id)).returning()
    return { ok: true, product }
  } catch (e) {
    if (isUniqueViolation(e)) return ruleViolation('이미 존재하는 제품입니다')
    throw e
  }
}

export async function createMilestone(
  db: Db, actor: UserActor, input: { name: string; startsOn?: string; endsOn?: string },
): Promise<{ ok: true; milestone: Milestone } | DomainError> {
  const [milestone] = await db.insert(milestones).values({ ...input, createdByUserId: actor.id })
    .onConflictDoNothing({ target: milestones.name }).returning()
  if (!milestone) return ruleViolation('이미 존재하는 마일스톤입니다')
  return { ok: true, milestone }
}

export async function updateMilestone(
  db: Db, actor: UserActor, id: number,
  patch: { name?: string; startsOn?: string | null; endsOn?: string | null; closed?: boolean },
  expectedVersion: number,
): Promise<{ ok: true; milestone: Milestone } | DomainError> {
  const [existing] = await db.select().from(milestones).where(eq(milestones.id, id))
  if (!existing) return notFound('마일스톤을 찾을 수 없습니다')
  // Checked before the empty-patch shortcut below: a stale no-op PATCH must
  // still learn it's stale, not silently succeed because it changed nothing.
  if (existing.version !== expectedVersion) return conflict(MILESTONE_CONFLICT_ERROR)
  // drizzle's .set({}) throws before issuing SQL, so an all-optional empty
  // patch (a valid request) must short-circuit instead of reaching .update().
  if (Object.keys(patch).length === 0) return { ok: true, milestone: existing }
  // patchMilestoneSchema's refine only fires when BOTH dates are in the
  // payload — it cannot see the stored counterpart. A single-field PATCH
  // (the normal UI path since the dialog started sending only changed
  // fields) could therefore invert the range. Validate the merged result
  // here, where the stored row is already in hand, so the API is as safe for
  // agent clients as it is for the dialog (spec §10 guardrail 1).
  const mergedStartsOn = patch.startsOn !== undefined ? patch.startsOn : existing.startsOn
  const mergedEndsOn = patch.endsOn !== undefined ? patch.endsOn : existing.endsOn
  // Both sides are YYYY-MM-DD strings now (date-mode column), so this is a
  // plain string comparison — lexicographic order equals chronological order
  // for that format, the same property validDateRange in validation.ts relies on.
  if (mergedStartsOn !== null && mergedEndsOn !== null && mergedStartsOn > mergedEndsOn) {
    return ruleViolation('시작일은 종료일보다 늦을 수 없습니다')
  }
  if (patch.name !== undefined) {
    // ON CONFLICT has no UPDATE equivalent, so this is a pre-check (racy in
    // principle). Phase 1 has no milestone delete and only this path renames
    // one, so the window is narrow — revisit if either of those is added.
    const [nameConflict] = await db.select().from(milestones)
      .where(and(eq(milestones.name, patch.name), ne(milestones.id, id)))
    if (nameConflict) return ruleViolation('이미 존재하는 마일스톤입니다')
  }
  // Same racy pre-check as updateProduct above: translate the loser's 23505
  // into the friendly 422, rethrow anything else.
  try {
    const [milestone] = await db.update(milestones)
      .set({ ...patch, version: existing.version + 1, updatedByUserId: actor.id, updatedAt: new Date() })
      .where(and(eq(milestones.id, id), eq(milestones.version, expectedVersion)))
      .returning()
    if (!milestone) return conflict(MILESTONE_CONFLICT_ERROR)
    return { ok: true, milestone }
  } catch (e) {
    if (isUniqueViolation(e)) return ruleViolation('이미 존재하는 마일스톤입니다')
    throw e
  }
}

// A missing priority ranks with p2 (lowest of the three): an unprioritized
// issue shouldn't outrank an explicitly p0/p1 one, and this avoids inventing
// a fourth rank below p2.
const PRIORITY_RANK = { p0: 0, p1: 1, p2: 2 } as const

export async function getRoadmap(db: Db) {
  const allMilestones = await db.select().from(milestones).orderBy(asc(milestones.name))
  if (allMilestones.length === 0) return []
  const assigned = await db.select().from(issues)
    .where(inArray(issues.milestoneId, allMilestones.map((m) => m.id)))
  const byMilestone = new Map<number, Issue[]>()
  for (const issue of assigned) {
    // inArray(issues.milestoneId, ...) guarantees non-null at runtime, but
    // the column type is still `number | null` — narrow instead of casting.
    if (issue.milestoneId == null) continue
    const list = byMilestone.get(issue.milestoneId) ?? []
    byMilestone.set(issue.milestoneId, [...list, issue])
  }
  return allMilestones.map((milestone) => {
    const group = [...(byMilestone.get(milestone.id) ?? [])].sort((a, b) =>
      (PRIORITY_RANK[a.priority ?? 'p2'] - PRIORITY_RANK[b.priority ?? 'p2']) || a.id - b.id)
    // A rejected issue is not work anymore, so it doesn't belong in the progress
    // denominator. The full per-issue status list (including rejected) is still
    // returned in `issues` below, so a client that wants the rejected tally can
    // derive it from there.
    return {
      milestone,
      total: group.filter((i) => i.status !== 'rejected').length,
      done: group.filter((i) => i.status === 'done').length,
      issues: group.map(({ id, title, status, priority, productId }) => ({ id, title, status, priority, productId })),
    }
  })
}
