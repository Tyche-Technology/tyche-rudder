import { eq } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { attachments } from '@/db/schema'
import { actorFromRequest } from '@/lib/api-auth'
import { withErrorEnvelope } from '@/lib/with-error-envelope'
import { getObjectStore } from '@/lib/object-store'
import { fail, unauthorized, forbidden, idFromParams } from '../../respond'

type Ctx = { params: Promise<{ id: string }> }

export const GET = withErrorEnvelope(async (req: Request, ctx: Ctx) => {
  const db = getDb()
  const actor = await actorFromRequest(db, req)
  if (!actor) return unauthorized()
  if (actor.type === 'agent') return forbidden()
  const id = await idFromParams(ctx.params)
  if (!id) return fail('첨부파일을 찾을 수 없습니다', 404)
  const [row] = await db.select().from(attachments).where(eq(attachments.id, id))
  if (!row) return fail('첨부파일을 찾을 수 없습니다', 404)
  const buf = await getObjectStore().read(row.gcsObject)
  // Buffer's TS type (ArrayBufferLike) doesn't structurally satisfy DOM's
  // BodyInit (ArrayBuffer-only) — a plain Uint8Array view does.
  return new Response(new Uint8Array(buf), {
    headers: {
      'content-type': row.contentType,
      // Always "attachment" (never "inline"): forces a download instead of
      // in-browser rendering, so a mislabeled upload (e.g. HTML bytes with a
      // claimed image content-type) can't execute in the page origin.
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
      // Redundant while content-disposition forces a download rather than
      // in-browser rendering, but one line of defense-in-depth in case that
      // ever changes.
      'x-content-type-options': 'nosniff',
    },
  })
})
