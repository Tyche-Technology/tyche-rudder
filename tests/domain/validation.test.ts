import { describe, it, expect } from 'vitest'
import { createIssueSchema, listIssuesSchema, commentSchema } from '@/lib/validation'

// Guards the z.config(z.locales.ko()) wiring at the top of validation.ts —
// a present config line proves nothing on its own, only an actual Korean
// message out of a real parse failure does.
describe('zod locale wiring', () => {
  it('produces a Korean message for a parse failure', () => {
    const result = commentSchema.safeParse({})
    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected failure')
    expect(result.error.issues[0].message).toMatch(/[가-힣]/)
  })
})

describe('createIssueSchema requesterEmail (agent-only field)', () => {
  const base = { title: 't', type: 'bug' as const, productId: 1 }
  it('accepts a well-formed email', () => {
    expect(createIssueSchema.safeParse({ ...base, requesterEmail: 'a@test.local' }).success).toBe(true)
  })
  it('is optional', () => {
    expect(createIssueSchema.safeParse(base).success).toBe(true)
  })
  it('rejects a non-email string instead of silently accepting it', () => {
    expect(createIssueSchema.safeParse({ ...base, requesterEmail: 'not-an-email' }).success).toBe(false)
  })
})

describe('listIssuesSchema id filters reject non-canonical numeric strings', () => {
  it('accepts a canonical positive decimal string', () => {
    const result = listIssuesSchema.safeParse({ productId: '42' })
    expect(result.success && result.data.productId).toBe(42)
  })
  it('rejects a hex-looking string instead of silently reading it as 16', () => {
    expect(listIssuesSchema.safeParse({ productId: '0x10' }).success).toBe(false)
  })
  it('rejects an exponent-looking string instead of silently reading it as 1000', () => {
    expect(listIssuesSchema.safeParse({ milestoneId: '1e3' }).success).toBe(false)
  })
  it('rejects a leading-zero string', () => {
    expect(listIssuesSchema.safeParse({ productId: '007' }).success).toBe(false)
  })
})
