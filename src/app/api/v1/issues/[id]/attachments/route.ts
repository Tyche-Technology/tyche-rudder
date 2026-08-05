import { getDb } from '@/db/client'
import { actorFromRequest } from '@/lib/api-auth'
import { withErrorEnvelope } from '@/lib/with-error-envelope'
import { getObjectStore } from '@/lib/object-store'
import { errorType } from '@/lib/error-summary'
import { createAttachment } from '@/domain/attachments'
import {
  ok, fail, unauthorized, forbidden, idFromParams, issueExists, failDomain, readCappedFormData, BODY_TOO_LARGE,
} from '../../../respond'

const MAX_BYTES = 10 * 1024 * 1024
// Multipart framing (boundary lines, the one part's own headers) adds a
// small amount of overhead on top of the raw file bytes — 64KB is generous
// slack for a single-file upload without meaningfully raising the real cap.
const MULTIPART_BODY_LIMIT = MAX_BYTES + 64 * 1024
// SVG excluded on purpose — it can carry <script>, unlike the other formats
// here. content-disposition: attachment on the download side (see
// attachments/[id]/route.ts) is the real XSS backstop either way.
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain']

function startsWith(buffer: Buffer, signature: readonly number[]): boolean {
  return signature.every((byte, index) => buffer[index] === byte)
}

function hasValidContent(type: string, buffer: Buffer): boolean {
  if (type === 'image/png') return startsWith(buffer, [137, 80, 78, 71, 13, 10, 26, 10])
  if (type === 'image/jpeg') {
    return startsWith(buffer, [0xff, 0xd8, 0xff]) && buffer.at(-2) === 0xff && buffer.at(-1) === 0xd9
  }
  if (type === 'image/gif') return buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a'
  if (type === 'image/webp') return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  if (type === 'application/pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-'
  if (type === 'text/plain') {
    if (buffer.includes(0)) return false
    try { new TextDecoder('utf-8', { fatal: true }).decode(buffer); return true } catch { return false }
  }
  return false
}

export const POST = withErrorEnvelope(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const db = getDb()
  const actor = await actorFromRequest(db, req)
  if (!actor) return unauthorized()
  if (actor.type === 'agent') return forbidden() // 도선사 첨부는 spec §10 이후 (comments/route.ts와 동일)
  const issueId = await idFromParams(ctx.params)
  if (!issueId) return fail('이슈를 찾을 수 없습니다', 404)
  // Pre-check ahead of the object-store save below: without this, a bad
  // issue id still writes the file to the bucket (createAttachment's own
  // existence check only runs after, inside its transaction), and nothing
  // ever deletes that orphaned object. Race-free for the same reason
  // productExists/userExists/milestoneExists are — nothing deletes issues.
  if (!(await issueExists(db, issueId))) return fail('이슈를 찾을 수 없습니다', 404)
  // Fast-path guard on the client-declared header, ahead of the expensive
  // parse below — a client can lie about content-length, so this does NOT
  // replace either check below, it only short-circuits the obvious case
  // without touching the body at all. Compared against MULTIPART_BODY_LIMIT,
  // not MAX_BYTES: the declared length is the whole multipart body (file
  // bytes + boundary/part-header framing), which is legitimately larger than
  // the file alone.
  const declaredLength = Number(req.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MULTIPART_BODY_LIMIT) {
    return fail('파일이 너무 큽니다 (최대 10MB)', 413)
  }
  // A client can also lie by omission — no content-length header at all, or
  // chunked transfer encoding — which the check above can't catch. readCappedFormData
  // bounds the multipart body at the stream level as it's parsed, so a
  // client can't force more than ~MULTIPART_BODY_LIMIT into memory regardless
  // of what (if anything) it declares up front.
  const form = await readCappedFormData(req, MULTIPART_BODY_LIMIT)
  if (form === BODY_TOO_LARGE) return fail('파일이 너무 큽니다 (최대 10MB)', 413)
  const file = form?.get('file')
  if (!(file instanceof File)) return fail('file 필드가 필요합니다', 400)
  if (file.size > MAX_BYTES) return fail('파일이 너무 큽니다 (최대 10MB)', 413)
  if (!ALLOWED_TYPES.includes(file.type)) return fail('지원하지 않는 파일 형식입니다', 422)
  // Server-generated key, issue-scoped — never the client's filename, so a
  // crafted filename (../, null byte) can't reach the object key or a path.
  const gcsObject = `issues/${issueId}/${crypto.randomUUID()}`
  const buffer = Buffer.from(await file.arrayBuffer())
  if (!hasValidContent(file.type, buffer)) return fail('파일 내용이 형식과 일치하지 않습니다', 422)
  // Save before insert: a store failure here throws up to withErrorEnvelope's
  // 500 and no row is written. The reverse order (insert-then-save) could
  // leave a row pointing at an object that was never written.
  const store = getObjectStore()
  await store.save(gcsObject, buffer, file.type)
  try {
    const result = await createAttachment(db, actor, issueId, {
      filename: file.name, contentType: file.type, sizeBytes: file.size, gcsObject,
    })
    if (result.ok) return ok(result.attachment, 201)
    await store.delete(gcsObject)
    return failDomain(result)
  } catch (error) {
    await store.delete(gcsObject).catch((cleanupError) => {
      console.error('attachment_cleanup_failed', { errorType: errorType(cleanupError) })
    })
    throw error
  }
})
