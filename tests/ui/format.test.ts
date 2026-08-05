// Pinned to a zone that is NOT KST, and that is the entire point.
//
// format.ts names Asia/Seoul explicitly, so these expected values hold on any
// host — but "holds anywhere" is not the property worth testing. The property
// worth testing is "a regression is caught here". Local getters ARE KST on a
// KST machine, so under the team's own Seoul laptops (the only place this
// suite runs — no CI in this repo) every assertion below passes against the
// broken implementation too. Pinning to Los Angeles makes local getters read
// a different calendar day, so reverting format.ts to them fails this file
// instead of quietly passing it.
//
// Safe per-file: verified by probe — a test file running alongside this one
// sees TZ unset, so the assignment does not leak across vitest's workers.
process.env.TZ = 'America/Los_Angeles'

import { describe, it, expect } from 'vitest'
import { dateLabel, formatBytes, formatDateTime, kstDayMillis, shortDate } from '@/ui/format'

describe('shortDate', () => {
  it('renders the KST calendar day, not the UTC one', () => {
    // 09:37Z is 18:37 KST the same day — month/day agree here.
    expect(shortDate('2026-07-31T09:37:00.000Z')).toBe('07-31')
  })

  it('rolls to the next day for an instant already past KST midnight', () => {
    // 22:10Z on 07-30 is 07:10 KST on 07-31. Rendering the wire's own digits
    // (the bug this replaced) showed 07-30.
    expect(shortDate('2026-07-30T22:10:00.000Z')).toBe('07-31')
  })

  it('pads single-digit months and days', () => {
    expect(shortDate('2026-01-05T03:00:00.000Z')).toBe('01-05')
  })
})

describe('formatDateTime', () => {
  it('renders the KST date and clock time', () => {
    expect(formatDateTime('2026-07-31T09:37:00.000Z')).toBe('07-31 18:37')
  })

  it('crosses the day boundary in the clock as well as the date', () => {
    expect(formatDateTime('2026-07-30T22:10:00.000Z')).toBe('07-31 07:10')
  })

  it('renders KST midnight as 00:00, not 24:00', () => {
    expect(formatDateTime('2026-07-30T15:00:00.000Z')).toBe('07-31 00:00')
  })

  it('pads hours and minutes', () => {
    expect(formatDateTime('2026-02-09T00:05:00.000Z')).toBe('02-09 09:05')
  })
})

describe('kstDayMillis', () => {
  it('reduces an instant to its KST calendar day, as UTC-midnight millis', () => {
    // Same shape timeline.ts's dayMillis() gives a wire date, so the two
    // compare directly.
    expect(kstDayMillis(new Date('2026-07-31T09:37:00.000Z'))).toBe(Date.UTC(2026, 6, 31))
  })

  it('counts an instant just past KST midnight as the new day', () => {
    // 15:30Z on 07-30 = 00:30 KST on 07-31. Under local getters on a UTC
    // host this reduced to 07-30, moving the roadmap ship a day backwards.
    expect(kstDayMillis(new Date('2026-07-30T15:30:00.000Z'))).toBe(Date.UTC(2026, 6, 31))
  })

  it('counts an instant just before KST midnight as the old day', () => {
    expect(kstDayMillis(new Date('2026-07-30T14:30:00.000Z'))).toBe(Date.UTC(2026, 6, 30))
  })
})

describe('dateLabel', () => {
  it('trims a wire date to MM-DD without timezone math', () => {
    expect(dateLabel('2026-07-25')).toBe('07-25')
  })
})

describe('formatBytes', () => {
  it('renders sub-KB sizes in bytes', () => {
    expect(formatBytes(512)).toBe('512B')
  })

  it('renders KB with one decimal', () => {
    expect(formatBytes(1536)).toBe('1.5KB')
  })

  it('renders MB with one decimal', () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0MB')
  })
})
