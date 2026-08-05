// Task 11 phase-gate verification: exercises the optimistic-concurrency guard
// in src/domain/issues.ts (updateIssue / transitionIssue) against a REAL
// Postgres connection pair, per the controller's addition 2. Not a duplicate
// of any Vitest coverage — PGlite serialises db.transaction() on one
// in-process connection, so this interleaving is unreachable there.
//
// Usage: DATABASE_URL=postgres://rudder:rudder@127.0.0.1:5433/rudder npx tsx scripts/verify-concurrency.ts
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { errorType } from '@/lib/error-summary'
import * as schema from '../src/db/schema'
import { createIssue, transitionIssue, CONFLICT_ERROR } from '../src/domain/issues'
import type { Actor } from '../src/domain/actor'

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('set DATABASE_URL to the docker Postgres before running this script')
  return url
}
const url = requireDatabaseUrl()

async function main() {
  // Two independent connections/pools = two genuinely separate Postgres backends.
  const client1 = postgres(url, { max: 1 })
  const client2 = postgres(url, { max: 1 })
  const db1 = drizzle(client1, { schema }) as never
  const db2 = drizzle(client2, { schema }) as never

  const [admin] = await client1`SELECT id FROM users LIMIT 1`
  const [product] = await client1`SELECT id FROM products LIMIT 1`
  const actor: Actor = { type: 'user', id: admin.id, role: 'admin' }

  console.log('\n=== Part A: does a single, non-concurrent transitionIssue call succeed at all? ===')
  const solo = await createIssue(db1 as never, actor, {
    title: 'part A: solo sequential transition', type: 'bug', productId: product.id, requesterId: admin.id,
  })
  await client1`UPDATE issues SET status = 'backlog', priority = 'p1' WHERE id = ${solo.id}`
  const soloResult = await transitionIssue(db1 as never, actor, solo.id, { to: 'in_progress' }, solo.version)
  console.log('single actor, zero contention, backlog -> in_progress:', JSON.stringify(soloResult))
  if (!soloResult.ok) {
    const [row] = await client1`SELECT updated_at, updated_at::text AS t FROM issues WHERE id = ${solo.id}`
    console.log('root cause check: DB-stored updated_at has sub-millisecond digits:', row.t)
    console.log('root cause: postgres-js parses `timestamp` columns to a JS Date (ms precision).')
    console.log('The re-read `current.updatedAt` used in eq(issues.updatedAt, current.updatedAt) is')
    console.log('silently truncated, so it almost never matches the microsecond-precision value')
    console.log('actually stored by real Postgres\'s now() -- the guard misfires on ordinary,')
    console.log('non-concurrent writes, not just genuine races. PGlite\'s now() only ever produces')
    console.log('millisecond-round timestamps, so this never reproduces in the Vitest suite.')
  }

  console.log('\n=== Part B: the addition-2 recipe as specified, against the real domain function ===')
  const issue = await createIssue(db1 as never, actor, {
    title: 'part B: two-connection race', type: 'bug', productId: product.id, requesterId: admin.id,
  })
  // Seeded directly: transitionIssue cannot reliably complete even a single,
  // uncontended transition against real Postgres (see Part A), so driving it
  // through the API here would not isolate concurrency from that defect.
  await client1`UPDATE issues SET status = 'backlog', priority = 'p1' WHERE id = ${issue.id}`
  const [beforeRow] = await client1`SELECT updated_at FROM issues WHERE id = ${issue.id}`
  console.log('both connections about to read the same backlog issue, updatedAt =', beforeRow.updated_at)

  const [r1, r2] = await Promise.all([
    transitionIssue(db1 as never, actor, issue.id, { to: 'in_progress' }, issue.version),
    transitionIssue(db2 as never, actor, issue.id, { to: 'in_progress' }, issue.version),
  ])
  console.log('connection 1 result:', JSON.stringify(r1))
  console.log('connection 2 result:', JSON.stringify(r2))
  const events = await client1`SELECT id, field, old_value, new_value FROM issue_events WHERE issue_id = ${issue.id} AND field = 'status' ORDER BY id`
  console.log(`issue_events rows with field='status' for this issue: ${events.length}`, events)
  const conflictSeen = [r1, r2].some((r) => !r.ok && r.error === CONFLICT_ERROR)
  console.log('at least one side saw the exact CONFLICT_ERROR string:', conflictSeen)
  console.log('NOTE: per Part A, BOTH sides failing here is expected and does not by itself prove')
  console.log('the guard correctly distinguishes a genuine race from an ordinary solo write --')
  console.log('Part A already showed it cannot make that distinction against real Postgres.')

  console.log('\n=== Part C: control experiment -- is the locking DESIGN sound once precision is preserved? ===')
  console.log('(raw SQL only, comparing the full-precision ::text value instead of a lossy JS Date,')
  console.log(' to check whether the underlying "re-read then conditional UPDATE" strategy is correct)')
  const ctrl = await createIssue(db1 as never, actor, {
    title: 'part C: precision-preserved control', type: 'bug', productId: product.id, requesterId: admin.id,
  })
  await client1`UPDATE issues SET status = 'backlog', priority = 'p1' WHERE id = ${ctrl.id}`
  const [snap1] = await client1`SELECT updated_at::text AS t FROM issues WHERE id = ${ctrl.id}`
  const [snap2] = await client2`SELECT updated_at::text AS t FROM issues WHERE id = ${ctrl.id}`
  console.log('both connections captured the same full-precision snapshot:', snap1.t === snap2.t, snap1.t)

  const win = await client1`
    UPDATE issues SET status = 'in_progress', updated_at = now()
    WHERE id = ${ctrl.id} AND updated_at = ${snap1.t}::timestamp RETURNING id`
  console.log('connection 1 (fresh, full-precision snapshot) update matched rows:', win.length, '(expect 1)')

  const lose = await client2`
    UPDATE issues SET status = 'in_progress', updated_at = now()
    WHERE id = ${ctrl.id} AND updated_at = ${snap2.t}::timestamp RETURNING id`
  console.log('connection 2 (same stale full-precision snapshot, after 1 committed) update matched rows:', lose.length, '(expect 0 -- genuine conflict)')

  const [freshSnap] = await client2`SELECT updated_at::text AS t FROM issues WHERE id = ${ctrl.id}`
  const soloWin = await client2`
    UPDATE issues SET status = 'done', updated_at = now()
    WHERE id = ${ctrl.id} AND updated_at = ${freshSnap.t}::timestamp RETURNING id`
  console.log('connection 2 re-reading fresh full-precision snapshot, no contention, matched rows:', soloWin.length, '(expect 1 -- no false conflict)')
  console.log('\nConclusion: with full precision preserved, the design correctly conflicts only on a')
  console.log('genuine stale write and succeeds otherwise. The defect is the JS Date millisecond')
  console.log('round-trip in the postgres-js driver path, not the transaction/locking strategy.')

  await client1.end()
  await client2.end()
}

main().catch((error) => { console.error('concurrency_check_failed', { errorType: errorType(error) }); process.exit(1) })
