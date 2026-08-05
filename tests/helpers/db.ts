import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import * as schema from '@/db/schema'
import type { Db } from '@/db/client'
import type { ObjectStore } from '@/lib/object-store'

export async function createTestDb(): Promise<Db> {
  process.env.BETTER_AUTH_SECRET ||= 'vitest-only-secret-0123456789abcdef!!'
  const db = drizzle(new PGlite(), { schema }) as unknown as Db
  await migrate(db as never, { migrationsFolder: 'drizzle' })
  ;(globalThis as { __rudderTestDb?: Db }).__rudderTestDb = db
  return db
}

export async function seedUser(db: Db, overrides: Partial<typeof schema.users.$inferInsert> = {}) {
  const [user] = await db.insert(schema.users)
    .values({
      email: `u-${Math.random().toString(36).slice(2, 8)}@test.local`,
      name: '테스트 유저',
      ...overrides,
    })
    .returning()
  return user
}

export async function seedProduct(
  db: Db, createdByUserId: number, name = `product-${Math.random().toString(36).slice(2, 8)}`,
) {
  const [product] = await db.insert(schema.products).values({ name, createdByUserId }).returning()
  return product
}

// Map-backed fake, same override pattern as createTestDb/__rudderTestDb —
// keeps attachment tests off both the GCS SDK and the filesystem. `size()`
// is test-only (not part of ObjectStore) — it lets a test prove nothing was
// written, e.g. the no-orphaned-object-on-404 regression.
export function installFakeStore(): ObjectStore & { size(): number } {
  const files = new Map<string, Buffer>()
  const store = {
    async save(object: string, data: Buffer) { files.set(object, data) },
    async read(object: string) {
      const data = files.get(object)
      if (!data) throw new Error(`fake store: no object at ${object}`)
      return data
    },
    async delete(object: string) { files.delete(object) },
    size() { return files.size },
  }
  ;(globalThis as { __rudderTestStore?: ObjectStore }).__rudderTestStore = store
  return store
}
