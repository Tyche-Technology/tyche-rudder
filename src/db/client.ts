import { drizzle } from 'drizzle-orm/postgres-js'
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core'
import postgres from 'postgres'
import * as schema from './schema'

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>
// Domain functions that must write inside a db.transaction() (see src/domain/events.ts)
// take this so the same recordEvent works whether called with a plain Db or a tx handle.
export type DbOrTx = Db | PgTransaction<PgQueryResultHKT, typeof schema>

let cached: Db | null = null

// Tests inject a PGlite-backed Db here (tests/helpers/db.ts); the app lazily
// connects postgres.js. ponytail: global override instead of DI plumbing —
// swap to per-request injection only if we ever need parallel isolated DBs.
export function getDb(): Db {
  const testDb = (globalThis as { __rudderTestDb?: Db }).__rudderTestDb
  if (testDb) return testDb
  if (!cached) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL not configured')
    cached = drizzle(postgres(url), { schema }) as unknown as Db
  }
  return cached
}
