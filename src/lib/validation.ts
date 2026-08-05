import { z } from 'zod'
import { isSlackUserId } from './slack-user-id'

// Global, module-top-level, once — every route's schema is defined below and
// imported (directly or transitively) by every parse site, so this runs
// before any of them can fail. Confirmed against the zod 4.4.3 docs
// (colinhacks/zod v4.0.1, error-customization.mdx / v4/index.mdx): the
// `z.locales.ko()` shape is the documented v4 API, not a guess.
z.config(z.locales.ko())

// Postgres's `integer` column range — an id-shaped number past this crashes
// the query (22P02) instead of failing validation here.
const PG_INT_MAX = 2_147_483_647
const pgId = z.number().int().positive().max(PG_INT_MAX)
// Canonical decimal digits only, same rule as respond.ts's parsePgId — plain
// z.coerce.number() also accepts hex ("0x10") and exponent ("1e3") strings,
// which is more than "a positive integer id" should mean for a query filter.
const pgIdCoerced = z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(pgId)

export const createIssueSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(10_000).optional(),
  type: z.enum(['bug', 'feature', 'improvement']),
  productId: pgId,
  // toLowerCase() normalizes before the eq(users.email, ...) lookup in
  // issues/route.ts — every write path (invites.ts, better-auth's own
  // sign-up/update-user) stores emails lowercased, so an agent-supplied
  // mixed-case address must be normalized here or it 422s as "not found"
  // for a user that genuinely exists.
  requesterEmail: z.email().max(254).toLowerCase().optional(), // agents only
})

export const listIssuesSchema = z.object({
  status: z.enum(['inbox', 'backlog', 'in_progress', 'done', 'rejected', 'on_hold']).optional(),
  productId: pgIdCoerced.optional(),
  milestoneId: pgIdCoerced.optional(),
  requester: z.literal('me').optional(),
})

export const patchIssueSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(10_000).optional(),
  type: z.enum(['bug', 'feature', 'improvement']).optional(),
  productId: pgId.optional(),
  assigneeId: pgId.nullable().optional(),
  milestoneId: pgId.nullable().optional(),
  priority: z.enum(['p0', 'p1', 'p2']).nullable().optional(),
  // Required, not optional: the CAS guard in updateIssue needs a version to
  // compare against on every call, so there's no "skip the check" path.
  expectedVersion: pgId,
})

export const transitionSchema = z.object({
  to: z.enum(['inbox', 'backlog', 'in_progress', 'done', 'rejected', 'on_hold']),
  priority: z.enum(['p0', 'p1', 'p2']).optional(),
  reason: z.string().max(2_000).optional(),
  expectedVersion: pgId,
})

export const reorderSchema = z.object({
  afterId: pgId.optional(),
  beforeId: pgId.optional(),
  expectedVersion: pgId,
}).refine((v) => v.afterId != null || v.beforeId != null, { error: 'afterId 또는 beforeId가 필요합니다' })

export const commentSchema = z.object({ body: z.string().min(1).max(10_000) })

export const relationSchema = z.object({
  relatedIssueId: pgId,
  kind: z.enum(['duplicate', 'relates', 'blocks']),
})

export const createProductSchema = z.object({ name: z.string().min(1).max(100) })

export const patchProductSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  active: z.boolean().optional(),
})

// z.coerce.date() accepts numbers/booleans/null (all silently become epoch-ish
// dates) and rolls calendar-impossible strings forward (e.g. Feb 30 -> Mar 2)
// instead of rejecting them. z.iso.date() only accepts a strict, calendar-
// validated YYYY-MM-DD string, and that string is exactly what the date-mode
// milestones columns want — no transform into a Date needed or wanted.
const isoDate = z.iso.date()

// Only meaningful when both ends are concrete dates in *this* payload — a
// PATCH that omits or nulls one side can't be range-checked against a value
// that lives only in the DB. String comparison is correct here: both sides
// are validated YYYY-MM-DD, where lexicographic order equals chronological
// order.
const validDateRange = (v: { startsOn?: string | null; endsOn?: string | null }) =>
  !(typeof v.startsOn === 'string' && typeof v.endsOn === 'string') || v.startsOn <= v.endsOn

export const createMilestoneSchema = z.object({
  name: z.string().min(1).max(100),
  // Not nullable: `startsOn: null` on create isn't "no date", it's malformed
  // input, and shouldn't silently mean epoch.
  startsOn: isoDate.optional(),
  endsOn: isoDate.optional(),
}).refine(validDateRange, { error: '시작일은 종료일보다 늦을 수 없습니다', path: ['endsOn'] })

export const patchMilestoneSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  // Nullable here only: clearing a date is a legitimate patch operation.
  startsOn: isoDate.nullable().optional(),
  endsOn: isoDate.nullable().optional(),
  closed: z.boolean().optional(),
  // Required, not optional: the CAS guard in updateMilestone needs a version
  // to compare against on every call, so there's no "skip the check" path.
  expectedVersion: pgId,
}).refine(validDateRange, { error: '시작일은 종료일보다 늦을 수 없습니다', path: ['endsOn'] })

export const inviteCreateSchema = z.object({
  email: z.email().max(254),
  name: z.string().min(1).max(100),
  role: z.enum(['admin', 'user']).default('user'),
})

export const inviteToken = z.string().regex(/^[0-9a-f]{64}$/)
export const inviteAcceptSchema = z.object({ token: inviteToken, password: z.string().min(8).max(128) })
export const inviteConsumeSchema = z.object({ token: inviteToken })

export const updateSlackUserIdSchema = z.object({
  slackUserId: z.string().trim().max(65).refine(isSlackUserId).nullable(),
}).strict()
