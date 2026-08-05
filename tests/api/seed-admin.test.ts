import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, seedUser } from '../helpers/db'
import { seedAdmin } from '../../scripts/seed-admin'
import { getAuth } from '@/lib/better-auth'
import { users } from '@/db/schema'
import type { Db } from '@/db/client'

let db: Db

// getAuth() caches a single instance per test file, bound to whatever db
// existed at its first call (src/lib/better-auth.ts) — so this file uses ONE
// shared db (beforeAll), not a fresh one per test. Tests that need to start
// from zero users clear the table explicitly instead of recreating the db.
beforeAll(async () => { db = await createTestDb() })

beforeEach(() => {
  process.env.SEED_ADMIN_EMAIL = 'first@test.local'
  process.env.SEED_ADMIN_PASSWORD = 'harbor-master-1'
  process.env.SEED_ADMIN_NAME = '항만장'
})

type CreateUserResult = Awaited<ReturnType<ReturnType<typeof getAuth>['api']['createUser']>>

describe('seedAdmin', () => {
  it('rejects a whitespace-only password (8 spaces)', async () => {
    process.env.SEED_ADMIN_PASSWORD = '        '
    await expect(seedAdmin()).rejects.toThrow()
  })

  it('rejects a password below the 8-char floor', async () => {
    process.env.SEED_ADMIN_PASSWORD = 'short7x'
    await expect(seedAdmin()).rejects.toThrow()
  })

  it('rejects a password above the 128-char ceiling', async () => {
    process.env.SEED_ADMIN_PASSWORD = 'a'.repeat(129)
    await expect(seedAdmin()).rejects.toThrow()
  })

  it('rejects a whitespace-only name', async () => {
    process.env.SEED_ADMIN_NAME = '   '
    await expect(seedAdmin()).rejects.toThrow()
  })

  it('rejects a whitespace-only email', async () => {
    process.env.SEED_ADMIN_EMAIL = '   '
    await expect(seedAdmin()).rejects.toThrow()
  })

  it('accepts a password at the 128-char ceiling', async () => {
    await db.delete(users)
    process.env.SEED_ADMIN_PASSWORD = 'a'.repeat(128)
    expect(await seedAdmin()).toHaveProperty('id')
  })

  it('cleans up and throws when createUser leaves no credential account behind', async () => {
    await db.delete(users)
    // Simulates better-auth's non-transactional user-insert-then-credential-
    // link (node_modules/better-auth/dist/plugins/admin/routes.mjs:194-208):
    // a "success" that only did the first half.
    const spy = vi.spyOn(getAuth().api, 'createUser').mockImplementationOnce(async () => {
      const [user] = await db.insert(users)
        .values({ email: 'first@test.local', name: '항만장', role: 'admin' })
        .returning()
      return { user: { id: String(user.id) } } as unknown as CreateUserResult
    })

    await expect(seedAdmin()).rejects.toThrow(/re-run/i)

    const remaining = await db.select().from(users).where(eq(users.email, 'first@test.local'))
    expect(remaining).toHaveLength(0)
    spy.mockRestore()
  })

  it('creates the first admin once, then refuses the same email', async () => {
    await db.delete(users)
    const first = await seedAdmin()
    expect(first).toHaveProperty('id')
    expect(await seedAdmin()).toBe('already-seeded')
  })

  it('creates an admin when users exist but none is an admin (recovery after a self-demotion lockout)', async () => {
    await db.delete(users)
    await seedUser(db, { email: 'deckhand@test.local' })
    expect(await seedAdmin()).toHaveProperty('id')
  })

  it('refuses when an admin already exists, even among other non-admin users', async () => {
    await db.delete(users)
    await seedUser(db, { email: 'deckhand@test.local' })
    await seedUser(db, { email: 'existing-admin@test.local', role: 'admin' })
    expect(await seedAdmin()).toBe('already-seeded')
  })
})
