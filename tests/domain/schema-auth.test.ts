import { describe, it, expect, beforeAll } from 'vitest'
import { createTestDb, seedUser } from '../helpers/db'
import { invites, session, account, verification, users } from '@/db/schema'
import type { Db } from '@/db/client'

let db: Db

beforeAll(async () => { db = await createTestDb() })

describe('auth schema (additive)', () => {
  it('users carries email + better-auth columns; seedUser fills email', async () => {
    const user = await seedUser(db)
    expect(user.email).toMatch(/@test\.local$/)
    expect(user.emailVerified).toBe(false)
    expect(user.banned).toBe(false)
  })

  it('users insert without email rejects (email is NOT NULL)', async () => {
    await expect(db.insert(users).values({
      name: '테스트 유저',
    } as typeof users.$inferInsert).returning()).rejects.toThrow()
  })

  it('invites roundtrip with FK to users', async () => {
    const admin = await seedUser(db, { role: 'admin' })
    const invitee = await seedUser(db)
    const [row] = await db.insert(invites).values({
      tokenHash: 'a'.repeat(64), userId: invitee.id, invitedBy: admin.id,
      expiresAt: new Date(Date.now() + 7 * 86400_000),
    }).returning()
    expect(row.usedAt).toBeNull()
  })

  it('session/account/verification tables exist with integer user FKs', async () => {
    const user = await seedUser(db)
    const [s] = await db.insert(session).values({
      token: 't-1', userId: user.id, expiresAt: new Date(Date.now() + 86400_000),
    }).returning()
    expect(s.userId).toBe(user.id)
    const [a] = await db.insert(account).values({
      accountId: String(user.id), providerId: 'credential', userId: user.id,
    }).returning()
    expect(a.providerId).toBe('credential')
    const [v] = await db.insert(verification).values({
      identifier: 'x', value: 'y', expiresAt: new Date(Date.now() + 3600_000),
    }).returning()
    expect(v.identifier).toBe('x')
  })
})
