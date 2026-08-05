import { describe, it, expect, beforeAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb } from '../helpers/db'
import { getAuth } from '@/lib/better-auth'
import { users } from '@/db/schema'
import type { Db } from '@/db/client'
import { PATCH as updateUserRoute } from '@/app/api/v1/users/[id]/route'

// slackUserId is the Slack↔Rudder identity link: src/lib/slack.ts DMs whatever
// id sits in this column, and the Slack bot attributes inbound issues by it.
// The design gives it to admins (the crew screen), so the self-service
// /update-user route — reachable by ANY signed-in user through the catch-all
// handler at src/app/api/auth/[...all]/route.ts — must not be a second writer.
// better-auth enforces that via `input: false` on the additionalFields entry,
// which parseInputData honours (node_modules/better-auth/dist/db/schema.mjs:65)
// while the admin route bypasses it entirely (plugins/admin/routes.mjs:302).

let db: Db
let plainCookie: string
let plainId: number
let adminCookie: string

const PW = 'anchor-pw-123'

async function signIn(email: string) {
  const { headers } = await getAuth().api.signInEmail({ returnHeaders: true, body: { email, password: PW } })
  return headers.get('set-cookie')!
}

async function slackIdOf(id: number) {
  const [row] = await db.select().from(users).where(eq(users.id, id))
  return row.slackUserId
}

function updateSlack(cookie: string, slackUserId: string | null, id = plainId) {
  return updateUserRoute(new Request(`http://x/api/v1/users/${id}`, {
    method: 'PATCH',
    headers: { cookie, origin: 'http://x', 'content-type': 'application/json' },
    body: JSON.stringify({ slackUserId }),
  }), { params: Promise.resolve({ id: String(id) }) })
}

beforeAll(async () => {
  db = await createTestDb()
  await getAuth().api.createUser({
    body: { email: 'guard-admin@test.local', password: PW, name: '관리자', role: 'admin' },
  })
  const plain = await getAuth().api.createUser({
    body: { email: 'guard-plain@test.local', password: PW, name: '일반 선원', role: 'user' },
  })
  plainId = Number(plain.user.id)
  adminCookie = await signIn('guard-admin@test.local')
  plainCookie = await signIn('guard-plain@test.local')
})

describe('slackUserId write guard', () => {
  it('a non-admin cannot set their own slackUserId through self-service /update-user', async () => {
    await expect(getAuth().api.updateUser({
      headers: new Headers({ cookie: plainCookie }),
      body: { slackUserId: 'U0IMPERSONATE' } as never,
    })).rejects.toThrowError()

    expect(await slackIdOf(plainId)).toBeNull()
  })

  it('a non-admin cannot smuggle a channel id in either (would redirect their DMs to a channel)', async () => {
    await expect(getAuth().api.updateUser({
      headers: new Headers({ cookie: plainCookie }),
      body: { slackUserId: 'C01TESTCHAN1' } as never,
    })).rejects.toThrowError()

    expect(await slackIdOf(plainId)).toBeNull()
  })

  // parseInputData has two arms for an input:false field — it THROWS on a
  // truthy value (schema.mjs:72) but silently `continue`s on a falsy one
  // (:76), dropping the key instead of writing it. The tests above cover the
  // throw; this covers the drop, so a refactor that turned that `continue`
  // into a write could not land green.
  it('a falsy slackUserId from a non-admin is dropped, not written, even alongside a legal field', async () => {
    expect((await updateSlack(adminCookie, 'U0PREEXIST1')).status).toBe(200)

    await getAuth().api.updateUser({
      headers: new Headers({ cookie: plainCookie }),
      body: { name: '이름만 바꾸기', slackUserId: '' } as never,
    })

    expect(await slackIdOf(plainId)).toBe('U0PREEXIST1')
  })

  it('only the narrow app route lets an admin set and clear the mapping', async () => {
    expect((await updateSlack(plainCookie, 'U01ABCDEFGH')).status).toBe(403)
    expect((await updateSlack(adminCookie, 'U01ABCDEFGH')).status).toBe(200)
    expect(await slackIdOf(plainId)).toBe('U01ABCDEFGH')

    expect((await updateSlack(adminCookie, null)).status).toBe(200)
    expect(await slackIdOf(plainId)).toBeNull()
  })

  it('rejects a channel id and keeps Better Auth admin/update-user closed', async () => {
    expect((await updateSlack(adminCookie, 'C01TESTCHAN1')).status).toBe(400)
    await expect(getAuth().api.adminUpdateUser({
      headers: new Headers({ cookie: adminCookie }),
      body: { userId: String(plainId), data: { slackUserId: 'U01BYPASS12' } },
    })).rejects.toThrowError()
    expect(await slackIdOf(plainId)).toBeNull()
  })

  it('still surfaces slackUserId on the session (input: false must not hide it from output)', async () => {
    expect((await updateSlack(adminCookie, 'U02SESSION1')).status).toBe(200)

    const session = await getAuth().api.getSession({ headers: new Headers({ cookie: plainCookie }) })
    expect((session?.user as { slackUserId?: string | null } | undefined)?.slackUserId).toBe('U02SESSION1')
  })
})
