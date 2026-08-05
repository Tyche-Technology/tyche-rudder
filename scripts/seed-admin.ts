import { and, eq, sql } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { getAuth } from '@/lib/better-auth'
import { account, users } from '@/db/schema'
import { errorType } from '@/lib/error-summary'

// Arbitrary constant — this lock only ever guards this one check-then-act,
// so any fixed key works as long as nothing else in the app uses it.
const SEED_ADMIN_LOCK_KEY = 727100

// One-shot bootstrap: creates the very first admin. Everything after this
// goes through invites. Refuses if an admin already exists — NOT if any
// user exists. The guard's purpose is "don't mint a second admin when one
// is already there"; checking for any user at all also blocked the one
// case where bootstrapping is exactly right: a deployment left with users
// but zero admins (e.g. the sole admin self-demoted via the crew page, with
// no in-app path back) must stay recoverable by re-running this script with
// a fresh admin email.
//
// The check-then-act below is guarded by a session-scoped Postgres advisory
// lock, not a SQL transaction: a plain SELECT can't lock "zero rows" (an
// empty table, or a table with only non-admins, has nothing to lock), so
// two concurrent first runs with different emails would both pass the
// existence check and both create an admin. The lock blocks the second
// invocation until the first releases, so it then sees the just-created
// admin row and correctly reports 'already-seeded'.
// Session- rather than transaction-scoped deliberately: createUser() below
// issues its own queries through this same getDb(), and wrapping this in an
// explicit transaction would nest that call inside it — fine against real
// pooled Postgres, but PGlite (tests) is a single connection and deadlocks
// on the nested query. finally still releases on any throw.
export async function seedAdmin(): Promise<{ id: number } | 'already-seeded'> {
  const email = process.env.SEED_ADMIN_EMAIL?.trim()
  const password = process.env.SEED_ADMIN_PASSWORD
  const name = process.env.SEED_ADMIN_NAME?.trim()
  // password.length uses the RAW string, not trimmed — a real password with
  // leading/trailing spaces must survive intact. Only an entirely-blank
  // password is rejected (the .trim() === '' check). better-auth's admin
  // createUser route hashes whatever is given without checking length or
  // blankness itself (node_modules/better-auth/dist/plugins/admin/routes.mjs),
  // so this is the only validation boundary that exists; 8/128 mirror its
  // configured (but here-unenforced) password policy.
  if (
    !email || !name || !password || password.trim() === ''
    || password.length < 8 || password.length > 128
  ) {
    throw new Error(
      'SEED_ADMIN_EMAIL / SEED_ADMIN_NAME required (non-blank); SEED_ADMIN_PASSWORD required, 8-128 chars, not blank',
    )
  }
  const db = getDb()
  // getDb() is a pooled postgres-js client (default max 10) — nothing here
  // reserves a single connection for the critical section, so this lock's
  // correctness rests on every query below landing on the same backend pid
  // as the lock/unlock calls. That holds today only because everything in
  // the try block — our own SELECT, then createUser()'s users/account
  // inserts — runs strictly sequentially (each awaited before the next),
  // so the pool never has two queries in flight to hand out a second
  // connection. It is not a structural guarantee: if createUser() ever
  // issues concurrent queries internally, the unlock could land on a
  // different connection than the lock, and this guard would stop
  // guarding without erroring. If that ever needs to be structural, look
  // at reserving a connection (postgres-js .reserve() / drizzle's
  // db.transaction()) — deliberately not done here, since that nests
  // createUser()'s getDb() calls inside an open transaction/reservation,
  // which is exactly what deadlocks PGlite's single connection in tests
  // (see the comment above). Either way, a leaked lock is bounded: this
  // only ever runs as a short-lived CLI process that calls process.exit()
  // right after, and Postgres drops session-scoped advisory locks when
  // the holding connection closes.
  await db.execute(sql`select pg_advisory_lock(${SEED_ADMIN_LOCK_KEY})`)
  try {
    const [existingAdmin] = await db.select({ id: users.id }).from(users)
      .where(eq(users.role, 'admin')).limit(1)
    if (existingAdmin) return 'already-seeded'
    const created = await getAuth().api.createUser({ body: { email, password, name, role: 'admin' } })
    const id = Number(created.user.id)

    // better-auth's admin createUser inserts the user row, then hashes the
    // password and links the credential account as a separate,
    // non-transactional write (routes.mjs:194-208) — our own db.transaction()
    // can't cover it, since it runs on better-auth's own connection. A failure
    // between those two writes would leave an admin nobody can log in as,
    // permanently blocked from retry by the guard above (it just sees "a user
    // exists"). Verify the credential actually landed; if not, remove the
    // orphan so the environment stays bootstrappable. Both the check and the
    // cleanup stay inside the lock: if the delete happened after releasing it,
    // a waiting invocation could observe the broken user in between and
    // wrongly report 'already-seeded'.
    const [credential] = await db.select({ id: account.id }).from(account)
      .where(and(eq(account.userId, id), eq(account.providerId, 'credential')))
      .limit(1)
    if (!credential) {
      await db.delete(users).where(eq(users.id, id))
      throw new Error(`admin user ${id} was created but its credential failed to save; removed it — re-run this script to try again`)
    }

    return { id }
  } finally {
    await db.execute(sql`select pg_advisory_unlock(${SEED_ADMIN_LOCK_KEY})`)
  }
}

// Matches both the dev/CI invocation (`tsx scripts/seed-admin.ts`) and the
// production one (`node scripts/seed-admin.mjs`, esbuild-bundled — see the
// Dockerfile's builder stage, same treatment as scripts/migrate.mjs).
const isDirectRun = /seed-admin\.(ts|mjs)$/.test(process.argv[1] ?? '')
if (isDirectRun) {
  seedAdmin().then((r) => {
    console.log(r === 'already-seeded' ? '이미 관리자가 있어 건너뜀' : `admin created: id=${r.id}`)
    process.exit(0)
  }).catch((error) => { console.error('seed_admin_failed', { errorType: errorType(error) }); process.exit(1) })
}
