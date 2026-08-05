import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, seedUser, seedProduct, installFakeStore } from '../helpers/db'
import { createSessionUser } from '../helpers/auth'
import { apiTokens, attachments, issueEvents } from '@/db/schema'
import type { Db } from '@/db/client'
import type { User } from '@/db/schema'
import type { Actor } from '@/domain/actor'
import type { ObjectStore } from '@/lib/object-store'
import { hashToken } from '@/lib/api-auth'
import * as issuesDomain from '@/domain/issues'

import { POST as uploadRoute } from '@/app/api/v1/issues/[id]/attachments/route'
import { GET as downloadRoute } from '@/app/api/v1/attachments/[id]/route'
import { GET as getIssueRoute } from '@/app/api/v1/issues/[id]/route'

const MAX_BYTES = 10 * 1024 * 1024
const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const MAX_ATTACHMENTS_PER_ISSUE = 20
const MAX_TOTAL_BYTES_PER_ISSUE = 100 * 1024 * 1024
const MAX_ATTACHMENTS_PER_USER_PER_DAY = 100
const MAX_BYTES_PER_USER_PER_DAY = 500 * 1024 * 1024

const AGENT_TOKEN = 'rud_agent_attachments_token'

let db: Db
let adminUser: User
let plainUser: User
let plainCookie: string
let productId: number
let adminActor: Actor

let currentCookie: string | undefined
function asUser(cookie: string) { currentCookie = cookie }
function loggedOut() { currentCookie = undefined }
function agentAuth() { return { authorization: `Bearer ${AGENT_TOKEN}` } }
function ctx(id: number) { return { params: Promise.resolve({ id: String(id) }) } }

// Merges the ambient session cookie into a request's headers, same pattern
// as the mkReq-style helpers elsewhere — the cookie is the only ambient
// credential these tests carry now that @/lib/session is no longer mocked.
// origin defaults to the request's own origin (every request in this file
// targets http://x) so cookie-authed uploads keep passing the fail-closed
// guard without threading Origin through every call site.
function withAuth(headers: Record<string, string> = {}): Record<string, string> {
  return { ...(currentCookie ? { cookie: currentCookie } : {}), origin: 'http://x', ...headers }
}

function uploadReq(url: string, file: File | null, headers: Record<string, string> = {}) {
  const form = new FormData()
  if (file) form.set('file', file)
  return new Request(url, { method: 'POST', headers: withAuth(headers), body: form })
}

function getReq(url: string, headers: Record<string, string> = {}) {
  return new Request(url, { headers: withAuth(headers) })
}

async function issueFixture() {
  return issuesDomain.createIssue(db, adminActor, {
    title: `첨부-${Math.random().toString(36).slice(2, 8)}`, type: 'bug', productId, requesterId: plainUser.id,
  })
}

beforeAll(async () => {
  db = await createTestDb()
  adminUser = await seedUser(db, { role: 'admin' })
  ;({ user: plainUser, cookie: plainCookie } = await createSessionUser(db, { role: 'user' }))
  productId = (await seedProduct(db, adminUser.id)).id
  adminActor = { type: 'user', id: adminUser.id, role: 'admin' }
  await db.insert(apiTokens).values({ name: '테스트 에이전트', tokenHash: hashToken(AGENT_TOKEN) })
})

let store: ReturnType<typeof installFakeStore>
beforeEach(() => {
  loggedOut()
  store = installFakeStore()
})

afterEach(() => {
  delete (globalThis as { __rudderTestStore?: ObjectStore }).__rudderTestStore
})

describe('POST /api/v1/issues/:id/attachments', () => {
  it('401s when logged out', async () => {
    const issue = await issueFixture()
    const png = new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' })
    const res = await uploadRoute(uploadReq(`http://x/api/v1/issues/${issue.id}/attachments`, png), ctx(issue.id))
    expect(res.status).toBe(401)
  })

  it('201s, saves to the object store, and records an attachment event for a user actor', async () => {
    const issue = await issueFixture()
    asUser(plainCookie)
    const bytes = PNG_BYTES
    const png = new File([bytes], '스크린샷.png', { type: 'image/png' })
    const res = await uploadRoute(uploadReq(`http://x/api/v1/issues/${issue.id}/attachments`, png), ctx(issue.id))
    expect(res.status).toBe(201)
    const { data } = await res.json()
    expect(data.filename).toBe('스크린샷.png')
    expect(data.actorType).toBe('user')
    expect(data.actorUserId).toBe(plainUser.id)
    expect(data.actorTokenId).toBeNull()
    // gcs_object is a bucket key, not a client-facing field — must not be on
    // the wire (domain/attachments.ts selects explicit columns for this).
    expect(data.gcsObject).toBeUndefined()
    const events = await db.select().from(issueEvents).where(eq(issueEvents.issueId, issue.id))
    expect(events.some((e) => e.field === 'attachment' && e.newValue === '스크린샷.png')).toBe(true)
    const dl = await downloadRoute(getReq(`http://x/api/v1/attachments/${data.id}`), ctx(data.id))
    expect(Array.from(Buffer.from(await dl.arrayBuffer()))).toEqual(Array.from(bytes))
  })

  it('403s for an agent (parity with comments — agent-authored content is deferred to spec §10)', async () => {
    const issue = await issueFixture()
    const png = new File([new Uint8Array([1])], 'agent.png', { type: 'image/png' })
    const res = await uploadRoute(uploadReq(`http://x/api/v1/issues/${issue.id}/attachments`, png, agentAuth()), ctx(issue.id))
    expect(res.status).toBe(403)
  })

  it('400s when the file field is missing', async () => {
    const issue = await issueFixture()
    asUser(plainCookie)
    const res = await uploadRoute(uploadReq(`http://x/api/v1/issues/${issue.id}/attachments`, null), ctx(issue.id))
    expect(res.status).toBe(400)
  })

  it('400s when the file field is present but not a File', async () => {
    const issue = await issueFixture()
    asUser(plainCookie)
    const form = new FormData()
    form.set('file', 'not-a-file')
    const res = await uploadRoute(
      new Request(`http://x/api/v1/issues/${issue.id}/attachments`, { method: 'POST', headers: withAuth(), body: form }),
      ctx(issue.id),
    )
    expect(res.status).toBe(400)
  })

  it('413s an oversized file (actual bytes, not a declared size)', async () => {
    const issue = await issueFixture()
    asUser(plainCookie)
    const big = new File([new Uint8Array(11 * 1024 * 1024)], 'big.png', { type: 'image/png' })
    const res = await uploadRoute(uploadReq(`http://x/api/v1/issues/${issue.id}/attachments`, big), ctx(issue.id))
    expect(res.status).toBe(413)
  })

  it('413s on a lying content-length header before the body is even parsed', async () => {
    const issue = await issueFixture()
    asUser(plainCookie)
    // Real body is 1 byte — only the declared header is oversized. This
    // proves the content-length fast-path fires on its own, not just the
    // post-parse file.size check the previous test already covers.
    const req = new Request(`http://x/api/v1/issues/${issue.id}/attachments`, {
      method: 'POST',
      headers: withAuth({ 'content-length': String(99 * 1024 * 1024) }),
      body: new Uint8Array([1]),
    })
    const res = await uploadRoute(req, ctx(issue.id))
    expect(res.status).toBe(413)
  })

  it('413s an oversized body with NO content-length header at all, and stops reading before the whole thing is buffered', async () => {
    const issue = await issueFixture()
    asUser(plainCookie)
    // Neither the fast content-length pre-check nor the post-parse file.size
    // check can fire here on their own terms: there is no content-length
    // header (as a chunked-transfer client would send), so the only thing
    // standing between this and an unbounded formData() buffer is the
    // stream-level cap. 200 x 64KB (~12.8MB) exceeds the ~10MB+64KB
    // multipart cap, so a correct implementation must abort partway through.
    const boundary = '----attachtest'
    const enc = new TextEncoder()
    const head = enc.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="big.bin"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`,
    )
    const tail = enc.encode(`\r\n--${boundary}--\r\n`)
    const chunk = new Uint8Array(64 * 1024).fill(1)
    let pulls = 0
    let stage: 'head' | 'chunks' | 'tail' | 'done' = 'head'
    let sent = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++
        if (stage === 'head') { controller.enqueue(head); stage = 'chunks'; return }
        if (stage === 'chunks') {
          if (sent >= 200) { stage = 'tail'; return }
          sent++
          controller.enqueue(chunk)
          return
        }
        if (stage === 'tail') { controller.enqueue(tail); stage = 'done'; return }
        controller.close()
      },
    })
    const req = new Request(`http://x/api/v1/issues/${issue.id}/attachments`, {
      method: 'POST',
      headers: withAuth({ 'content-type': `multipart/form-data; boundary=${boundary}` }),
      body,
      duplex: 'half',
    } as RequestInit)
    const res = await uploadRoute(req, ctx(issue.id))
    expect(res.status).toBe(413)
    // Proves this isn't "buffer everything, then notice it's too big" —
    // the source stream got canceled well before all 200 chunks were pulled.
    expect(pulls).toBeLessThan(200)
  })

  it('does not 413 a legal file just under 10MB, even though its multipart framing pushes content-length past MAX_BYTES', async () => {
    const issue = await issueFixture()
    asUser(plainCookie)
    // file.size stays legal (<= MAX_BYTES), but a real browser declares
    // content-length for the whole multipart body — file bytes plus boundary
    // and part-header framing — which lands a little over MAX_BYTES for a
    // file this close to the cap. The fast-path check must compare against
    // MULTIPART_BODY_LIMIT, not MAX_BYTES, or this legal upload 413s.
    const fileSize = MAX_BYTES - 50
    const bytes = new Uint8Array(fileSize).fill(1)
    bytes.set(PNG_BYTES)
    const probe = new Request('http://x/probe', {
      method: 'POST',
      body: (() => { const f = new FormData(); f.set('file', new File([bytes], 'big.png', { type: 'image/png' })); return f })(),
    })
    const bodyBuf = await probe.arrayBuffer()
    const req = new Request(`http://x/api/v1/issues/${issue.id}/attachments`, {
      method: 'POST',
      headers: withAuth({ 'content-type': probe.headers.get('content-type')!, 'content-length': String(bodyBuf.byteLength) }),
      body: bodyBuf,
    })
    const res = await uploadRoute(req, ctx(issue.id))
    expect(res.status).toBe(201)
  })

  it('422s a disallowed content type (e.g. an executable)', async () => {
    const issue = await issueFixture()
    asUser(plainCookie)
    const exe = new File([new Uint8Array([1])], 'virus.exe', { type: 'application/x-msdownload' })
    const res = await uploadRoute(uploadReq(`http://x/api/v1/issues/${issue.id}/attachments`, exe), ctx(issue.id))
    expect(res.status).toBe(422)
  })

  it('422s SVG specifically (excluded from the allowlist as a script-capable image type)', async () => {
    const issue = await issueFixture()
    asUser(plainCookie)
    const svg = new File([new Uint8Array([1])], 'evil.svg', { type: 'image/svg+xml' })
    const res = await uploadRoute(uploadReq(`http://x/api/v1/issues/${issue.id}/attachments`, svg), ctx(issue.id))
    expect(res.status).toBe(422)
  })

  it.each([
    ['PNG', 'image/png', PNG_BYTES],
    ['JPEG', 'image/jpeg', new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9])],
    ['GIF', 'image/gif', new TextEncoder().encode('GIF89a')],
    ['WebP', 'image/webp', new TextEncoder().encode('RIFF\0\0\0\0WEBP')],
    ['PDF', 'application/pdf', new TextEncoder().encode('%PDF-1.7\n%%EOF')],
    ['UTF-8 text', 'text/plain', new TextEncoder().encode('안전한 텍스트')],
  ])('accepts bytes matching the declared %s type', async (_label, type, bytes) => {
    const issue = await issueFixture()
    asUser(plainCookie)
    const file = new File([bytes], `valid-${issue.id}`, { type })
    const res = await uploadRoute(uploadReq(`http://x/api/v1/issues/${issue.id}/attachments`, file), ctx(issue.id))
    expect(res.status).toBe(201)
  })

  it('422s HTML bytes mislabeled as PNG and invalid text bytes without storing them', async () => {
    const issue = await issueFixture()
    asUser(plainCookie)
    const html = new File(['<script>alert(1)</script>'], 'fake.png', { type: 'image/png' })
    expect((await uploadRoute(uploadReq(`http://x/api/v1/issues/${issue.id}/attachments`, html), ctx(issue.id))).status).toBe(422)
    const invalidText = new File([new Uint8Array([0, 0xff])], 'fake.txt', { type: 'text/plain' })
    expect((await uploadRoute(uploadReq(`http://x/api/v1/issues/${issue.id}/attachments`, invalidText), ctx(issue.id))).status).toBe(422)
    expect(store.size()).toBe(0)
  })

  it('rejects the 21st attachment and compensates the object-store write', async () => {
    const issue = await issueFixture()
    asUser(plainCookie)
    await db.insert(attachments).values(Array.from({ length: MAX_ATTACHMENTS_PER_ISSUE }, (_, index) => ({
      issueId: issue.id,
      filename: `${index}.txt`,
      contentType: 'text/plain',
      sizeBytes: 1,
      gcsObject: `seed/count/${issue.id}/${index}`,
      actorType: 'user' as const,
      actorUserId: plainUser.id,
    })))
    const file = new File([PNG_BYTES], 'over-count.png', { type: 'image/png' })
    const res = await uploadRoute(uploadReq(`http://x/api/v1/issues/${issue.id}/attachments`, file), ctx(issue.id))
    expect(res.status).toBe(422)
    expect(store.size()).toBe(0)
  })

  it('rejects an upload that would push an issue over 100MB total', async () => {
    const issue = await issueFixture()
    asUser(plainCookie)
    await db.insert(attachments).values({
      issueId: issue.id,
      filename: 'existing.bin',
      contentType: 'application/pdf',
      sizeBytes: MAX_TOTAL_BYTES_PER_ISSUE,
      gcsObject: `seed/bytes/${issue.id}`,
      actorType: 'user',
      actorUserId: plainUser.id,
    })
    const file = new File([PNG_BYTES], 'over-total.png', { type: 'image/png' })
    const res = await uploadRoute(uploadReq(`http://x/api/v1/issues/${issue.id}/attachments`, file), ctx(issue.id))
    expect(res.status).toBe(422)
    expect(store.size()).toBe(0)
  })

  it('rate-limits a user after 100 attachments in a rolling day across issues', async () => {
    const source = await issueFixture()
    const target = await issueFixture()
    asUser(plainCookie)
    const objects = Array.from({ length: MAX_ATTACHMENTS_PER_USER_PER_DAY }, (_, index) => `seed/daily-count/${source.id}/${index}`)
    await db.insert(attachments).values(objects.map((gcsObject, index) => ({
      issueId: source.id,
      filename: `${index}.txt`,
      contentType: 'text/plain',
      sizeBytes: 1,
      gcsObject,
      actorType: 'user' as const,
      actorUserId: plainUser.id,
    })))
    const file = new File([PNG_BYTES], 'over-daily-count.png', { type: 'image/png' })
    const res = await uploadRoute(uploadReq(`http://x/api/v1/issues/${target.id}/attachments`, file), ctx(target.id))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toContain('24시간')
    expect(store.size()).toBe(0)
    await db.delete(attachments).where(eq(attachments.issueId, source.id))
  })

  it('rate-limits a user after 500MB in a rolling day across issues', async () => {
    const source = await issueFixture()
    const target = await issueFixture()
    asUser(plainCookie)
    await db.insert(attachments).values({
      issueId: source.id,
      filename: 'daily-cap.bin',
      contentType: 'application/pdf',
      sizeBytes: MAX_BYTES_PER_USER_PER_DAY,
      gcsObject: `seed/daily-bytes/${source.id}`,
      actorType: 'user',
      actorUserId: plainUser.id,
    })
    const file = new File([PNG_BYTES], 'over-daily-bytes.png', { type: 'image/png' })
    const res = await uploadRoute(uploadReq(`http://x/api/v1/issues/${target.id}/attachments`, file), ctx(target.id))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toContain('24시간')
    expect(store.size()).toBe(0)
    await db.delete(attachments).where(eq(attachments.issueId, source.id))
  })

  it('404s for a missing issue, and leaves the object store empty (no orphaned write)', async () => {
    asUser(plainCookie)
    const png = new File([PNG_BYTES], 'x.png', { type: 'image/png' })
    const res = await uploadRoute(uploadReq('http://x/api/v1/issues/999999/attachments', png), ctx(999999))
    expect(res.status).toBe(404)
    // The existence check must run before getObjectStore().save() — otherwise
    // the file lands in the bucket with no row ever created to reference it,
    // and there is no delete endpoint to clean it up.
    expect(store.size()).toBe(0)
  })
})

describe('GET /api/v1/attachments/:id', () => {
  it('401s when logged out, even for a real attachment id', async () => {
    const issue = await issueFixture()
    asUser(plainCookie)
    const png = new File([PNG_BYTES], 'dl.png', { type: 'image/png' })
    const uploadRes = await uploadRoute(uploadReq(`http://x/api/v1/issues/${issue.id}/attachments`, png), ctx(issue.id))
    const { data } = await uploadRes.json()
    loggedOut()
    const res = await downloadRoute(getReq(`http://x/api/v1/attachments/${data.id}`), ctx(data.id))
    expect(res.status).toBe(401)
  })

  it('round-trips the bytes, content-type, and a UTF-8 filename in content-disposition', async () => {
    const issue = await issueFixture()
    asUser(plainCookie)
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    const png = new File([bytes], '한글 파일.png', { type: 'image/png' })
    const uploadRes = await uploadRoute(uploadReq(`http://x/api/v1/issues/${issue.id}/attachments`, png), ctx(issue.id))
    const { data } = await uploadRes.json()
    const res = await downloadRoute(getReq(`http://x/api/v1/attachments/${data.id}`), ctx(data.id))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    const disposition = res.headers.get('content-disposition')
    expect(disposition).toContain("attachment; filename*=UTF-8''")
    expect(disposition).toContain(encodeURIComponent('한글 파일.png'))
    const buf = Buffer.from(await res.arrayBuffer())
    expect(Array.from(buf)).toEqual(Array.from(bytes))
  })

  it('403s agent tokens so a general automation token cannot read every attachment', async () => {
    const issue = await issueFixture()
    asUser(plainCookie)
    const uploadRes = await uploadRoute(
      uploadReq(`http://x/api/v1/issues/${issue.id}/attachments`, new File([PNG_BYTES], 'private.png', { type: 'image/png' })),
      ctx(issue.id),
    )
    const { data } = await uploadRes.json()
    const res = await downloadRoute(getReq(`http://x/api/v1/attachments/${data.id}`, agentAuth()), ctx(data.id))
    expect(res.status).toBe(403)
  })

  it('404s for a missing attachment', async () => {
    asUser(plainCookie)
    const res = await downloadRoute(getReq('http://x/api/v1/attachments/999999'), ctx(999999))
    expect(res.status).toBe(404)
  })

  // Regression pin: current code is already correct (encodeURIComponent
  // neutralizes this), but nothing else in the suite exercises a hostile
  // filename through the real upload -> download round trip. Pins the
  // behavior so a future "support RFC 5987 properly" refactor can't
  // silently reopen header injection / path traversal via the filename.
  it('neutralizes a CRLF + path-traversal filename in content-disposition', async () => {
    const issue = await issueFixture()
    asUser(plainCookie)
    const evilName = '../../evil\r\nX-Injected: 1'
    const png = new File([PNG_BYTES], evilName, { type: 'image/png' })
    const uploadRes = await uploadRoute(uploadReq(`http://x/api/v1/issues/${issue.id}/attachments`, png), ctx(issue.id))
    const { data } = await uploadRes.json()
    // Stored verbatim — the DB is not the injection surface, the response header is.
    expect(data.filename).toBe(evilName)
    const res = await downloadRoute(getReq(`http://x/api/v1/attachments/${data.id}`), ctx(data.id))
    expect(res.status).toBe(200)
    const disposition = res.headers.get('content-disposition')!
    // No raw CR/LF — a header injection would need one to start a second
    // header line, and the fetch Headers implementation already rejects raw
    // control characters, so this also proves nothing crashed/got dropped.
    expect(disposition).not.toMatch(/[\r\n]/)
    // No literal, unencoded "../" — the whole filename is one opaque
    // percent-encoded token, not a path fragment.
    expect(disposition).not.toContain('../')
    expect(disposition).toBe(`attachment; filename*=UTF-8''${encodeURIComponent(evilName)}`)
    // Only one content-disposition header landed — a real injection would
    // have smuggled a second header, e.g. a stray X-Injected.
    expect(res.headers.get('x-injected')).toBeNull()
  })
})

describe('issue detail includes attachments', () => {
  it('GET /api/v1/issues/:id lists uploaded attachments ordered by createdAt', async () => {
    const issue = await issueFixture()
    asUser(plainCookie)
    const a = new File([PNG_BYTES], 'a.png', { type: 'image/png' })
    const b = new File([PNG_BYTES], 'b.png', { type: 'image/png' })
    await uploadRoute(uploadReq(`http://x/api/v1/issues/${issue.id}/attachments`, a), ctx(issue.id))
    await uploadRoute(uploadReq(`http://x/api/v1/issues/${issue.id}/attachments`, b), ctx(issue.id))
    const res = await getIssueRoute(getReq(`http://x/api/v1/issues/${issue.id}`), ctx(issue.id))
    const { data } = await res.json()
    expect(data.attachments.map((att: { filename: string }) => att.filename)).toEqual(['a.png', 'b.png'])
  })
})
