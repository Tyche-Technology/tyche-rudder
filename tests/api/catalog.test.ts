import { describe, it, expect, beforeAll } from 'vitest'
import { z } from 'zod'
import { createTestDb, seedProduct } from '../helpers/db'
import { createSessionUser } from '../helpers/auth'
import { apiTokens } from '@/db/schema'
import { hashToken } from '@/lib/api-auth'
import { createIssue, transitionIssue, updateIssue } from '@/domain/issues'
import type { Db } from '@/db/client'
import type { User } from '@/db/schema'

const milestoneShape = z.object({ id: z.number(), name: z.string(), version: z.number() })

// Pins the exact payload shape Task 9's roadmap UI parses — .strict() so a
// dropped OR added field fails the test instead of silently changing the
// contract a downstream client already depends on.
const roadmapMilestoneShape = z.object({
  id: z.number(),
  name: z.string(),
  startsOn: z.string().nullable(),
  endsOn: z.string().nullable(),
  closed: z.boolean(),
  version: z.number(),
  createdByUserId: z.number().nullable(),
  updatedByUserId: z.number().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict()
const roadmapIssueShape = z.object({
  id: z.number(),
  title: z.string(),
  status: z.string(),
  priority: z.string().nullable(),
  productId: z.number(),
}).strict()
const roadmapEntryShape = z.object({
  milestone: roadmapMilestoneShape,
  total: z.number(),
  done: z.number(),
  issues: z.array(roadmapIssueShape),
}).strict()
const productShape = z.object({ id: z.number(), name: z.string(), active: z.boolean() })

import { GET as listProductsRoute, POST as createProductRoute } from '@/app/api/v1/products/route'
import { PATCH as patchProductRoute } from '@/app/api/v1/products/[id]/route'
import { GET as listMilestonesRoute, POST as createMilestoneRoute } from '@/app/api/v1/milestones/route'
import { PATCH as patchMilestoneRoute } from '@/app/api/v1/milestones/[id]/route'
import { GET as roadmapRoute } from '@/app/api/v1/roadmap/route'

const AGENT_TOKEN = 'rud_catalog_agent_token'

let db: Db
let adminUser: User
let adminCookie: string
let plainUser: User
let plainCookie: string

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
function ctx(id: number | string) { return { params: Promise.resolve({ id: String(id) }) } }

beforeAll(async () => {
  db = await createTestDb()
  ;({ user: adminUser, cookie: adminCookie } = await createSessionUser(db, { role: 'admin' }))
  ;({ user: plainUser, cookie: plainCookie } = await createSessionUser(db, { role: 'user' }))
  await db.insert(apiTokens).values({ name: '테스트 에이전트', tokenHash: hashToken(AGENT_TOKEN) })
})

describe('GET /api/v1/products', () => {
  it('401s when logged out', async () => {
    loggedOut()
    const res = await listProductsRoute(mkReq('http://x/api/v1/products'))
    expect(res.status).toBe(401)
    // Representative check on the shared unauthorized() helper's body shape.
    expect(await res.json()).toEqual({ ok: false, error: '로그인이 필요합니다' })
  })

  it('allows any authenticated user', async () => {
    asUser(plainCookie)
    const res = await listProductsRoute(mkReq('http://x/api/v1/products'))
    expect(res.status).toBe(200)
  })

  it('allows an agent', async () => {
    const res = await listProductsRoute(mkReq('http://x/api/v1/products', { headers: agentAuth() }))
    expect(res.status).toBe(200)
  })
})

describe('POST /api/v1/products', () => {
  it('401s when logged out', async () => {
    loggedOut()
    const res = await createProductRoute(mkReq('http://x/api/v1/products', { method: 'POST', body: { name: 'partslink' } }))
    expect(res.status).toBe(401)
  })

  it('403s for a non-admin user', async () => {
    asUser(plainCookie)
    const res = await createProductRoute(mkReq('http://x/api/v1/products', { method: 'POST', body: { name: 'partslink' } }))
    expect(res.status).toBe(403)
    // Representative check on the shared forbidden() helper's body shape.
    expect(await res.json()).toEqual({ ok: false, error: '권한이 없습니다' })
  })

  it('403s for an agent', async () => {
    const res = await createProductRoute(
      mkReq('http://x/api/v1/products', { method: 'POST', headers: agentAuth(), body: { name: 'partslink' } }),
    )
    expect(res.status).toBe(403)
  })

  it('admin creates a product', async () => {
    asUser(adminCookie)
    const res = await createProductRoute(mkReq('http://x/api/v1/products', { method: 'POST', body: { name: 'partslink' } }))
    expect(res.status).toBe(201)
    const { data } = await res.json()
    expect(data.name).toBe('partslink')
  })

  it('422s on a duplicate product name', async () => {
    asUser(adminCookie)
    await createProductRoute(mkReq('http://x/api/v1/products', { method: 'POST', body: { name: 'lpa-collected' } }))
    const res = await createProductRoute(mkReq('http://x/api/v1/products', { method: 'POST', body: { name: 'lpa-collected' } }))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ ok: false, error: '이미 존재하는 제품입니다' })
  })

  it('400s on an invalid payload', async () => {
    asUser(adminCookie)
    const res = await createProductRoute(mkReq('http://x/api/v1/products', { method: 'POST', body: { name: '' } }))
    expect(res.status).toBe(400)
    // The route-specific custom message ('제품 이름을 입력해주세요') is gone now that
    // this goes through failParse — the generic message plus a field-level
    // issue entry replaces it (see respond.ts's failParse / task-5 report).
    const body = await res.json()
    expect(body.error).toBe('입력값이 올바르지 않습니다')
    expect(body.issues).toEqual([{ path: 'name', message: expect.any(String) }])
  })
})

describe('PATCH /api/v1/products/:id', () => {
  async function seedProductViaApi(name: string) {
    asUser(adminCookie)
    const res = await createProductRoute(mkReq('http://x/api/v1/products', { method: 'POST', body: { name } }))
    return productShape.parse((await res.json()).data)
  }

  it('401s when logged out', async () => {
    const product = await seedProductViaApi('patch-product-1')
    loggedOut()
    const res = await patchProductRoute(mkReq(`http://x/api/v1/products/${product.id}`, { method: 'PATCH', body: { active: false } }), ctx(product.id))
    expect(res.status).toBe(401)
  })

  it('403s for a non-admin user', async () => {
    const product = await seedProductViaApi('patch-product-2')
    asUser(plainCookie)
    const res = await patchProductRoute(mkReq(`http://x/api/v1/products/${product.id}`, { method: 'PATCH', body: { active: false } }), ctx(product.id))
    expect(res.status).toBe(403)
  })

  it('403s for an agent', async () => {
    const product = await seedProductViaApi('patch-product-3')
    const res = await patchProductRoute(
      mkReq(`http://x/api/v1/products/${product.id}`, { method: 'PATCH', headers: agentAuth(), body: { active: false } }),
      ctx(product.id),
    )
    expect(res.status).toBe(403)
  })

  it('admin renames a product', async () => {
    const product = await seedProductViaApi('patch-product-4')
    asUser(adminCookie)
    const res = await patchProductRoute(mkReq(`http://x/api/v1/products/${product.id}`, { method: 'PATCH', body: { name: 'patch-product-4-renamed' } }), ctx(product.id))
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.name).toBe('patch-product-4-renamed')
  })

  it('toggles active both ways', async () => {
    const product = await seedProductViaApi('patch-product-5')
    asUser(adminCookie)
    const off = await patchProductRoute(mkReq(`http://x/api/v1/products/${product.id}`, { method: 'PATCH', body: { active: false } }), ctx(product.id))
    expect(off.status).toBe(200)
    expect((await off.json()).data.active).toBe(false)
    const on = await patchProductRoute(mkReq(`http://x/api/v1/products/${product.id}`, { method: 'PATCH', body: { active: true } }), ctx(product.id))
    expect(on.status).toBe(200)
    expect((await on.json()).data.active).toBe(true)
  })

  it('404s for a missing product', async () => {
    asUser(adminCookie)
    const res = await patchProductRoute(mkReq('http://x/api/v1/products/999999', { method: 'PATCH', body: { active: false } }), ctx(999999))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ ok: false, error: '제품을 찾을 수 없습니다' })
  })

  it('422s renaming a product onto an existing name instead of 500ing', async () => {
    const a = await seedProductViaApi('patch-product-taken')
    const b = await seedProductViaApi('patch-product-renaming')
    asUser(adminCookie)
    const res = await patchProductRoute(mkReq(`http://x/api/v1/products/${b.id}`, { method: 'PATCH', body: { name: a.name } }), ctx(b.id))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ ok: false, error: '이미 존재하는 제품입니다' })
  })

  it('400s on an empty (no JSON payload) body', async () => {
    const product = await seedProductViaApi('patch-product-6')
    asUser(adminCookie)
    const res = await patchProductRoute(mkReq(`http://x/api/v1/products/${product.id}`, { method: 'PATCH' }), ctx(product.id))
    expect(res.status).toBe(400)
  })
})

describe('GET /api/v1/milestones', () => {
  it('401s when logged out', async () => {
    loggedOut()
    const res = await listMilestonesRoute(mkReq('http://x/api/v1/milestones'))
    expect(res.status).toBe(401)
  })

  it('allows any authenticated user', async () => {
    asUser(plainCookie)
    const res = await listMilestonesRoute(mkReq('http://x/api/v1/milestones'))
    expect(res.status).toBe(200)
  })

  it('allows an agent', async () => {
    const res = await listMilestonesRoute(mkReq('http://x/api/v1/milestones', { headers: agentAuth() }))
    expect(res.status).toBe(200)
  })
})

describe('POST /api/v1/milestones', () => {
  it('401s when logged out', async () => {
    loggedOut()
    const res = await createMilestoneRoute(mkReq('http://x/api/v1/milestones', { method: 'POST', body: { name: '2027 Q1' } }))
    expect(res.status).toBe(401)
  })

  it('403s for a non-admin user', async () => {
    asUser(plainCookie)
    const res = await createMilestoneRoute(mkReq('http://x/api/v1/milestones', { method: 'POST', body: { name: '2027 Q1' } }))
    expect(res.status).toBe(403)
  })

  it('403s for an agent', async () => {
    const res = await createMilestoneRoute(
      mkReq('http://x/api/v1/milestones', { method: 'POST', headers: agentAuth(), body: { name: '2027 Q1' } }),
    )
    expect(res.status).toBe(403)
  })

  it('admin creates a milestone', async () => {
    asUser(adminCookie)
    const res = await createMilestoneRoute(mkReq('http://x/api/v1/milestones', { method: 'POST', body: { name: '2027 Q1' } }))
    expect(res.status).toBe(201)
    const { data } = await res.json()
    expect(data.name).toBe('2027 Q1')
  })

  it('422s on a duplicate milestone name', async () => {
    asUser(adminCookie)
    await createMilestoneRoute(mkReq('http://x/api/v1/milestones', { method: 'POST', body: { name: '2027 Q2' } }))
    const res = await createMilestoneRoute(mkReq('http://x/api/v1/milestones', { method: 'POST', body: { name: '2027 Q2' } }))
    expect(res.status).toBe(422)
  })

  it('accepts valid ISO calendar dates for startsOn/endsOn', async () => {
    asUser(adminCookie)
    const res = await createMilestoneRoute(mkReq('http://x/api/v1/milestones', {
      method: 'POST', body: { name: '2027 Q5', startsOn: '2027-01-01', endsOn: '2027-03-31' },
    }))
    expect(res.status).toBe(201)
  })

  it('400s on a non-date primitive for startsOn', async () => {
    asUser(adminCookie)
    const res = await createMilestoneRoute(mkReq('http://x/api/v1/milestones', {
      method: 'POST', body: { name: '2027 Q6', startsOn: 0 },
    }))
    expect(res.status).toBe(400)
  })

  it('400s on an impossible calendar date', async () => {
    asUser(adminCookie)
    const res = await createMilestoneRoute(mkReq('http://x/api/v1/milestones', {
      method: 'POST', body: { name: '2027 Q7', startsOn: '2026-02-30' },
    }))
    expect(res.status).toBe(400)
  })

  it('400s on a reversed date range', async () => {
    asUser(adminCookie)
    const res = await createMilestoneRoute(mkReq('http://x/api/v1/milestones', {
      method: 'POST', body: { name: '2027 Q8', startsOn: '2027-06-01', endsOn: '2027-01-01' },
    }))
    expect(res.status).toBe(400)
  })

  it('400s on an invalid payload', async () => {
    asUser(adminCookie)
    const res = await createMilestoneRoute(mkReq('http://x/api/v1/milestones', { method: 'POST', body: { name: '' } }))
    expect(res.status).toBe(400)
  })
})

describe('PATCH /api/v1/milestones/:id', () => {
  async function seedMilestone(name: string) {
    asUser(adminCookie)
    const res = await createMilestoneRoute(mkReq('http://x/api/v1/milestones', { method: 'POST', body: { name } }))
    return milestoneShape.parse((await res.json()).data)
  }

  it('401s when logged out', async () => {
    const milestone = await seedMilestone('2027 Q3')
    loggedOut()
    const res = await patchMilestoneRoute(mkReq(`http://x/api/v1/milestones/${milestone.id}`, { method: 'PATCH', body: { closed: true, expectedVersion: milestone.version } }), ctx(milestone.id))
    expect(res.status).toBe(401)
  })

  it('403s for a non-admin user', async () => {
    const milestone = await seedMilestone('2027 Q4')
    asUser(plainCookie)
    const res = await patchMilestoneRoute(mkReq(`http://x/api/v1/milestones/${milestone.id}`, { method: 'PATCH', body: { closed: true, expectedVersion: milestone.version } }), ctx(milestone.id))
    expect(res.status).toBe(403)
  })

  it('403s for an agent', async () => {
    const milestone = await seedMilestone('2028 Q1')
    const res = await patchMilestoneRoute(
      mkReq(`http://x/api/v1/milestones/${milestone.id}`, { method: 'PATCH', headers: agentAuth(), body: { closed: true, expectedVersion: milestone.version } }),
      ctx(milestone.id),
    )
    expect(res.status).toBe(403)
  })

  it('admin closes a milestone', async () => {
    const milestone = await seedMilestone('2028 Q2')
    asUser(adminCookie)
    const res = await patchMilestoneRoute(mkReq(`http://x/api/v1/milestones/${milestone.id}`, { method: 'PATCH', body: { closed: true, expectedVersion: milestone.version } }), ctx(milestone.id))
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.closed).toBe(true)
  })

  it('200s on a valid empty patch body instead of a generic 500', async () => {
    const milestone = await seedMilestone('2028 Q4')
    asUser(adminCookie)
    const res = await patchMilestoneRoute(mkReq(`http://x/api/v1/milestones/${milestone.id}`, { method: 'PATCH', body: { expectedVersion: milestone.version } }), ctx(milestone.id))
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.id).toBe(milestone.id)
  })

  it('404s for a missing milestone', async () => {
    asUser(adminCookie)
    const res = await patchMilestoneRoute(mkReq('http://x/api/v1/milestones/999999', { method: 'PATCH', body: { closed: true, expectedVersion: 1 } }), ctx(999999))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ ok: false, error: '마일스톤을 찾을 수 없습니다' })
  })

  it('400s on an invalid payload', async () => {
    const milestone = await seedMilestone('2028 Q3')
    asUser(adminCookie)
    const res = await patchMilestoneRoute(mkReq(`http://x/api/v1/milestones/${milestone.id}`, { method: 'PATCH', body: { name: '', expectedVersion: milestone.version } }), ctx(milestone.id))
    expect(res.status).toBe(400)
  })

  it('400s when expectedVersion is missing', async () => {
    const milestone = await seedMilestone('2028 Q3b')
    asUser(adminCookie)
    const res = await patchMilestoneRoute(mkReq(`http://x/api/v1/milestones/${milestone.id}`, { method: 'PATCH', body: { closed: true } }), ctx(milestone.id))
    expect(res.status).toBe(400)
  })

  it('409s on a stale expectedVersion, 200s with the current one and increments version', async () => {
    const milestone = await seedMilestone('2028 Q3c')
    asUser(adminCookie)
    const stale = await patchMilestoneRoute(mkReq(`http://x/api/v1/milestones/${milestone.id}`, { method: 'PATCH', body: { closed: true, expectedVersion: milestone.version + 1 } }), ctx(milestone.id))
    expect(stale.status).toBe(409)
    expect(await stale.json()).toEqual({ ok: false, error: '다른 사용자가 먼저 이 마일스톤을 변경했습니다. 새로 고침 후 다시 시도해주세요' })

    const current = await patchMilestoneRoute(mkReq(`http://x/api/v1/milestones/${milestone.id}`, { method: 'PATCH', body: { closed: true, expectedVersion: milestone.version } }), ctx(milestone.id))
    expect(current.status).toBe(200)
    const { data } = await current.json()
    expect(data.version).toBe(milestone.version + 1)
  })

  // API-level twin of the domain "stale + empty patch" pin above: an empty
  // patch is only {expectedVersion}, no other fields — this is the shape the
  // wire itself allows for a stale no-op PATCH.
  it('409s on a stale expectedVersion even with no other fields in the body', async () => {
    const milestone = await seedMilestone('2028 Q3d')
    asUser(adminCookie)
    const bump = await patchMilestoneRoute(mkReq(`http://x/api/v1/milestones/${milestone.id}`, { method: 'PATCH', body: { closed: true, expectedVersion: milestone.version } }), ctx(milestone.id))
    expect(bump.status).toBe(200)
    const stale = await patchMilestoneRoute(mkReq(`http://x/api/v1/milestones/${milestone.id}`, { method: 'PATCH', body: { expectedVersion: milestone.version } }), ctx(milestone.id))
    expect(stale.status).toBe(409)
    expect(await stale.json()).toEqual({ ok: false, error: '다른 사용자가 먼저 이 마일스톤을 변경했습니다. 새로 고침 후 다시 시도해주세요' })
  })

  it('accepts a valid ISO calendar date, and null clears it', async () => {
    const milestone = await seedMilestone('2028 Q5')
    asUser(adminCookie)
    const set = await patchMilestoneRoute(mkReq(`http://x/api/v1/milestones/${milestone.id}`, { method: 'PATCH', body: { startsOn: '2028-01-01', expectedVersion: milestone.version } }), ctx(milestone.id))
    expect(set.status).toBe(200)
    const { data: setData } = await set.json()
    const cleared = await patchMilestoneRoute(mkReq(`http://x/api/v1/milestones/${milestone.id}`, { method: 'PATCH', body: { startsOn: null, expectedVersion: setData.version } }), ctx(milestone.id))
    expect(cleared.status).toBe(200)
    const { data } = await cleared.json()
    expect(data.startsOn).toBeNull()
  })

  it('400s on a non-date primitive for startsOn', async () => {
    const milestone = await seedMilestone('2028 Q6')
    asUser(adminCookie)
    const res = await patchMilestoneRoute(mkReq(`http://x/api/v1/milestones/${milestone.id}`, { method: 'PATCH', body: { startsOn: true, expectedVersion: milestone.version } }), ctx(milestone.id))
    expect(res.status).toBe(400)
  })

  it('400s on an impossible calendar date', async () => {
    const milestone = await seedMilestone('2028 Q7')
    asUser(adminCookie)
    const res = await patchMilestoneRoute(mkReq(`http://x/api/v1/milestones/${milestone.id}`, { method: 'PATCH', body: { endsOn: '2026-02-30', expectedVersion: milestone.version } }), ctx(milestone.id))
    expect(res.status).toBe(400)
  })

  it('400s on a reversed date range', async () => {
    const milestone = await seedMilestone('2028 Q8')
    asUser(adminCookie)
    const res = await patchMilestoneRoute(mkReq(`http://x/api/v1/milestones/${milestone.id}`, {
      method: 'PATCH', body: { startsOn: '2028-06-01', endsOn: '2028-01-01', expectedVersion: milestone.version },
    }), ctx(milestone.id))
    expect(res.status).toBe(400)
  })

  it('422s renaming a milestone onto an existing name instead of 500ing', async () => {
    const a = await seedMilestone('2028 Q9 taken')
    const b = await seedMilestone('2028 Q9 renaming')
    asUser(adminCookie)
    const res = await patchMilestoneRoute(mkReq(`http://x/api/v1/milestones/${b.id}`, { method: 'PATCH', body: { name: a.name, expectedVersion: b.version } }), ctx(b.id))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ ok: false, error: '이미 존재하는 마일스톤입니다' })
  })

  it('allows renaming a milestone to the name it already has', async () => {
    const milestone = await seedMilestone('2028 Q10')
    asUser(adminCookie)
    const res = await patchMilestoneRoute(mkReq(`http://x/api/v1/milestones/${milestone.id}`, { method: 'PATCH', body: { name: milestone.name, expectedVersion: milestone.version } }), ctx(milestone.id))
    expect(res.status).toBe(200)
  })
})

describe('GET /api/v1/roadmap', () => {
  it('401s when logged out', async () => {
    loggedOut()
    const res = await roadmapRoute(mkReq('http://x/api/v1/roadmap'))
    expect(res.status).toBe(401)
  })

  it('allows an agent and returns milestone groups', async () => {
    const res = await roadmapRoute(mkReq('http://x/api/v1/roadmap', { headers: agentAuth() }))
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(Array.isArray(data)).toBe(true)
  })

  it('allows an authenticated user', async () => {
    asUser(adminCookie)
    const res = await roadmapRoute(mkReq('http://x/api/v1/roadmap'))
    expect(res.status).toBe(200)
  })

  it('serializes milestone.startsOn/endsOn/closed and excludes a rejected issue from total', async () => {
    asUser(adminCookie)
    const msRes = await createMilestoneRoute(mkReq('http://x/api/v1/milestones', {
      method: 'POST', body: { name: '2029 Q1 roadmap-shape', startsOn: '2029-01-01', endsOn: '2029-03-31' },
    }))
    const milestone = milestoneShape.parse((await msRes.json()).data)

    const product = await seedProduct(db, adminUser.id)
    const adminActor = { type: 'user' as const, id: adminUser.id, role: 'admin' as const }
    const kept = await createIssue(db, adminActor, { title: '유지될 화물', type: 'feature', productId: product.id, requesterId: plainUser.id })
    await updateIssue(db, adminActor, kept.id, { milestoneId: milestone.id }, kept.version)
    const rejected = await createIssue(db, adminActor, { title: '거절된 화물', type: 'feature', productId: product.id, requesterId: plainUser.id })
    const rejectedUpdated = await updateIssue(db, adminActor, rejected.id, { milestoneId: milestone.id }, rejected.version)
    if (!rejectedUpdated.ok) throw new Error(rejectedUpdated.error)
    await transitionIssue(db, adminActor, rejected.id, { to: 'rejected', reason: '중복 요청' }, rejectedUpdated.issue.version)

    const res = await roadmapRoute(mkReq('http://x/api/v1/roadmap'))
    const { data } = await res.json()
    const rawEntry = data.find((e: { milestone: { id: number } }) => e.milestone.id === milestone.id)
    const entry = roadmapEntryShape.parse(rawEntry)
    expect(entry.milestone.startsOn).toBe('2029-01-01')
    expect(entry.milestone.endsOn).toBe('2029-03-31')
    expect(entry.milestone.closed).toBe(false)
    expect(entry.total).toBe(1) // excludes the rejected issue
    expect(entry.done).toBe(0)
    // issues carries both — total/done are the filtered tallies, issues is the raw list.
    expect(entry.issues.map((i) => i.id)).toEqual([kept.id, rejected.id])
    expect(entry.issues.map((i) => i.status)).toEqual(['inbox', 'rejected'])
  })
})
