import { describe, it, expect } from 'vitest'
import { pageFromPathname } from '@/ui/nav'

describe('pageFromPathname', () => {
  it('maps each of the five nav routes to its key', () => {
    expect(pageFromPathname('/inbox')).toBe('inbox')
    expect(pageFromPathname('/board')).toBe('board')
    expect(pageFromPathname('/roadmap')).toBe('roadmap')
    expect(pageFromPathname('/requests')).toBe('requests')
    expect(pageFromPathname('/products')).toBe('products')
  })

  // T9: admin-only crew roster, same NAV_SEGMENTS mapping every other page
  // gets — not one of the original "five nav routes" above (that count is
  // fixed to the spec's core views), so it's its own case.
  it('maps /crew to crew', () => {
    expect(pageFromPathname('/crew')).toBe('crew')
  })

  // Regression for F2: this used to default to 'inbox', which would light
  // up the Inbox nav item (a false aria-current) once a route like Task 7's
  // /issues/[id] exists.
  it('maps an unrecognized top-level segment to null', () => {
    expect(pageFromPathname('/issues/42')).toBeNull()
  })

  it('maps the root path to null', () => {
    expect(pageFromPathname('/')).toBeNull()
  })

  it('maps an empty pathname to null', () => {
    expect(pageFromPathname('')).toBeNull()
  })

  it('ignores a trailing slash', () => {
    expect(pageFromPathname('/inbox/')).toBe('inbox')
  })

  it('only looks at the first segment of a nested route', () => {
    expect(pageFromPathname('/board/123')).toBe('board')
  })
})
