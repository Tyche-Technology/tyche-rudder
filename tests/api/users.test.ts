import { describe, it, expect, beforeAll } from 'vitest'
import { createTestDb, seedUser } from '../helpers/db'
import { createSessionUser } from '../helpers/auth'
import { apiTokens } from '@/db/schema'
import { hashToken } from '@/lib/api-auth'
import type { Db } from '@/db/client'
import type { User } from '@/db/schema'

import { GET as listUsersRoute } from '@/app/api/v1/users/route'

const AGENT_TOKEN = 'rud_users_agent_token'

let db: Db
let adminUser: User
let adminCookie: string
let plainUser: User
let plainCookie: string

let currentCookie: string | undefined
function asUser(cookie: string) { currentCookie = cookie }
function loggedOut() { currentCookie = undefined }
function agentAuth() { return { authorization: `Bearer ${AGENT_TOKEN}` } }

function mkReq(url: string, opts: { headers?: Record<string, string> } = {}) {
  return new Request(url, {
    headers: {
      'content-type': 'application/json',
      ...(currentCookie ? { cookie: currentCookie } : {}),
      ...opts.headers,
    },
  })
}

beforeAll(async () => {
  db = await createTestDb()
  ;({ user: adminUser, cookie: adminCookie } = await createSessionUser(db, { role: 'admin', name: '관리자' }))
  ;({ user: plainUser, cookie: plainCookie } = await createSessionUser(db, { role: 'user', name: '일반 유저' }))
  await db.insert(apiTokens).values({ name: '테스트 에이전트', tokenHash: hashToken(AGENT_TOKEN) })
})

describe('GET /api/v1/users', () => {
  it('401s when logged out', async () => {
    loggedOut()
    const res = await listUsersRoute(mkReq('http://x/api/v1/users'))
    expect(res.status).toBe(401)
  })

  it('allows any authenticated user', async () => {
    asUser(plainCookie)
    const res = await listUsersRoute(mkReq('http://x/api/v1/users'))
    expect(res.status).toBe(200)
  })

  it('allows an agent (needed to discover requesterEmail)', async () => {
    const res = await listUsersRoute(mkReq('http://x/api/v1/users', { headers: agentAuth() }))
    expect(res.status).toBe(200)
  })

  it('gives an admin exactly id/email/name/role/banned/slackUserId, and never passwordHash', async () => {
    asUser(adminCookie)
    const res = await listUsersRoute(mkReq('http://x/api/v1/users'))
    const { data } = await res.json()
    expect(data.length).toBeGreaterThanOrEqual(2)
    for (const row of data) {
      expect(row).not.toHaveProperty('passwordHash')
      expect(Object.keys(row).sort()).toEqual(['banned', 'email', 'id', 'name', 'role', 'slackUserId'])
    }
  })

  // The roster is readable by everyone because assignee pickers need it, but
  // an ordinary crew member has no reason to enumerate who is suspended or
  // how the Slack mapping is wired.
  it('hides banned and slackUserId from a non-admin — id/email/name/role only', async () => {
    asUser(plainCookie)
    const res = await listUsersRoute(mkReq('http://x/api/v1/users'))
    const { data } = await res.json()
    expect(data.length).toBeGreaterThanOrEqual(2)
    for (const row of data) {
      expect(Object.keys(row).sort()).toEqual(['email', 'id', 'name', 'role'])
    }
  })

  // Agents are infrastructure minted by an admin, and this is the only way
  // they can resolve a Slack user id to the requesterEmail that POST
  // /api/v1/issues requires. Gating them out would break issue intake.
  it('still shows an agent banned and slackUserId', async () => {
    const mapped = await seedUser(db, { name: 'Agent Visible', slackUserId: 'U0AGENTSEE1' })
    const res = await listUsersRoute(mkReq('http://x/api/v1/users', { headers: agentAuth() }))
    const { data } = await res.json()
    const row = data.find((u: { id: number }) => u.id === mapped.id)
    expect(row.slackUserId).toBe('U0AGENTSEE1')
    expect(row.banned).toBe(false) // pin the value — toHaveProperty passes on undefined
  })

  it('surfaces slackUserId when mapped, and null when not', async () => {
    const mapped = await seedUser(db, { name: 'Mapped User', slackUserId: 'U999' })
    asUser(adminCookie)
    const res = await listUsersRoute(mkReq('http://x/api/v1/users'))
    const { data } = await res.json()
    const row = data.find((u: { id: number }) => u.id === mapped.id)
    expect(row.slackUserId).toBe('U999')
    const unmapped = data.find((u: { id: number }) => u.id === adminUser.id)
    expect(unmapped.slackUserId).toBeNull()
  })

  it('surfaces banned', async () => {
    const target = await seedUser(db, { name: 'Banned Candidate' })
    const bannedTarget = await seedUser(db, { name: 'Banned', banned: true })
    asUser(adminCookie)
    const res = await listUsersRoute(mkReq('http://x/api/v1/users'))
    const rows = (await res.json()).data
    expect(rows.find((u: { id: number }) => u.id === target.id).banned).toBe(false)
    expect(rows.find((u: { id: number }) => u.id === bannedTarget.id).banned).toBe(true)
  })

  it('orders by name ascending', async () => {
    // Plain ASCII names so the assertion's JS string sort can't disagree with
    // Postgres's collation the way Korean names sometimes do.
    await seedUser(db, { name: 'Zeta' })
    await seedUser(db, { name: 'Alpha' })
    asUser(adminCookie)
    const res = await listUsersRoute(mkReq('http://x/api/v1/users'))
    const { data } = await res.json()
    const names = data.map((u: { name: string }) => u.name)
    expect(names).toEqual([...names].sort())
  })
})
