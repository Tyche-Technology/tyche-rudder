import {
  pgTable, pgEnum, serial, text, integer, timestamp, date, doublePrecision, boolean, uniqueIndex, index, check,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const roleEnum = pgEnum('role', ['admin', 'user'])
export const issueTypeEnum = pgEnum('issue_type', ['bug', 'feature', 'improvement'])
export const priorityEnum = pgEnum('priority', ['p0', 'p1', 'p2'])
export const statusEnum = pgEnum('status', ['inbox', 'backlog', 'in_progress', 'done', 'rejected', 'on_hold'])
export const actorTypeEnum = pgEnum('actor_type', ['user', 'agent'])
export const relationKindEnum = pgEnum('relation_kind', ['duplicate', 'relates', 'blocks'])

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  role: roleEnum('role').notNull().default('user'),
  slackUserId: text('slack_user_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  banned: boolean('banned').notNull().default(false),
  banReason: text('ban_reason'),
  banExpires: timestamp('ban_expires'),
})

export const session = pgTable('session', {
  id: serial('id').primaryKey(),
  token: text('token').notNull().unique(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  impersonatedBy: text('impersonated_by'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [index('session_user_id_idx').on(t.userId)])

export const account = pgTable('account', {
  id: serial('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [index('account_user_id_idx').on(t.userId)])

export const verification = pgTable('verification', {
  id: serial('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [index('verification_identifier_idx').on(t.identifier)])

export const invites = pgTable('invites', {
  id: serial('id').primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  invitedBy: integer('invited_by').notNull().references(() => users.id),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  active: boolean('active').notNull().default(true),
  // Nullable, not backfilled: NULL means "created before attribution existed"
  // (rows from before this column shipped), which is the true value for such
  // a row — inventing an admin to fill it would fabricate the audit trail.
  // Every row created through createProduct() from here on does get one.
  createdByUserId: integer('created_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
  updatedByUserId: integer('updated_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const milestones = pgTable('milestones', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  startsOn: date('starts_on', { mode: 'string' }),
  endsOn: date('ends_on', { mode: 'string' }),
  closed: boolean('closed').notNull().default(false),
  version: integer('version').notNull().default(1),
  // See products.createdByUserId — same nullable-means-pre-attribution rule.
  createdByUserId: integer('created_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
  updatedByUserId: integer('updated_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  // updateMilestone validates the merged range in application code (the
  // friendly 422) guarded by the version CAS added since this comment was
  // first written — a stale concurrent write now 409s before it can reach
  // this constraint. This CHECK's remaining job is the write path the CAS
  // can't see: anything that bypasses the domain layer (a raw query, a
  // future bulk-update script) and could still invert the range at the cost
  // of a 500 instead of a friendly error. No SQLSTATE translation: Phase 1
  // declined that three times because PGlite can't validate driver error codes.
  check('milestones_range_ck', sql`${t.startsOn} IS NULL OR ${t.endsOn} IS NULL OR ${t.startsOn} <= ${t.endsOn}`),
])

export const issues = pgTable('issues', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  type: issueTypeEnum('type').notNull(),
  productId: integer('product_id').notNull().references(() => products.id),
  status: statusEnum('status').notNull().default('inbox'),
  priority: priorityEnum('priority'),
  requesterId: integer('requester_id').notNull().references(() => users.id),
  assigneeId: integer('assignee_id').references(() => users.id),
  milestoneId: integer('milestone_id').references(() => milestones.id),
  sortOrder: doublePrecision('sort_order'),
  reason: text('reason'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const comments = pgTable('comments', {
  id: serial('id').primaryKey(),
  issueId: integer('issue_id').notNull().references(() => issues.id),
  actorType: actorTypeEnum('actor_type').notNull(),
  actorUserId: integer('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
  actorTokenId: integer('actor_token_id').references(() => apiTokens.id, { onDelete: 'restrict' }),
  body: text('body').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  check(
    'comments_actor_xor',
    sql`(${t.actorType} = 'user' AND ${t.actorUserId} IS NOT NULL AND ${t.actorTokenId} IS NULL)
     OR (${t.actorType} = 'agent' AND ${t.actorTokenId} IS NOT NULL AND ${t.actorUserId} IS NULL)`,
  ),
])

export const issueEvents = pgTable('issue_events', {
  id: serial('id').primaryKey(),
  issueId: integer('issue_id').notNull().references(() => issues.id),
  actorType: actorTypeEnum('actor_type').notNull(),
  actorUserId: integer('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
  actorTokenId: integer('actor_token_id').references(() => apiTokens.id, { onDelete: 'restrict' }),
  field: text('field').notNull(),
  oldValue: text('old_value'),
  newValue: text('new_value'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  check(
    'issue_events_actor_xor',
    sql`(${t.actorType} = 'user' AND ${t.actorUserId} IS NOT NULL AND ${t.actorTokenId} IS NULL)
     OR (${t.actorType} = 'agent' AND ${t.actorTokenId} IS NOT NULL AND ${t.actorUserId} IS NULL)`,
  ),
])

export const issueRelations = pgTable('issue_relations', {
  id: serial('id').primaryKey(),
  issueId: integer('issue_id').notNull().references(() => issues.id),
  relatedIssueId: integer('related_issue_id').notNull().references(() => issues.id),
  kind: relationKindEnum('kind').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('uniq_relation').on(t.issueId, t.relatedIssueId, t.kind)])

export const attachments = pgTable('attachments', {
  id: serial('id').primaryKey(),
  issueId: integer('issue_id').notNull().references(() => issues.id),
  filename: text('filename').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  gcsObject: text('gcs_object').notNull().unique(),
  actorType: actorTypeEnum('actor_type').notNull(),
  actorUserId: integer('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
  actorTokenId: integer('actor_token_id').references(() => apiTokens.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  check('attachments_actor_xor',
    sql`(${t.actorType} = 'user' AND ${t.actorUserId} IS NOT NULL AND ${t.actorTokenId} IS NULL)
     OR (${t.actorType} = 'agent' AND ${t.actorTokenId} IS NOT NULL AND ${t.actorUserId} IS NULL)`),
])

export const apiTokens = pgTable('api_tokens', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at'),
  // Deleting a token row is impossible once its agent has written anything —
  // comments/issue_events/attachments reference it ON DELETE restrict — so
  // revocation has to be a flag. actorFromRequest refuses a set one.
  revokedAt: timestamp('revoked_at'),
})

export type Role = (typeof roleEnum.enumValues)[number]
export type IssueType = (typeof issueTypeEnum.enumValues)[number]
export type Priority = (typeof priorityEnum.enumValues)[number]
export type IssueStatus = (typeof statusEnum.enumValues)[number]
export type RelationKind = (typeof relationKindEnum.enumValues)[number]
export type User = typeof users.$inferSelect
export type Issue = typeof issues.$inferSelect
export type NewIssue = typeof issues.$inferInsert
