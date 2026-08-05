import { describe, expect, it } from 'vitest'
import nextConfig, { securityHeaders } from '../../next.config'

describe('global response security headers', () => {
  it('disables framework disclosure and applies browser hardening to every route', () => {
    expect(nextConfig.poweredByHeader).toBe(false)
    const headers = Object.fromEntries(securityHeaders.map(({ key, value }) => [key.toLowerCase(), value]))
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['x-frame-options']).toBe('DENY')
    expect(headers['referrer-policy']).toBe('no-referrer')
    expect(headers['permissions-policy']).toContain('camera=()')
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'")
    expect(headers['content-security-policy']).toContain("object-src 'none'")
  })
})
