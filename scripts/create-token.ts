import { randomBytes } from 'node:crypto'
import { getDb } from '@/db/client'
import { apiTokens } from '@/db/schema'
import { hashToken } from '@/lib/api-auth'
import { errorType } from '@/lib/error-summary'

async function main() {
  const name = process.argv[2]
  if (!name) throw new Error('usage: npm run create-token <name>')
  const raw = `rud_${randomBytes(24).toString('hex')}`
  await getDb().insert(apiTokens).values({ name, tokenHash: hashToken(raw) })
  process.stdout.write(`token for "${name}" (한 번만 표시됩니다):\n${raw}\n`)
  process.exit(0)
}

main().catch((error) => { console.error('create_token_failed', { errorType: errorType(error) }); process.exit(1) })
