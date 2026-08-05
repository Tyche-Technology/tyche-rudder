import { getAuth } from '@/lib/better-auth'
import type { Db } from '@/db/client'
import type { User } from '@/db/schema'
import { users } from '@/db/schema'
import { eq } from 'drizzle-orm'

let seq = 0
export async function createSessionUser(
  db: Db, overrides: { role?: 'admin' | 'user'; email?: string; name?: string } = {},
): Promise<{ user: User; cookie: string }> {
  const email = overrides.email ?? `session-u${++seq}-${Math.random().toString(36).slice(2, 8)}@test.local`
  const password = 'vitest-session-pw-1'
  await getAuth().api.createUser({
    body: { email, password, name: overrides.name ?? '테스트 유저', role: overrides.role ?? 'user' },
  })
  const { headers } = await getAuth().api.signInEmail({ returnHeaders: true, body: { email, password } })
  const [user] = await db.select().from(users).where(eq(users.email, email))
  return { user, cookie: headers.get('set-cookie')! }
}
