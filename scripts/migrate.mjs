import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL, { max: 1 })
try {
  await migrate(drizzle(sql), { migrationsFolder: 'drizzle' })
  console.log('migrations applied')
} catch {
  console.error('migration_failed')
  process.exitCode = 1
} finally {
  await sql.end()
}
