import { issueEvents } from '@/db/schema'
import type { DbOrTx } from '@/db/client'
import type { Actor } from './actor'
import { actorColumns } from './actor'

export const serialize = (v: unknown): string | null => (v == null ? null : String(v))

export async function recordEvent(
  db: DbOrTx, actor: Actor, issueId: number,
  field: string, oldValue: string | null, newValue: string | null,
): Promise<void> {
  await db.insert(issueEvents).values({ issueId, ...actorColumns(actor), field, oldValue, newValue })
}
