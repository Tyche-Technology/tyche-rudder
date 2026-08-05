import { randomBytes } from 'node:crypto'
import { eq, isNull, and, gt } from 'drizzle-orm'
import { hashPassword } from 'better-auth/crypto'
import { invites, users, account } from '@/db/schema'
import { hashToken } from '@/lib/api-auth'
import { getAuth } from '@/lib/better-auth'
import type { Db, DbOrTx } from '@/db/client'

export const INVITE_TTL_MS = 7 * 86400_000

// Invite = the user record exists from this moment. New users get a random
// password nobody knows (better-auth requires one; it is unusable until the
// invitee sets a real one via the accept flow — which doubles as the reset
// mechanism). Re-issuing for an existing email replaces that user's unused
// invites and never duplicates the user.
//
// Email is normalized here (not just at the zod boundary) because
// better-auth itself lowercases email on write (verified in the installed
// source: db/internal-adapter.mjs) — looking it up with the admin's raw
// casing would miss an existing user and misroute into createUser instead.
export async function createInvite(
  db: Db,
  input: { email: string; name: string; role: 'admin' | 'user'; invitedBy: number },
): Promise<{ rawToken: string; userId: number; expiresAt: Date }> {
  const email = input.email.trim().toLowerCase()
  const [existing] = await db.select().from(users).where(eq(users.email, email))
  const userId = existing
    ? existing.id
    : Number((await getAuth().api.createUser({
        body: { email, name: input.name, password: randomBytes(32).toString('hex'), role: input.role },
      })).user.id)
  const rawToken = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS)
  // getAuth().api.createUser above runs on better-auth's own connection and
  // can't join this transaction — only the delete+insert pair needs to be
  // atomic, so a failed insert can't leave an admin's prior invite deleted
  // with no replacement.
  await db.transaction(async (tx) => {
    if (existing) await tx.delete(invites).where(and(eq(invites.userId, userId), isNull(invites.usedAt)))
    await tx.insert(invites).values({ tokenHash: hashToken(rawToken), userId, invitedBy: input.invitedBy, expiresAt })
  })
  return { rawToken, userId, expiresAt }
}

export async function getInviteStatus(
  db: Db,
  rawToken: string,
): Promise<{ email: string; name: string; status: 'pending' | 'used' | 'expired' } | null> {
  const [row] = await db.select({
    email: users.email, name: users.name, usedAt: invites.usedAt, expiresAt: invites.expiresAt,
  }).from(invites).innerJoin(users, eq(users.id, invites.userId))
    .where(eq(invites.tokenHash, hashToken(rawToken)))
  if (!row) return null
  const status = row.usedAt ? 'used' as const : row.expiresAt < new Date() ? 'expired' as const : 'pending' as const
  return { email: row.email ?? '', name: row.name, status }
}

// Shared "not yet claimed, not expired" condition — accept's claimInvite
// (atomic UPDATE below) and consume/route.ts's own atomic UPDATE must
// enforce single-use AND the 7-day TTL identically. consume's own copy of
// this drifted (it checked usedAt but not expiresAt) until caught in
// review; both routes now derive it from here so a third caller can't
// repeat the same gap.
export function inviteLiveWhere() {
  return and(isNull(invites.usedAt), gt(invites.expiresAt, new Date()))
}

// JS-side version of the same rule, for a caller that already holds the row
// and must fail with the right status BEFORE attempting the mutation —
// consume/route.ts selects and authorizes (403 on a wrong owner) first,
// unlike claimInvite's update-first pattern below, which has no per-caller
// identity to check.
export function isInviteLive(invite: { usedAt: Date | null; expiresAt: Date }): boolean {
  return invite.usedAt === null && invite.expiresAt > new Date()
}

// Atomic claim: the UPDATE's WHERE is the whole single-use guard — two
// concurrent accepts can't both see used_at IS NULL. Takes DbOrTx: the
// accept route runs this and setPasswordDirect inside one db.transaction, so
// a failure in the password write rolls the claim back too and the invite
// stays usable for a legitimate retry. A claim that then fails for a domain
// reason (banned, no email) still commits — the admin re-issues in that case.
export async function claimInvite(
  db: DbOrTx,
  rawToken: string,
): Promise<{ invite: typeof invites.$inferSelect; user: typeof users.$inferSelect } | 'not-found' | 'gone'> {
  const [invite] = await db.update(invites).set({ usedAt: new Date() })
    .where(and(eq(invites.tokenHash, hashToken(rawToken)), inviteLiveWhere()))
    .returning()
  if (invite) {
    const [user] = await db.select().from(users).where(eq(users.id, invite.userId))
    return { invite, user }
  }
  const [exists] = await db.select({ id: invites.id }).from(invites).where(eq(invites.tokenHash, hashToken(rawToken)))
  return exists ? 'gone' as const : 'not-found' as const
}

// Sets a user's password without going through better-auth's admin
// endpoint. `getAuth().api.setUserPassword` runs behind adminMiddleware,
// which calls getAuthoritativeSessionFromCtx and unconditionally throws
// UNAUTHORIZED when there's no session (verified in the installed source:
// plugins/admin/routes.mjs) — unlike createUser, it has no server-call
// bypass. The invite-accept request is pre-auth by definition (the invitee
// has no session yet), so that endpoint can never be called from here.
// hashPassword is the same default hasher better-auth's own context wires
// up (context/create-context.mjs), and the account upsert mirrors exactly
// what setUserPassword/resetPassword do internally (db/internal-adapter.mjs:
// updatePassword matches on userId + providerId === 'credential').
//
// Trust boundary: this function performs NO authorization check of its
// own — callers must independently prove the caller may set this user's
// password (accept/route.ts does, via claimInvite's own DB-verified
// lookup). It also assumes calls for a given user are serialized: the
// select-then-branch upsert below has no unique constraint behind it (no
// unique index on account(user_id, provider_id) — deliberately, better-auth's
// own schema doesn't declare one either, since a user may legitimately link
// more than one account for a provider), so two concurrent calls for the
// same user could race into two `credential` rows.
export async function setPasswordDirect(db: DbOrTx, userId: number, password: string): Promise<void> {
  const passwordHash = await hashPassword(password)
  const [existing] = await db.select({ id: account.id }).from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
  if (existing) {
    await db.update(account).set({ password: passwordHash }).where(eq(account.id, existing.id))
  } else {
    await db.insert(account).values({ userId, providerId: 'credential', accountId: String(userId), password: passwordHash })
  }
}
