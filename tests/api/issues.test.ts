import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { createTestDb, seedUser, seedProduct } from '../helpers/db'
import { createSessionUser } from '../helpers/auth'
import { apiTokens, issueRelations, issues, milestones } from '@/db/schema'
import type { Db } from '@/db/client'
import type { User } from '@/db/schema'
import type { Actor } from '@/domain/actor'
import { hashToken } from '@/lib/api-auth'
import { addRelation } from '@/domain/collab'
import * as issuesDomain from '@/domain/issues'
import { conflict } from '@/domain/result'

import { GET as listIssuesRoute, POST as createIssueRoute } from '@/app/api/v1/issues/route'
import { GET as getIssueRoute, PATCH as patchIssueRoute } from '@/app/api/v1/issues/[id]/route'
import { POST as transitionRoute } from '@/app/api/v1/issues/[id]/transition/route'
import { POST as reorderRoute } from '@/app/api/v1/issues/[id]/reorder/route'
import { POST as commentRoute } from '@/app/api/v1/issues/[id]/comments/route'
import { POST as relationRoute, DELETE as deleteRelationRoute } from '@/app/api/v1/issues/[id]/relations/route'

const AGENT_TOKEN = 'rud_agent_test_token'
const { CONFLICT_ERROR } = issuesDomain

let db: Db
let adminUser: User
let adminCookie: string
let plainUser: User
let plainCookie: string
let otherUser: User
let adminActor: Actor
let productId: number

let currentCookie: string | undefined
function asUser(cookie: string) { currentCookie = cookie }
function loggedOut() { currentCookie = undefined }
function agentAuth() { return { authorization: `Bearer ${AGENT_TOKEN}` } }

// origin defaults to the request's own origin (matches actorFromRequest's
// BETTER_AUTH_URL-unset fallback) so cookie-authed mutations keep passing
// the fail-closed guard without threading Origin through every call site.
function mkReq(url: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const { method = 'GET', body, headers = {} } = opts
  return new Request(url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(currentCookie ? { cookie: currentCookie } : {}),
      origin: new URL(url).origin,
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}
function ctx(id: number) { return { params: Promise.resolve({ id: String(id) }) } }
function ctxRaw(id: string) { return { params: Promise.resolve({ id }) } }

async function createIssueFixture(
  overrides: Partial<{ title: string; type: 'bug' | 'feature' | 'improvement'; requesterId: number }> = {},
) {
  return issuesDomain.createIssue(db, adminActor, {
    title: overrides.title ?? `fixture-${Math.random().toString(36).slice(2, 8)}`,
    type: overrides.type ?? 'bug',
    productId,
    requesterId: overrides.requesterId ?? plainUser.id,
  })
}

async function backlogIssueFixture() {
  const issue = await createIssueFixture()
  const result = await issuesDomain.transitionIssue(db, adminActor, issue.id, { to: 'backlog', priority: 'p1' }, issue.version)
  if (!result.ok) throw new Error(result.error)
  return result.issue
}

async function relatedPairFixture() {
  const a = await createIssueFixture()
  const b = await createIssueFixture()
  await addRelation(db, adminActor, a.id, b.id, 'relates')
  const [relation] = await db.select().from(issueRelations)
    .where(and(eq(issueRelations.issueId, a.id), eq(issueRelations.relatedIssueId, b.id)))
  return { a, b, relation }
}

beforeAll(async () => {
  db = await createTestDb()
  ;({ user: adminUser, cookie: adminCookie } = await createSessionUser(db, { role: 'admin' }))
  ;({ user: plainUser, cookie: plainCookie } = await createSessionUser(db, { role: 'user' }))
  otherUser = await seedUser(db, { role: 'user' })
  productId = (await seedProduct(db, adminUser.id)).id
  adminActor = { type: 'user', id: adminUser.id, role: 'admin' }
  await db.insert(apiTokens).values({ name: '테스트 에이전트', tokenHash: hashToken(AGENT_TOKEN) })
})

beforeEach(() => {
  loggedOut()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('POST /api/v1/issues', () => {
  it('401s when logged out', async () => {
    const res = await createIssueRoute(mkReq('http://x/api/v1/issues', { method: 'POST', body: { title: 't', type: 'bug', productId } }))
    expect(res.status).toBe(401)
    // Goes through the shared unauthorized() helper — this is the only place
    // that helper's exact body shape gets asserted, not just the status.
    expect(await res.json()).toEqual({ ok: false, error: '로그인이 필요합니다' })
  })

  it('creates an issue as the session user (requester=self)', async () => {
    asUser(plainCookie)
    const res = await createIssueRoute(mkReq('http://x/api/v1/issues', { method: 'POST', body: { title: '통관 요청', type: 'feature', productId } }))
    expect(res.status).toBe(201)
    const { data } = await res.json()
    expect(data.requesterId).toBe(plainUser.id)
    expect(data.status).toBe('inbox')
  })

  it('admin creating an issue is also the requester (self)', async () => {
    asUser(adminCookie)
    const res = await createIssueRoute(mkReq('http://x/api/v1/issues', { method: 'POST', body: { title: '관리자 생성', type: 'bug', productId } }))
    expect(res.status).toBe(201)
    const { data } = await res.json()
    expect(data.requesterId).toBe(adminUser.id)
  })

  it('400s on invalid payload', async () => {
    asUser(plainCookie)
    const res = await createIssueRoute(mkReq('http://x/api/v1/issues', { method: 'POST', body: { title: '', type: 'nope' } }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toBe('입력값이 올바르지 않습니다')
  })

  it('exposes field paths on a parse failure', async () => {
    asUser(plainCookie)
    const res = await createIssueRoute(mkReq('http://x/api/v1/issues', {
      method: 'POST', body: { type: 'bug', productId }, // title missing
    }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.issues.some((i: { path: string }) => i.path === 'title')).toBe(true)
  })

  it('ignores a human-sent requesterEmail and uses the session user as requester', async () => {
    asUser(plainCookie)
    const res = await createIssueRoute(mkReq('http://x/api/v1/issues', {
      method: 'POST',
      body: { title: '무시 대상', type: 'bug', productId, requesterEmail: otherUser.email },
    }))
    const { data } = await res.json()
    expect(data.requesterId).toBe(plainUser.id)
  })

  it('agent creates an issue with a resolved requesterEmail', async () => {
    const res = await createIssueRoute(mkReq('http://x/api/v1/issues', {
      method: 'POST',
      headers: agentAuth(),
      body: { title: '에이전트 생성', type: 'bug', productId, requesterEmail: plainUser.email },
    }))
    expect(res.status).toBe(201)
    const { data } = await res.json()
    expect(data.requesterId).toBe(plainUser.id)
  })

  it('resolves a requesterEmail regardless of case (stored emails are always lowercase)', async () => {
    // plainUser.email is stored lowercase (createSessionUser); an agent
    // supplying a differently-cased but otherwise identical address must
    // still resolve to the same user, not 422 as "not found".
    const mixedCase = plainUser.email!.replace(/^./, (c) => c.toUpperCase())
    const res = await createIssueRoute(mkReq('http://x/api/v1/issues', {
      method: 'POST',
      headers: agentAuth(),
      body: { title: '대소문자 요청자', type: 'bug', productId, requesterEmail: mixedCase },
    }))
    expect(res.status).toBe(201)
    const { data } = await res.json()
    expect(data.requesterId).toBe(plainUser.id)
  })

  it('400s when an agent omits requesterEmail', async () => {
    const res = await createIssueRoute(mkReq('http://x/api/v1/issues', {
      method: 'POST', headers: agentAuth(), body: { title: '누락', type: 'bug', productId },
    }))
    expect(res.status).toBe(400)
  })

  it('422s when an agent references an unknown requesterEmail', async () => {
    const res = await createIssueRoute(mkReq('http://x/api/v1/issues', {
      method: 'POST', headers: agentAuth(), body: { title: '알수없음', type: 'bug', productId, requesterEmail: 'nope@test.local' },
    }))
    expect(res.status).toBe(422)
  })

  it('422s (not 500) when productId does not reference a real product', async () => {
    asUser(plainCookie)
    const res = await createIssueRoute(mkReq('http://x/api/v1/issues', {
      method: 'POST', body: { title: '존재하지 않는 제품', type: 'bug', productId: 999999 },
    }))
    expect(res.status).toBe(422)
  })
})

describe('GET /api/v1/issues', () => {
  it('401s when logged out', async () => {
    const res = await listIssuesRoute(mkReq('http://x/api/v1/issues'))
    expect(res.status).toBe(401)
  })

  it('lists with status filter', async () => {
    asUser(plainCookie)
    const res = await listIssuesRoute(mkReq('http://x/api/v1/issues?status=inbox'))
    const { data } = await res.json()
    expect(data.every((i: { status: string }) => i.status === 'inbox')).toBe(true)
  })

  it('filters by requester=me for the session user', async () => {
    const issue = await createIssueFixture({ requesterId: plainUser.id })
    asUser(plainCookie)
    const res = await listIssuesRoute(mkReq('http://x/api/v1/issues?requester=me'))
    const { data } = await res.json()
    expect(data.every((i: { requesterId: number }) => i.requesterId === plainUser.id)).toBe(true)
    expect(data.some((i: { id: number }) => i.id === issue.id)).toBe(true)
  })

  it('allows an admin to list issues', async () => {
    asUser(adminCookie)
    const res = await listIssuesRoute(mkReq('http://x/api/v1/issues'))
    expect(res.status).toBe(200)
  })

  it('allows an agent to list issues', async () => {
    const res = await listIssuesRoute(mkReq('http://x/api/v1/issues', { headers: agentAuth() }))
    expect(res.status).toBe(200)
  })

  it('400s on an invalid filter', async () => {
    asUser(plainCookie)
    const res = await listIssuesRoute(mkReq('http://x/api/v1/issues?status=not-a-status'))
    expect(res.status).toBe(400)
  })

  it('filters by productId, returning only issues for that product', async () => {
    const otherProduct = await seedProduct(db, adminUser.id)
    const matching = await issuesDomain.createIssue(db, adminActor, {
      title: `필터-제품-${Math.random().toString(36).slice(2, 8)}`, type: 'bug', productId: otherProduct.id, requesterId: plainUser.id,
    })
    const nonMatching = await createIssueFixture() // uses the shared fixture productId
    asUser(plainCookie)
    const res = await listIssuesRoute(mkReq(`http://x/api/v1/issues?productId=${otherProduct.id}`))
    const { data } = await res.json()
    expect(data.every((i: { productId: number }) => i.productId === otherProduct.id)).toBe(true)
    expect(data.some((i: { id: number }) => i.id === matching.id)).toBe(true)
    expect(data.some((i: { id: number }) => i.id === nonMatching.id)).toBe(false)
  })

  it('filters by milestoneId, returning only issues assigned to that milestone', async () => {
    const [milestone] = await db.insert(milestones)
      .values({ name: `필터-마일스톤-${Math.random().toString(36).slice(2, 8)}`, createdByUserId: adminUser.id }).returning()
    const matching = await createIssueFixture()
    const nonMatching = await createIssueFixture()
    asUser(adminCookie)
    await patchIssueRoute(mkReq(`http://x/api/v1/issues/${matching.id}`, { method: 'PATCH', body: { milestoneId: milestone.id, expectedVersion: matching.version } }), ctx(matching.id))
    const res = await listIssuesRoute(mkReq(`http://x/api/v1/issues?milestoneId=${milestone.id}`))
    const { data } = await res.json()
    expect(data.every((i: { milestoneId: number }) => i.milestoneId === milestone.id)).toBe(true)
    expect(data.some((i: { id: number }) => i.id === matching.id)).toBe(true)
    expect(data.some((i: { id: number }) => i.id === nonMatching.id)).toBe(false)
  })

  it('status=backlog orders by sortOrder ascending, not id/insertion order', async () => {
    const first = await backlogIssueFixture()
    const second = await backlogIssueFixture()
    const third = await backlogIssueFixture()
    // Deliberately out of insertion order — proves the endpoint sorts by
    // sortOrder, not by id/createdAt.
    await db.update(issues).set({ sortOrder: 3072 }).where(eq(issues.id, first.id))
    await db.update(issues).set({ sortOrder: 1024 }).where(eq(issues.id, second.id))
    await db.update(issues).set({ sortOrder: 2048 }).where(eq(issues.id, third.id))
    asUser(adminCookie)
    const res = await listIssuesRoute(mkReq('http://x/api/v1/issues?status=backlog'))
    const { data } = await res.json()
    const ids = data.map((i: { id: number }) => i.id)
    const idxOf = (id: number) => ids.indexOf(id)
    expect(idxOf(second.id)).toBeLessThan(idxOf(third.id))
    expect(idxOf(third.id)).toBeLessThan(idxOf(first.id))
  })
})

describe('GET /api/v1/issues/:id', () => {
  it('401s when logged out', async () => {
    const issue = await createIssueFixture()
    const res = await getIssueRoute(mkReq(`http://x/api/v1/issues/${issue.id}`), ctx(issue.id))
    expect(res.status).toBe(401)
  })

  it('404s for a missing issue', async () => {
    asUser(plainCookie)
    const res = await getIssueRoute(mkReq('http://x/api/v1/issues/999999'), ctx(999999))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ ok: false, error: '이슈를 찾을 수 없습니다' })
  })

  it('404s for an oversized id instead of crashing the query', async () => {
    asUser(plainCookie)
    // 24 digits: Number.isInteger() considers this a whole number, but it's
    // far past Postgres's integer range — must be rejected before it reaches
    // a WHERE clause, not surfaced as a 500 from a 22P02 error.
    const res = await getIssueRoute(mkReq('http://x/api/v1/issues/999999999999999999999999'), ctxRaw('999999999999999999999999'))
    expect(res.status).toBe(404)
  })

  it('404s for a non-canonical id (e.g. 0x10)', async () => {
    asUser(plainCookie)
    // Number("0x10") is 16 — a real, resolvable id — but "0x10" is not a
    // canonical decimal integer and must be rejected as a path id regardless.
    const res = await getIssueRoute(mkReq('http://x/api/v1/issues/0x10'), ctxRaw('0x10'))
    expect(res.status).toBe(404)
  })

  it('returns the full bundle for an existing issue', async () => {
    const issue = await createIssueFixture()
    asUser(plainCookie)
    const res = await getIssueRoute(mkReq(`http://x/api/v1/issues/${issue.id}`), ctx(issue.id))
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.issue.id).toBe(issue.id)
    expect(data).toHaveProperty('comments')
    expect(data).toHaveProperty('events')
    expect(data).toHaveProperty('relations')
  })

  it('allows an admin to fetch issue detail', async () => {
    const issue = await createIssueFixture()
    asUser(adminCookie)
    const res = await getIssueRoute(mkReq(`http://x/api/v1/issues/${issue.id}`), ctx(issue.id))
    expect(res.status).toBe(200)
  })

  it('allows an agent to fetch issue detail', async () => {
    const issue = await createIssueFixture()
    const res = await getIssueRoute(mkReq(`http://x/api/v1/issues/${issue.id}`, { headers: agentAuth() }), ctx(issue.id))
    expect(res.status).toBe(200)
  })
})

describe('PATCH /api/v1/issues/:id', () => {
  it('401s when logged out', async () => {
    const issue = await createIssueFixture()
    const res = await patchIssueRoute(mkReq(`http://x/api/v1/issues/${issue.id}`, { method: 'PATCH', body: { title: 'x' } }), ctx(issue.id))
    expect(res.status).toBe(401)
  })

  // The domain refusal has to survive the HTTP layer as a 422, not a 500 —
  // ruleViolation → KIND_STATUS.rule (respond.ts:149). Nothing else asserted
  // that this rule reaches a client at all.
  it('422s when assigning to a suspended crew member', async () => {
    const banned = await seedUser(db, { name: '정지된 담당자', banned: true })
    const issue = await createIssueFixture()
    asUser(adminCookie)
    const res = await patchIssueRoute(
      mkReq(`http://x/api/v1/issues/${issue.id}`, {
        method: 'PATCH', body: { assigneeId: banned.id, expectedVersion: issue.version },
      }),
      ctx(issue.id),
    )
    expect(res.status).toBe(422)
    const { error } = await res.json()
    expect(error).toContain('정지된')
  })

  // Revocation has to bite at a real route, not only in actorFromRequest's
  // own unit test — an agent that reaches a handler at all has already won.
  it('401s a revoked token on a route the same token could use before', async () => {
    const raw = 'rud_revoked_at_route'
    await db.insert(apiTokens).values({ name: '취소될 에이전트', tokenHash: hashToken(raw) })
    const issue = await createIssueFixture()
    const req = () => mkReq(`http://x/api/v1/issues/${issue.id}`, {
      method: 'PATCH', headers: { authorization: `Bearer ${raw}` }, body: { title: 'x' },
    })

    // 403, not 401: the token authenticates, then the agent rule refuses it.
    expect((await patchIssueRoute(req(), ctx(issue.id))).status).toBe(403)

    await db.update(apiTokens).set({ revokedAt: new Date() })
      .where(eq(apiTokens.tokenHash, hashToken(raw)))

    // Now it does not authenticate at all.
    expect((await patchIssueRoute(req(), ctx(issue.id))).status).toBe(401)
  })

  it('403s for an agent', async () => {
    const issue = await createIssueFixture()
    const res = await patchIssueRoute(
      mkReq(`http://x/api/v1/issues/${issue.id}`, { method: 'PATCH', headers: agentAuth(), body: { title: 'x' } }),
      ctx(issue.id),
    )
    expect(res.status).toBe(403)
    // Goes through the shared forbidden() helper — this is the only place
    // that helper's exact body shape gets asserted, not just the status.
    expect(await res.json()).toEqual({ ok: false, error: '권한이 없습니다' })
  })

  it('413s an oversized body before it ever reaches zod', async () => {
    const issue = await createIssueFixture()
    asUser(adminCookie)
    const bigBody = JSON.stringify({ title: 'x'.repeat(2_000_000), expectedVersion: issue.version })
    const req = new Request(`http://x/api/v1/issues/${issue.id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json', 'content-length': '2000000',
        ...(currentCookie ? { cookie: currentCookie } : {}), origin: 'http://x',
      },
      body: bigBody,
    })
    const res = await patchIssueRoute(req, ctx(issue.id))
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ ok: false, error: '요청 본문이 너무 큽니다' })
  })

  it('lets a non-admin requester patch their own issue title/description', async () => {
    const issue = await createIssueFixture({ requesterId: plainUser.id })
    asUser(plainCookie)
    const res = await patchIssueRoute(mkReq(`http://x/api/v1/issues/${issue.id}`, { method: 'PATCH', body: { title: '수정됨', expectedVersion: issue.version } }), ctx(issue.id))
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.title).toBe('수정됨')
  })

  it('403s a non-admin patching a field outside title/description', async () => {
    const issue = await createIssueFixture({ requesterId: plainUser.id })
    asUser(plainCookie)
    const res = await patchIssueRoute(mkReq(`http://x/api/v1/issues/${issue.id}`, { method: 'PATCH', body: { priority: 'p1', expectedVersion: issue.version } }), ctx(issue.id))
    expect(res.status).toBe(403)
  })

  it('403s a non-admin patching title together with a disallowed field', async () => {
    const issue = await createIssueFixture({ requesterId: plainUser.id })
    asUser(plainCookie)
    const res = await patchIssueRoute(
      mkReq(`http://x/api/v1/issues/${issue.id}`, { method: 'PATCH', body: { title: '섞인 패치', priority: 'p1', expectedVersion: issue.version } }),
      ctx(issue.id),
    )
    expect(res.status).toBe(403)
  })

  it("403s a non-admin patching someone else's issue", async () => {
    const issue = await createIssueFixture({ requesterId: otherUser.id })
    asUser(plainCookie)
    const res = await patchIssueRoute(mkReq(`http://x/api/v1/issues/${issue.id}`, { method: 'PATCH', body: { title: '남의 것', expectedVersion: issue.version } }), ctx(issue.id))
    expect(res.status).toBe(403)
  })

  it('404s a non-admin patching a missing issue', async () => {
    asUser(plainCookie)
    const res = await patchIssueRoute(mkReq('http://x/api/v1/issues/999999', { method: 'PATCH', body: { title: 'x', expectedVersion: 1 } }), ctx(999999))
    expect(res.status).toBe(404)
  })

  it('404s an admin patching a missing issue', async () => {
    // Different code path than the non-admin case above: no getIssueDetail
    // pre-check for admins, so this 404 comes from updateIssue's own
    // not-found branch by way of failDomain.
    asUser(adminCookie)
    const res = await patchIssueRoute(mkReq('http://x/api/v1/issues/999999', { method: 'PATCH', body: { title: 'x', expectedVersion: 1 } }), ctx(999999))
    expect(res.status).toBe(404)
  })

  it('lets an admin patch any patchable field', async () => {
    const issue = await createIssueFixture({ requesterId: plainUser.id })
    asUser(adminCookie)
    const res = await patchIssueRoute(mkReq(`http://x/api/v1/issues/${issue.id}`, { method: 'PATCH', body: { assigneeId: adminUser.id, expectedVersion: issue.version } }), ctx(issue.id))
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.assigneeId).toBe(adminUser.id)
  })

  it('422s (not 500) when productId does not reference a real product', async () => {
    const issue = await createIssueFixture()
    asUser(adminCookie)
    const res = await patchIssueRoute(
      mkReq(`http://x/api/v1/issues/${issue.id}`, { method: 'PATCH', body: { productId: 999999, expectedVersion: issue.version } }),
      ctx(issue.id),
    )
    expect(res.status).toBe(422)
  })

  it('422s (not 500) when assigneeId does not reference a real user', async () => {
    const issue = await createIssueFixture()
    asUser(adminCookie)
    const res = await patchIssueRoute(
      mkReq(`http://x/api/v1/issues/${issue.id}`, { method: 'PATCH', body: { assigneeId: 999999, expectedVersion: issue.version } }),
      ctx(issue.id),
    )
    expect(res.status).toBe(422)
  })

  it('422s (not 500) when milestoneId does not reference a real milestone', async () => {
    const issue = await createIssueFixture()
    asUser(adminCookie)
    const res = await patchIssueRoute(
      mkReq(`http://x/api/v1/issues/${issue.id}`, { method: 'PATCH', body: { milestoneId: 999999, expectedVersion: issue.version } }),
      ctx(issue.id),
    )
    expect(res.status).toBe(422)
  })

  it('400s on an invalid patch payload', async () => {
    const issue = await createIssueFixture()
    asUser(adminCookie)
    const res = await patchIssueRoute(mkReq(`http://x/api/v1/issues/${issue.id}`, { method: 'PATCH', body: { title: '', expectedVersion: issue.version } }), ctx(issue.id))
    expect(res.status).toBe(400)
  })

  it('400s when expectedVersion is missing', async () => {
    const issue = await createIssueFixture()
    asUser(adminCookie)
    const res = await patchIssueRoute(mkReq(`http://x/api/v1/issues/${issue.id}`, { method: 'PATCH', body: { title: '버전 누락' } }), ctx(issue.id))
    expect(res.status).toBe(400)
  })

  it('409s on a concurrent-modification conflict', async () => {
    const issue = await createIssueFixture()
    asUser(adminCookie)
    vi.spyOn(issuesDomain, 'updateIssue').mockResolvedValueOnce(conflict(CONFLICT_ERROR))
    const res = await patchIssueRoute(mkReq(`http://x/api/v1/issues/${issue.id}`, { method: 'PATCH', body: { title: '충돌', expectedVersion: issue.version } }), ctx(issue.id))
    expect(res.status).toBe(409)
    const { error } = await res.json()
    expect(error).toBe(CONFLICT_ERROR)
  })
})

describe('POST /api/v1/issues/:id/transition', () => {
  it('401s when logged out', async () => {
    const issue = await createIssueFixture()
    const res = await transitionRoute(
      mkReq(`http://x/api/v1/issues/${issue.id}/transition`, { method: 'POST', body: { to: 'backlog', priority: 'p1' } }),
      ctx(issue.id),
    )
    expect(res.status).toBe(401)
  })

  it('403s for a non-admin user', async () => {
    const issue = await createIssueFixture()
    asUser(plainCookie)
    const res = await transitionRoute(
      mkReq(`http://x/api/v1/issues/${issue.id}/transition`, { method: 'POST', body: { to: 'backlog', priority: 'p1' } }),
      ctx(issue.id),
    )
    expect(res.status).toBe(403)
  })

  it('403s for an agent', async () => {
    const issue = await createIssueFixture()
    const res = await transitionRoute(
      mkReq(`http://x/api/v1/issues/${issue.id}/transition`, { method: 'POST', headers: agentAuth(), body: { to: 'backlog', priority: 'p1' } }),
      ctx(issue.id),
    )
    expect(res.status).toBe(403)
  })

  it('allows an admin to transition', async () => {
    const issue = await createIssueFixture()
    asUser(adminCookie)
    const res = await transitionRoute(
      mkReq(`http://x/api/v1/issues/${issue.id}/transition`, { method: 'POST', body: { to: 'backlog', priority: 'p1', expectedVersion: issue.version } }),
      ctx(issue.id),
    )
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.status).toBe('backlog')
  })

  it('422s on an illegal transition', async () => {
    const issue = await createIssueFixture()
    asUser(adminCookie)
    const res = await transitionRoute(
      mkReq(`http://x/api/v1/issues/${issue.id}/transition`, { method: 'POST', body: { to: 'done', expectedVersion: issue.version } }),
      ctx(issue.id),
    )
    expect(res.status).toBe(422)
  })

  it('404s for a missing issue', async () => {
    asUser(adminCookie)
    const res = await transitionRoute(
      mkReq('http://x/api/v1/issues/999999/transition', { method: 'POST', body: { to: 'backlog', priority: 'p1', expectedVersion: 1 } }),
      ctx(999999),
    )
    expect(res.status).toBe(404)
  })

  it('409s on a concurrent-modification conflict', async () => {
    const issue = await createIssueFixture()
    asUser(adminCookie)
    vi.spyOn(issuesDomain, 'transitionIssue').mockResolvedValueOnce(conflict(CONFLICT_ERROR))
    const res = await transitionRoute(
      mkReq(`http://x/api/v1/issues/${issue.id}/transition`, { method: 'POST', body: { to: 'backlog', priority: 'p1', expectedVersion: issue.version } }),
      ctx(issue.id),
    )
    expect(res.status).toBe(409)
    const { error } = await res.json()
    expect(error).toBe(CONFLICT_ERROR)
  })

  it('400s on an invalid payload', async () => {
    const issue = await createIssueFixture()
    asUser(adminCookie)
    const res = await transitionRoute(
      mkReq(`http://x/api/v1/issues/${issue.id}/transition`, { method: 'POST', body: { to: 'not-a-status', expectedVersion: issue.version } }),
      ctx(issue.id),
    )
    expect(res.status).toBe(400)
  })

  it('400s when expectedVersion is missing', async () => {
    const issue = await createIssueFixture()
    asUser(adminCookie)
    const res = await transitionRoute(
      mkReq(`http://x/api/v1/issues/${issue.id}/transition`, { method: 'POST', body: { to: 'backlog', priority: 'p1' } }),
      ctx(issue.id),
    )
    expect(res.status).toBe(400)
  })
})

describe('Slack notifications wired into issue routes', () => {
  const ENV_KEYS = ['SLACK_BOT_TOKEN', 'SLACK_API_BASE', 'APP_BASE_URL', 'SLACK_CHANNEL_ID'] as const
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string>> = {}

  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k]
    process.env.SLACK_BOT_TOKEN = 'xoxb-route-test'
    process.env.SLACK_API_BASE = 'http://slack.test/api'
    process.env.APP_BASE_URL = 'http://rudder.test'
    process.env.SLACK_CHANNEL_ID = 'C_TEST_CHANNEL'
  })

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('POST /issues fires exactly one chat.postMessage to the channel', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)
    asUser(plainCookie)
    const res = await createIssueRoute(mkReq('http://x/api/v1/issues', { method: 'POST', body: { title: '슬랙 알림 테스트', type: 'bug', productId } }))
    expect(res.status).toBe(201)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('http://slack.test/api/chat.postMessage')
  })

  it('POST /issues still returns 201 when the Slack fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('token=do-not-log')))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    asUser(plainCookie)
    const res = await createIssueRoute(mkReq('http://x/api/v1/issues', { method: 'POST', body: { title: '슬랙 실패해도 성공', type: 'bug', productId } }))
    expect(res.status).toBe(201)
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled())
    expect(errorSpy.mock.calls.some((call) => call.some(
      (value) => value instanceof Error && value.message.includes('do-not-log'),
    ))).toBe(false)
    errorSpy.mockRestore()
  })

  it('transition DMs the requester only when they have a slackUserId', async () => {
    const mappedRequester = await seedUser(db, { slackUserId: 'U055ABCDEFG' })
    const issue = await createIssueFixture({ requesterId: mappedRequester.id })
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)
    asUser(adminCookie)
    const res = await transitionRoute(
      mkReq(`http://x/api/v1/issues/${issue.id}/transition`, { method: 'POST', body: { to: 'backlog', priority: 'p1', expectedVersion: issue.version } }),
      ctx(issue.id),
    )
    expect(res.status).toBe(200)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.channel).toBe('U055ABCDEFG')
    expect(body.text).toContain('입항 대기 → 선적 대기')
  })

  it('transition sends no DM when the requester has no slackUserId (unmapped)', async () => {
    const issue = await createIssueFixture({ requesterId: plainUser.id }) // plainUser has no slackUserId
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    asUser(adminCookie)
    const res = await transitionRoute(
      mkReq(`http://x/api/v1/issues/${issue.id}/transition`, { method: 'POST', body: { to: 'backlog', priority: 'p1', expectedVersion: issue.version } }),
      ctx(issue.id),
    )
    expect(res.status).toBe(200)
    await new Promise((r) => setTimeout(r, 50))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('transition still returns 200 when the Slack fetch rejects', async () => {
    const mappedRequester = await seedUser(db, { slackUserId: 'U056ABCDEFG' })
    const issue = await createIssueFixture({ requesterId: mappedRequester.id })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    asUser(adminCookie)
    const res = await transitionRoute(
      mkReq(`http://x/api/v1/issues/${issue.id}/transition`, { method: 'POST', body: { to: 'backlog', priority: 'p1', expectedVersion: issue.version } }),
      ctx(issue.id),
    )
    expect(res.status).toBe(200)
  })
})

describe('POST /api/v1/issues/:id/reorder', () => {
  it('401s when logged out', async () => {
    const issue = await backlogIssueFixture()
    const res = await reorderRoute(mkReq(`http://x/api/v1/issues/${issue.id}/reorder`, { method: 'POST', body: { afterId: issue.id } }), ctx(issue.id))
    expect(res.status).toBe(401)
  })

  it('403s for a non-admin user', async () => {
    const issue = await backlogIssueFixture()
    asUser(plainCookie)
    const res = await reorderRoute(mkReq(`http://x/api/v1/issues/${issue.id}/reorder`, { method: 'POST', body: { afterId: issue.id } }), ctx(issue.id))
    expect(res.status).toBe(403)
  })

  it('403s for an agent', async () => {
    const issue = await backlogIssueFixture()
    const res = await reorderRoute(
      mkReq(`http://x/api/v1/issues/${issue.id}/reorder`, { method: 'POST', headers: agentAuth(), body: { afterId: issue.id } }),
      ctx(issue.id),
    )
    expect(res.status).toBe(403)
  })

  it('allows an admin to reorder', async () => {
    const a = await backlogIssueFixture()
    const b = await backlogIssueFixture()
    asUser(adminCookie)
    const res = await reorderRoute(mkReq(`http://x/api/v1/issues/${b.id}/reorder`, { method: 'POST', body: { afterId: a.id, expectedVersion: b.version } }), ctx(b.id))
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.version).toBe(b.version + 1)
  })

  it('422s reordering a non-backlog issue', async () => {
    const issue = await createIssueFixture()
    asUser(adminCookie)
    const res = await reorderRoute(mkReq(`http://x/api/v1/issues/${issue.id}/reorder`, { method: 'POST', body: { afterId: issue.id, expectedVersion: issue.version } }), ctx(issue.id))
    expect(res.status).toBe(422)
  })

  it('404s for a missing issue', async () => {
    asUser(adminCookie)
    const res = await reorderRoute(mkReq('http://x/api/v1/issues/999999/reorder', { method: 'POST', body: { afterId: 1, expectedVersion: 1 } }), ctx(999999))
    expect(res.status).toBe(404)
  })

  it('422s (not 404) when the anchor exists but is not in backlog', async () => {
    const issue = await backlogIssueFixture()
    const inboxAnchor = await createIssueFixture() // never transitioned, stays in inbox
    asUser(adminCookie)
    const res = await reorderRoute(
      mkReq(`http://x/api/v1/issues/${issue.id}/reorder`, { method: 'POST', body: { afterId: inboxAnchor.id, expectedVersion: issue.version } }),
      ctx(issue.id),
    )
    expect(res.status).toBe(422)
    const { error } = await res.json()
    expect(error).toBe('기준 이슈가 백로그 상태가 아닙니다')
  })

  it('400s when neither afterId nor beforeId is sent', async () => {
    const issue = await backlogIssueFixture()
    asUser(adminCookie)
    const res = await reorderRoute(mkReq(`http://x/api/v1/issues/${issue.id}/reorder`, { method: 'POST', body: { expectedVersion: issue.version } }), ctx(issue.id))
    expect(res.status).toBe(400)
  })

  it('400s when expectedVersion is missing', async () => {
    const issue = await backlogIssueFixture()
    asUser(adminCookie)
    const res = await reorderRoute(mkReq(`http://x/api/v1/issues/${issue.id}/reorder`, { method: 'POST', body: { afterId: issue.id } }), ctx(issue.id))
    expect(res.status).toBe(400)
  })

  it('409s on a stale expectedVersion, and a successful reorder increments version', async () => {
    const a = await backlogIssueFixture()
    const b = await backlogIssueFixture()
    asUser(adminCookie)
    const first = await reorderRoute(mkReq(`http://x/api/v1/issues/${b.id}/reorder`, { method: 'POST', body: { afterId: a.id, expectedVersion: b.version } }), ctx(b.id))
    expect(first.status).toBe(200)
    const stale = await reorderRoute(mkReq(`http://x/api/v1/issues/${b.id}/reorder`, { method: 'POST', body: { beforeId: a.id, expectedVersion: b.version } }), ctx(b.id))
    expect(stale.status).toBe(409)
  })
})

describe('POST /api/v1/issues/:id/comments', () => {
  it('401s when logged out', async () => {
    const issue = await createIssueFixture()
    const res = await commentRoute(mkReq(`http://x/api/v1/issues/${issue.id}/comments`, { method: 'POST', body: { body: '댓글' } }), ctx(issue.id))
    expect(res.status).toBe(401)
  })

  it('403s for an agent', async () => {
    const issue = await createIssueFixture()
    const res = await commentRoute(
      mkReq(`http://x/api/v1/issues/${issue.id}/comments`, { method: 'POST', headers: agentAuth(), body: { body: '댓글' } }),
      ctx(issue.id),
    )
    expect(res.status).toBe(403)
  })

  it('allows a plain user to comment', async () => {
    const issue = await createIssueFixture()
    asUser(plainCookie)
    const res = await commentRoute(mkReq(`http://x/api/v1/issues/${issue.id}/comments`, { method: 'POST', body: { body: '댓글 내용' } }), ctx(issue.id))
    expect(res.status).toBe(201)
    const { data } = await res.json()
    expect(data.body).toBe('댓글 내용')
    expect(data.actorUserId).toBe(plainUser.id)
  })

  it('allows an admin to comment', async () => {
    const issue = await createIssueFixture()
    asUser(adminCookie)
    const res = await commentRoute(mkReq(`http://x/api/v1/issues/${issue.id}/comments`, { method: 'POST', body: { body: '관리자 댓글' } }), ctx(issue.id))
    expect(res.status).toBe(201)
  })

  it('404s for a missing issue', async () => {
    asUser(plainCookie)
    const res = await commentRoute(mkReq('http://x/api/v1/issues/999999/comments', { method: 'POST', body: { body: '댓글' } }), ctx(999999))
    expect(res.status).toBe(404)
  })

  it('400s on an empty body', async () => {
    const issue = await createIssueFixture()
    asUser(plainCookie)
    const res = await commentRoute(mkReq(`http://x/api/v1/issues/${issue.id}/comments`, { method: 'POST', body: { body: '' } }), ctx(issue.id))
    expect(res.status).toBe(400)
  })
})

describe('POST /api/v1/issues/:id/relations', () => {
  it('401s when logged out', async () => {
    const a = await createIssueFixture()
    const b = await createIssueFixture()
    const res = await relationRoute(
      mkReq(`http://x/api/v1/issues/${a.id}/relations`, { method: 'POST', body: { relatedIssueId: b.id, kind: 'relates' } }),
      ctx(a.id),
    )
    expect(res.status).toBe(401)
  })

  it('403s for a non-admin user', async () => {
    const a = await createIssueFixture()
    const b = await createIssueFixture()
    asUser(plainCookie)
    const res = await relationRoute(
      mkReq(`http://x/api/v1/issues/${a.id}/relations`, { method: 'POST', body: { relatedIssueId: b.id, kind: 'relates' } }),
      ctx(a.id),
    )
    expect(res.status).toBe(403)
  })

  it('403s for an agent', async () => {
    const a = await createIssueFixture()
    const b = await createIssueFixture()
    const res = await relationRoute(
      mkReq(`http://x/api/v1/issues/${a.id}/relations`, { method: 'POST', headers: agentAuth(), body: { relatedIssueId: b.id, kind: 'relates' } }),
      ctx(a.id),
    )
    expect(res.status).toBe(403)
  })

  it('allows an admin to add a relation', async () => {
    const a = await createIssueFixture()
    const b = await createIssueFixture()
    asUser(adminCookie)
    const res = await relationRoute(
      mkReq(`http://x/api/v1/issues/${a.id}/relations`, { method: 'POST', body: { relatedIssueId: b.id, kind: 'relates' } }),
      ctx(a.id),
    )
    expect(res.status).toBe(201)
  })

  it('404s when the related issue is missing', async () => {
    const a = await createIssueFixture()
    asUser(adminCookie)
    const res = await relationRoute(
      mkReq(`http://x/api/v1/issues/${a.id}/relations`, { method: 'POST', body: { relatedIssueId: 999999, kind: 'relates' } }),
      ctx(a.id),
    )
    expect(res.status).toBe(404)
  })

  it('422s on a duplicate relation', async () => {
    const a = await createIssueFixture()
    const b = await createIssueFixture()
    asUser(adminCookie)
    await relationRoute(
      mkReq(`http://x/api/v1/issues/${a.id}/relations`, { method: 'POST', body: { relatedIssueId: b.id, kind: 'duplicate' } }),
      ctx(a.id),
    )
    const res = await relationRoute(
      mkReq(`http://x/api/v1/issues/${a.id}/relations`, { method: 'POST', body: { relatedIssueId: b.id, kind: 'duplicate' } }),
      ctx(a.id),
    )
    expect(res.status).toBe(422)
  })

  it('400s on an invalid payload', async () => {
    const a = await createIssueFixture()
    asUser(adminCookie)
    const res = await relationRoute(
      mkReq(`http://x/api/v1/issues/${a.id}/relations`, { method: 'POST', body: { relatedIssueId: 'nope', kind: 'relates' } }),
      ctx(a.id),
    )
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/v1/issues/:id/relations', () => {
  it('401s when logged out', async () => {
    const { a, relation } = await relatedPairFixture()
    const res = await deleteRelationRoute(
      mkReq(`http://x/api/v1/issues/${a.id}/relations?relationId=${relation.id}`, { method: 'DELETE' }),
      ctx(a.id),
    )
    expect(res.status).toBe(401)
  })

  it('403s for a non-admin user', async () => {
    const { a, relation } = await relatedPairFixture()
    asUser(plainCookie)
    const res = await deleteRelationRoute(
      mkReq(`http://x/api/v1/issues/${a.id}/relations?relationId=${relation.id}`, { method: 'DELETE' }),
      ctx(a.id),
    )
    expect(res.status).toBe(403)
  })

  it('403s for an agent', async () => {
    const { a, relation } = await relatedPairFixture()
    const res = await deleteRelationRoute(
      mkReq(`http://x/api/v1/issues/${a.id}/relations?relationId=${relation.id}`, { method: 'DELETE', headers: agentAuth() }),
      ctx(a.id),
    )
    expect(res.status).toBe(403)
  })

  it('allows an admin to remove a relation', async () => {
    const { a, relation } = await relatedPairFixture()
    asUser(adminCookie)
    const res = await deleteRelationRoute(
      mkReq(`http://x/api/v1/issues/${a.id}/relations?relationId=${relation.id}`, { method: 'DELETE' }),
      ctx(a.id),
    )
    expect(res.status).toBe(200)
  })

  it('404s for a missing relation', async () => {
    asUser(adminCookie)
    const res = await deleteRelationRoute(
      mkReq('http://x/api/v1/issues/1/relations?relationId=999999', { method: 'DELETE' }),
      ctx(1),
    )
    expect(res.status).toBe(404)
  })

  it('400s when relationId is missing', async () => {
    const { a } = await relatedPairFixture()
    asUser(adminCookie)
    const res = await deleteRelationRoute(mkReq(`http://x/api/v1/issues/${a.id}/relations`, { method: 'DELETE' }), ctx(a.id))
    expect(res.status).toBe(400)
  })

  it('404s deleting a relation through the wrong parent issue', async () => {
    // relation belongs to a/b, but the URL names an unrelated third issue —
    // removeRelation's combined WHERE (id + issueId) must find nothing.
    const { relation } = await relatedPairFixture()
    const c = await createIssueFixture()
    asUser(adminCookie)
    const res = await deleteRelationRoute(
      mkReq(`http://x/api/v1/issues/${c.id}/relations?relationId=${relation.id}`, { method: 'DELETE' }),
      ctx(c.id),
    )
    expect(res.status).toBe(404)
  })

  it('404s for a malformed :id', async () => {
    const { relation } = await relatedPairFixture()
    asUser(adminCookie)
    const res = await deleteRelationRoute(
      mkReq(`http://x/api/v1/issues/abc/relations?relationId=${relation.id}`, { method: 'DELETE' }),
      ctxRaw('abc'),
    )
    expect(res.status).toBe(404)
  })

  it('400s for an oversized relationId', async () => {
    const { a } = await relatedPairFixture()
    asUser(adminCookie)
    const res = await deleteRelationRoute(
      mkReq(`http://x/api/v1/issues/${a.id}/relations?relationId=99999999999999999999999999`, { method: 'DELETE' }),
      ctx(a.id),
    )
    expect(res.status).toBe(400)
  })

  it('400s for a non-canonical relationId (e.g. 0x10)', async () => {
    const { a } = await relatedPairFixture()
    asUser(adminCookie)
    const res = await deleteRelationRoute(
      mkReq(`http://x/api/v1/issues/${a.id}/relations?relationId=0x10`, { method: 'DELETE' }),
      ctx(a.id),
    )
    expect(res.status).toBe(400)
  })
})
