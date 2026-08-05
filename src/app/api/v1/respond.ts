import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import type { ZodError } from 'zod'
import type { Db } from '@/db/client'
import { products, users, milestones, issues } from '@/db/schema'
import type { Actor } from '@/domain/actor'
import type { DomainError, ErrorKind } from '@/domain/result'

export const ok = (data: unknown, status = 200) => NextResponse.json({ ok: true, data }, { status })
export const fail = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status })
export const unauthorized = () => fail('로그인이 필요합니다', 401)
export const forbidden = () => fail('권한이 없습니다', 403)

// A client's declared payload size is a hint, not a limit — a client can
// omit content-length entirely (chunked transfer encoding does) or lie
// about it, so the only way to actually bound memory is to watch bytes as
// they arrive and cut the stream off, not read-fully-then-check-length
// (that still buffers an unbounded body before the check ever runs). Once
// bytes read exceed maxBytes the transform errors, which cancels the
// upstream reader too — the source is never asked for more than ~maxBytes
// regardless of what (if anything) the client declared up front. Shared by
// readJson and readCappedFormData below.
function capBody(body: ReadableStream<Uint8Array>, maxBytes: number) {
  let total = 0
  let overLimit = false
  const stream = body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      total += chunk.byteLength
      if (total > maxBytes) {
        overLimit = true
        controller.error(new Error('BODY_TOO_LARGE'))
        return
      }
      controller.enqueue(chunk)
    },
  }))
  return { stream, overLimit: () => overLimit }
}

// 1MB — an order of magnitude above the largest legal JSON payload, so no
// real client request ever brushes it.
const JSON_BODY_LIMIT = 1_048_576
export const BODY_TOO_LARGE = Symbol('BODY_TOO_LARGE')

export async function readJson(req: Request): Promise<unknown | typeof BODY_TOO_LARGE | null> {
  // Cheap early rejection when the client is honest (or lying low) about
  // content-length — not a cap on its own, capBody below is the cap.
  if (Number(req.headers.get('content-length') ?? '0') > JSON_BODY_LIMIT) return BODY_TOO_LARGE
  const body = req.body
  if (!body) return null
  const { stream, overLimit } = capBody(body, JSON_BODY_LIMIT)
  let text: string
  try {
    text = await new Response(stream).text()
  } catch {
    return overLimit() ? BODY_TOO_LARGE : null
  }
  try { return JSON.parse(text) } catch { return null }
}

// For a multipart body, formData() has no size option and will buffer
// however many bytes the stream hands it — capBody bounds that the same way.
export async function readCappedFormData(req: Request, maxBytes: number): Promise<FormData | typeof BODY_TOO_LARGE | null> {
  const body = req.body
  if (!body) return null
  const { stream, overLimit } = capBody(body, maxBytes)
  // duplex: 'half' is required by the fetch spec for any Request built with
  // a streaming body — Node's Request constructor enforces this too, even
  // though this Request is only ever read locally, never sent over the wire.
  const init = { method: req.method, headers: req.headers, body: stream, duplex: 'half' as const }
  try {
    return await new Request(req.url, init).formData()
  } catch {
    return overLimit() ? BODY_TOO_LARGE : null
  }
}

// The `issues` array is additive to the envelope — a client reading only
// `error` keeps working. Each entry names the field so a machine client
// (e.g. an agent composing a payload) can repair and retry instead of
// guessing which of several fields was wrong.
export function failParse(error: ZodError): NextResponse {
  const issues = error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
  return NextResponse.json({ ok: false, error: '입력값이 올바르지 않습니다', issues }, { status: 400 })
}

// postgres-js surfaces the Postgres SQLSTATE on `.code` (verified against a
// real postgres:15 container, not PGlite). Only
// 23505 (unique_violation) is unique-constraint; anything else is a
// different failure and callers must rethrow it, not swallow it here.
export function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505'
}

// The ONE admin guard — call after actorFromRequest resolves a non-null
// actor. Every route that needs admin-only access imports this instead of
// inlining the check.
export function requireAdmin(actor: Actor): NextResponse | null {
  return actor.type !== 'user' || actor.role !== 'admin' ? forbidden() : null
}

// Postgres's `integer` column range. A value outside this crashes the query
// (error 22P02) instead of failing validation, surfacing as a 500.
const PG_INT_MAX = 2_147_483_647

// Canonical decimal digits only — `Number()` also accepts hex ("0x10"),
// exponent ("1e3"), and leading +/-, which is more than "a positive integer
// id" should mean for a path segment or query param. Bounded to PG_INT_MAX
// so an oversized id (e.g. a 24-digit string) can't reach the database.
function parsePgId(raw: string | null): number | null {
  if (raw == null || !/^[1-9]\d*$/.test(raw)) return null
  const n = Number(raw)
  return n <= PG_INT_MAX ? n : null
}

export async function idFromParams(params: Promise<{ id: string }>): Promise<number | null> {
  const { id } = await params
  return parsePgId(id)
}

export function idFromQuery(url: string, key: string): number | null {
  return parsePgId(new URL(url).searchParams.get(key))
}

// Existence checks, not FK-violation translation: a pre-check has a benign
// race (the row could vanish between check and insert) ONLY if something can
// delete it, and Phase 1 has no endpoint that deletes a product, user, or
// milestone. If one is ever added, these checks inherit that race and need
// revisiting (or the insert's FK violation needs translating instead).
export async function productExists(db: Db, id: number): Promise<boolean> {
  const [row] = await db.select({ id: products.id }).from(products).where(eq(products.id, id))
  return row != null
}
export async function userExists(db: Db, id: number): Promise<boolean> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, id))
  return row != null
}
export async function milestoneExists(db: Db, id: number): Promise<boolean> {
  const [row] = await db.select({ id: milestones.id }).from(milestones).where(eq(milestones.id, id))
  return row != null
}
export async function issueExists(db: Db, id: number): Promise<boolean> {
  const [row] = await db.select({ id: issues.id }).from(issues).where(eq(issues.id, id))
  return row != null
}

// The HTTP status per domain error kind — routed by the kind the domain
// function chose (see domain/result.ts), never by matching error prose.
export const KIND_STATUS: Record<ErrorKind, number> = { not_found: 404, conflict: 409, rule: 422 }
export const failDomain = (e: DomainError) => fail(e.error, KIND_STATUS[e.kind])
