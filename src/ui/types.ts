// Serialized API shapes — what actually arrives over the wire, not the DB
// schema. Dates are ISO strings over JSON, and these types intentionally
// duplicate src/db/schema.ts's unions: Architecture A forbids src/ui/**
// from importing src/db or src/domain, so the UI has its own copy.

export type IssueStatus = 'inbox' | 'backlog' | 'in_progress' | 'done' | 'rejected' | 'on_hold'
export type Priority = 'p0' | 'p1' | 'p2'
export type IssueType = 'bug' | 'feature' | 'improvement'

export type ApiIssue = {
  id: number
  title: string
  description: string
  type: IssueType
  productId: number
  status: IssueStatus
  priority: Priority | null
  requesterId: number
  assigneeId: number | null
  milestoneId: number | null
  sortOrder: number | null
  reason: string | null
  version: number
  createdAt: string
  updatedAt: string
}

// banned/slackUserId are optional because GET /api/v1/users omits them for
// non-admin humans (see that route). The crew screen is admin-only so it
// always receives them; every other screen must not depend on them.
export type ApiUser = { id: number; email: string; name: string; role: 'admin' | 'user'; banned?: boolean; slackUserId?: string | null }

// createdByUserId/updatedByUserId are nullable: NULL means "created before
// catalog attribution existed" (Phase 2 T3), not "no actor".
export type ApiProduct = {
  id: number
  name: string
  active: boolean
  createdByUserId: number | null
  updatedByUserId: number | null
  createdAt: string
  updatedAt: string
}

export type ApiMilestone = {
  id: number
  name: string
  // Bare "YYYY-MM-DD" calendar-day strings (Postgres `date` column) — not
  // full ISO timestamps like createdAt/updatedAt below.
  startsOn: string | null
  endsOn: string | null
  closed: boolean
  version: number
  createdByUserId: number | null
  updatedByUserId: number | null
  createdAt: string
  updatedAt: string
}

export type ApiComment = {
  id: number
  issueId: number
  actorType: 'user' | 'agent'
  actorUserId: number | null
  actorTokenId: number | null
  body: string
  createdAt: string
}

export type ApiEvent = {
  id: number
  issueId: number
  actorType: 'user' | 'agent'
  actorUserId: number | null
  actorTokenId: number | null
  field: string
  oldValue: string | null
  newValue: string | null
  createdAt: string
}

export type ApiRelation = {
  id: number
  issueId: number
  relatedIssueId: number
  kind: 'duplicate' | 'relates' | 'blocks'
  createdAt: string
  related: { id: number; title: string; status: IssueStatus } | null
}

export type ApiAttachment = {
  id: number
  issueId: number
  filename: string
  contentType: string
  sizeBytes: number
  actorType: 'user' | 'agent'
  actorUserId: number | null
  actorTokenId: number | null
  createdAt: string
}

export type ApiIssueDetail = {
  issue: ApiIssue
  comments: ApiComment[]
  events: ApiEvent[]
  relations: ApiRelation[]
  attachments: ApiAttachment[]
}

export type ApiRoadmapEntry = {
  milestone: ApiMilestone
  total: number
  done: number
  issues: Array<Pick<ApiIssue, 'id' | 'title' | 'status' | 'priority' | 'productId'>>
}
