import { eq } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { apiTokens } from '@/db/schema'
import { errorType } from '@/lib/error-summary'

// Revocation sets a flag instead of deleting the row: comments, issue_events
// and attachments all reference api_tokens ON DELETE restrict, so a token pins
// its row the moment its agent writes anything (an unused token would still
// delete cleanly — but an unused token has nothing to revoke). `DELETE FROM
// api_tokens` is the move an operator reaches for first, and it fails with a
// foreign-key violation that reads like a bug — hence this script.
//
// Takes the token's NAME, not the secret: the secret is shown once at mint
// time and only its sha256 is stored, so by the time you need to revoke one
// the name is all anyone has.

// Times print as ISO-8601 UTC, deliberately not the KST the product UI uses
// (that rule owns src/ui/format.ts and what users see). This output gets
// pasted into incident notes beside Cloud Logging timestamps, which are UTC.
//
// stdout is a pipe under `npm run`, so writes are async — exiting immediately
// after can truncate the confirmation. Never report success you didn't print.
function say(line: string): Promise<void> {
  return new Promise((resolve) => { process.stdout.write(line, () => resolve()) })
}

async function main() {
  const name = process.argv[2]
  if (!name) throw new Error('usage: npm run revoke-token <name>')

  const db = getDb()
  const rows = await db.select({
    id: apiTokens.id,
    createdAt: apiTokens.createdAt,
    lastUsedAt: apiTokens.lastUsedAt,
    revokedAt: apiTokens.revokedAt,
  }).from(apiTokens).where(eq(apiTokens.name, name))

  if (rows.length === 0) throw new Error(`no token named "${name}"`)

  // api_tokens.name has no unique constraint and create-token does not check,
  // so duplicates are one command apart. Refuse rather than guess which to
  // kill — but print enough that the follow-up is unambiguous, or the operator
  // ends up eyeballing an id under time pressure and revokes the wrong one.
  if (rows.length > 1) {
    const detail = rows.map((r) =>
      `  id=${r.id} created=${r.createdAt.toISOString()}` +
      ` lastUsed=${r.lastUsedAt?.toISOString() ?? 'never'}` +
      ` revoked=${r.revokedAt?.toISOString() ?? 'no'}`).join('\n')
    await say(`${rows.length} tokens named "${name}":\n${detail}\n`)
    throw new Error(
      `refusing to guess. Revoke the one you mean by id:\n` +
      `  UPDATE api_tokens SET revoked_at = now() WHERE id = <id>;`)
  }

  const [token] = rows
  if (token.revokedAt) {
    await say(`token "${name}" was already revoked at ${token.revokedAt.toISOString()}\n`)
    process.exit(0)
  }

  await db.update(apiTokens).set({ revokedAt: new Date() }).where(eq(apiTokens.id, token.id))
  await say(`revoked "${name}" (id=${token.id}) — every request carrying it now 401s\n`)
  process.exit(0)
}

main().catch((error) => { console.error('revoke_token_failed', { errorType: errorType(error) }); process.exit(1) })
