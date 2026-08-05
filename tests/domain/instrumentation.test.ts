import { describe, it, expect, afterEach } from 'vitest'
import { register } from '@/instrumentation'
import { PLACEHOLDER_SECRET } from '@/lib/auth-secret'

const ORIGINAL = process.env.BETTER_AUTH_SECRET

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.BETTER_AUTH_SECRET
  else process.env.BETTER_AUTH_SECRET = ORIGINAL
})

describe('register (boot-time BETTER_AUTH_SECRET validation)', () => {
  it('throws when BETTER_AUTH_SECRET is unset', async () => {
    delete process.env.BETTER_AUTH_SECRET
    await expect(register()).rejects.toThrow(/BETTER_AUTH_SECRET/)
  })

  it('throws when BETTER_AUTH_SECRET is the shipped placeholder', async () => {
    process.env.BETTER_AUTH_SECRET = PLACEHOLDER_SECRET
    await expect(register()).rejects.toThrow(/BETTER_AUTH_SECRET/)
  })

  it('throws when BETTER_AUTH_SECRET is under 32 chars', async () => {
    process.env.BETTER_AUTH_SECRET = 'x'.repeat(31)
    await expect(register()).rejects.toThrow(/BETTER_AUTH_SECRET/)
  })

  it('passes at exactly 32 chars', async () => {
    process.env.BETTER_AUTH_SECRET = 'x'.repeat(32)
    await expect(register()).resolves.toBeUndefined()
  })

  it('passes for a longer, real-looking secret', async () => {
    process.env.BETTER_AUTH_SECRET = 'a'.repeat(48)
    await expect(register()).resolves.toBeUndefined()
  })
})
