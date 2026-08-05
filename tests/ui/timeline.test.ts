// Pinned AWAY from KST on purpose — see tests/ui/format.test.ts for the full
// reasoning. Short version: todayMillis names Asia/Seoul via format.ts, so
// these hold on any host; but local getters are indistinguishable from KST on
// a KST machine, and Seoul is the only place this suite runs. Pinning to Los
// Angeles is what makes a revert to local getters fail here. Verified by
// probe that this assignment does not leak into other test files.
process.env.TZ = 'America/Los_Angeles'

import { describe, it, expect } from 'vitest'
import { buildTimeline, daysUntil, todayMillis } from '@/ui/timeline'
import type { ApiRoadmapEntry } from '@/ui/types'

const TODAY = new Date('2026-07-31')

function entry(overrides: {
  id: number
  name?: string
  endsOn?: string | null
  startsOn?: string | null
  closed?: boolean
  total?: number
  done?: number
}): ApiRoadmapEntry {
  const { id, name = `m${id}`, endsOn = null, startsOn = null, closed = false, total = 0, done = 0 } = overrides
  return {
    milestone: {
      id, name, startsOn, endsOn, closed, version: 1,
      createdByUserId: null, updatedByUserId: null, createdAt: '', updatedAt: '',
    },
    total,
    done,
    issues: [],
  }
}

describe('buildTimeline', () => {
  it('rounds the visible range to quarter boundaries and scales ticks/labels inside it', () => {
    const t = buildTimeline([
      entry({ id: 1, endsOn: '2026-06-30T00:00:00.000Z', total: 1, done: 1 }),
      entry({ id: 2, endsOn: '2026-12-31T00:00:00.000Z', total: 1, done: 0 }),
    ], TODAY)
    expect(t.qlabels).toEqual([
      { x: 2, label: 'Q2' },
      { x: 33.9, label: 'Q3' },
      { x: 66.1, label: 'Q4' },
    ])
    expect(t.ticks).toEqual([33.9, 66.1])
  })

  it('positions ports and the ship linearly by date within the range', () => {
    const t = buildTimeline([
      entry({ id: 1, endsOn: '2026-06-30T00:00:00.000Z', total: 1, done: 1 }),
      entry({ id: 2, endsOn: '2026-12-31T00:00:00.000Z', total: 1, done: 0 }),
    ], TODAY)
    expect(t.ports[0].x).toBe(33.5)
    expect(t.ports[1].x).toBe(98)
    expect(t.shipX).toBe(44.4)
  })

  it('excludes undated milestones from the axis and lists their ids in undated', () => {
    const t = buildTimeline([
      entry({ id: 1, endsOn: '2026-08-15T00:00:00.000Z', total: 1, done: 0 }),
      entry({ id: 2, endsOn: null }),
    ], TODAY)
    expect(t.ports).toHaveLength(1)
    expect(t.undated).toEqual([2])
  })

  it('merges milestones sharing an end date into one port with stacked entries', () => {
    const t = buildTimeline([
      entry({ id: 1, name: 'A', endsOn: '2026-08-15T00:00:00.000Z', total: 2, done: 1 }),
      entry({ id: 2, name: 'B', endsOn: '2026-08-15T00:00:00.000Z', total: 4, done: 4 }),
    ], TODAY)
    expect(t.ports).toHaveLength(1)
    expect(t.ports[0].milestones.map((m) => m.id)).toEqual([1, 2])
  })

  it('marks a port done when every milestone is closed or fully complete', () => {
    const t = buildTimeline([
      entry({ id: 1, endsOn: '2026-08-01T00:00:00.000Z', total: 3, done: 3 }),
    ], TODAY)
    expect(t.ports[0].state).toBe('done')
  })

  it('treats closed:true as done regardless of completion counts', () => {
    const t = buildTimeline([
      entry({ id: 1, endsOn: '2026-08-01T00:00:00.000Z', total: 5, done: 2, closed: true }),
    ], TODAY)
    expect(t.ports[0].state).toBe('done')
  })

  it('marks a not-done port overdue when its date is before today, with a D+n dday', () => {
    const t = buildTimeline([
      entry({ id: 1, endsOn: '2026-07-25T00:00:00.000Z', total: 6, done: 5 }),
    ], TODAY)
    expect(t.ports[0].state).toBe('overdue')
    expect(t.ports[0].milestones[0].dday).toBe('D+6')
  })

  it('formats dday as MM-DD for a done or future milestone', () => {
    const t = buildTimeline([
      entry({ id: 1, endsOn: '2026-08-31T00:00:00.000Z', total: 1, done: 0 }),
    ], TODAY)
    expect(t.ports[0].milestones[0].dday).toBe('08-31')
  })

  it('reports pct null when a milestone has no assigned issues', () => {
    const t = buildTimeline([
      entry({ id: 1, endsOn: '2026-08-15T00:00:00.000Z', total: 0, done: 0 }),
    ], TODAY)
    expect(t.ports[0].milestones[0].pct).toBeNull()
  })

  it('promotes the latest not-done port to dest and the earliest remaining future port to next', () => {
    const t = buildTimeline([
      entry({ id: 1, endsOn: '2026-08-15T00:00:00.000Z', total: 2, done: 0 }),
      entry({ id: 2, endsOn: '2026-09-15T00:00:00.000Z', total: 2, done: 0 }),
      entry({ id: 3, endsOn: '2026-12-31T00:00:00.000Z', total: 2, done: 0 }),
    ], TODAY)
    expect(t.ports.map((p) => p.state)).toEqual(['next', 'future', 'dest'])
  })

  it('makes dest win with no next when only one future port exists', () => {
    const t = buildTimeline([
      entry({ id: 1, endsOn: '2026-06-30T00:00:00.000Z', total: 1, done: 1 }),
      entry({ id: 2, endsOn: '2026-08-15T00:00:00.000Z', total: 2, done: 0 }),
    ], TODAY)
    expect(t.ports.map((p) => p.state)).toEqual(['done', 'dest'])
  })

  it('produces no dest and no next when every port is done', () => {
    const t = buildTimeline([
      entry({ id: 1, endsOn: '2026-06-30T00:00:00.000Z', total: 1, done: 1 }),
      entry({ id: 2, endsOn: '2026-07-10T00:00:00.000Z', total: 2, done: 2 }),
    ], TODAY)
    expect(t.ports.every((p) => p.state === 'done')).toBe(true)
  })

  it('alternates rows a/b/a in date order and end-caps only the last port past x=90', () => {
    const t = buildTimeline([
      entry({ id: 1, endsOn: '2026-06-30T00:00:00.000Z', total: 1, done: 1 }),
      entry({ id: 2, endsOn: '2026-07-25T00:00:00.000Z', total: 1, done: 0 }),
      entry({ id: 3, endsOn: '2026-12-31T00:00:00.000Z', total: 1, done: 0 }),
    ], TODAY)
    expect(t.ports.map((p) => p.row)).toEqual(['a', 'b', 'a'])
    expect(t.ports.map((p) => p.endCap)).toEqual([false, false, true])
  })
})

describe('todayMillis (KST day skew)', () => {
  // An instant given as a date-only string (e.g. '2026-07-31') parses as UTC
  // midnight and structurally cannot distinguish a KST reduction from a UTC
  // one; only a full ISO instant that has crossed midnight in one timezone
  // but not the other can.
  const kstJustAfterMidnight = new Date('2026-07-31T00:30:00+09:00') // = 2026-07-30T15:30:00Z

  it('reduces a KST-morning instant to its KST calendar day, not the earlier UTC day underneath it', () => {
    expect(todayMillis(kstJustAfterMidnight)).toBe(Date.UTC(2026, 6, 31))
  })

  it('keeps buildTimeline classification consistent with that same reduction', () => {
    const t = buildTimeline([
      entry({ id: 1, endsOn: '2026-07-31T00:00:00.000Z', total: 1, done: 0 }),
    ], kstJustAfterMidnight)
    // A UTC-getter reduction would place "today" on 07-30, one day before
    // this milestone's deadline — misclassifying it overdue.
    expect(t.ports[0].state).not.toBe('overdue')
  })
})

describe('daysUntil', () => {
  it('is positive for a future date and negative for a past one', () => {
    expect(daysUntil('2026-08-31T00:00:00.000Z', TODAY)).toBe(31)
    expect(daysUntil('2026-07-25T00:00:00.000Z', TODAY)).toBe(-6)
    expect(daysUntil('2026-07-31T00:00:00.000Z', TODAY)).toBe(0)
  })
})
