// @vitest-environment jsdom
// horizon.tsx had zero coverage — it only ever renders inside the roadmap
// page, which no vitest test touches (Playwright's roadmap coverage lives in
// tests/e2e). This drives it directly with a hand-built Timeline + matching
// entries, exercising the port-state markers, the header's next-milestone
// line, and the shared-overdue-port 기한 prefix rule from the component's own
// comment (a done milestone sharing an overdue port's date must not repeat
// the reminder its unfinished sibling gets).
//
// Pinned away from KST on purpose (see tests/ui/timeline.test.ts) — Horizon
// reduces `today` through the same todayMillis() the ports were built
// against, so this only proves anything if the host's local timezone can
// disagree with Seoul.
process.env.TZ = 'America/Los_Angeles'

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Horizon } from '@/ui/horizon'
import { todayMillis, daysUntil, type Timeline } from '@/ui/timeline'
import type { ApiRoadmapEntry } from '@/ui/types'

afterEach(cleanup)

const TODAY = new Date('2026-07-15T00:00:00.000Z')

function entry(id: number, name: string, endsOn: string, total: number, done: number, closed = false): ApiRoadmapEntry {
  return {
    milestone: {
      id, name, startsOn: null, endsOn, closed, version: 1,
      createdByUserId: null, updatedByUserId: null, createdAt: '', updatedAt: '',
    },
    total, done, issues: [],
  }
}

describe('Horizon — port states and header', () => {
  const entries = [
    entry(1, '완료 마일스톤', '2026-06-01', 2, 2), // done
    entry(2, '지연 마일스톤', '2026-07-01', 2, 0), // overdue
    entry(3, '다음 마일스톤', '2026-08-01', 2, 0), // next
    entry(4, '최종 마일스톤', '2026-09-01', 2, 0), // dest (last, future)
  ]
  const timeline: Timeline = {
    qlabels: [{ x: 2, label: 'Q2' }, { x: 50, label: 'Q3' }],
    ticks: [50],
    shipX: 45,
    undated: [],
    ports: [
      { x: 10, row: 'a', state: 'done', endCap: false, milestones: [{ id: 1, name: '완료 마일스톤', pct: 100, dday: '06-01' }] },
      { x: 30, row: 'b', state: 'overdue', endCap: false, milestones: [{ id: 2, name: '지연 마일스톤', pct: 0, dday: 'D+14' }] },
      { x: 50, row: 'a', state: 'next', endCap: false, milestones: [{ id: 3, name: '다음 마일스톤', pct: 0, dday: 'D+17' }] },
      { x: 95, row: 'b', state: 'dest', endCap: true, milestones: [{ id: 4, name: '최종 마일스톤', pct: 0, dday: 'D+48' }] },
    ],
  }

  it('names the next (not-yet-done) milestone and its day count in the header', () => {
    render(<Horizon entries={entries} timeline={timeline} today={TODAY} />)
    const expectedDays = daysUntil('2026-08-01', TODAY)
    expect(screen.getByText(`다음 기한: 다음 마일스톤 · ${expectedDays}일 남음`)).toBeTruthy()
  })

  it('renders the multi-quarter range label and the 기준 today label from todayMillis', () => {
    render(<Horizon entries={entries} timeline={timeline} today={TODAY} />)
    expect(screen.getByText(/Q2 – Q3/)).toBeTruthy()
    const d = new Date(todayMillis(TODAY))
    const label = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
    expect(screen.getByText(`기준 ${label}`)).toBeTruthy()
  })

  it('marks the ports afloat except the done and dest ones, and end-caps the last port past 90%', () => {
    const { container } = render(<Horizon entries={entries} timeline={timeline} today={TODAY} />)
    const portEls = container.querySelectorAll('.tl__port')
    expect(portEls[0].className).toContain('tl__port--done')
    expect(portEls[0].className).not.toContain('tl__port--afloat')
    expect(portEls[1].className).toContain('tl__port--overdue')
    expect(portEls[1].className).toContain('tl__port--afloat')
    expect(portEls[3].className).toContain('tl__port--dest')
    expect(portEls[3].className).not.toContain('tl__port--afloat')

    const capEls = container.querySelectorAll('.tl__cap')
    expect(capEls[3].className).toContain('tl__cap--end')
    expect(capEls[0].className).not.toContain('tl__cap--end')
  })

  it('renders a distinct marker svg per port state (lighthouse for dest, danger buoy for overdue, flag for done)', () => {
    const { container } = render(<Horizon entries={entries} timeline={timeline} today={TODAY} />)
    const markers = container.querySelectorAll('.tl__port svg')
    expect(markers[0].getAttribute('viewBox')).toBe('0 0 13 10') // FlagPort (done)
    expect(markers[1].getAttribute('viewBox')).toBe('0 0 11 11') // DangerBuoy (overdue)
    expect(markers[2].getAttribute('viewBox')).toBe('0 0 11 9') // Buoy (next)
    expect(markers[3].getAttribute('viewBox')).toBe('0 0 15 16') // Lighthouse (dest)
  })

  it('prefixes the overdue milestone caption with its missed 기한 date', () => {
    render(<Horizon entries={entries} timeline={timeline} today={TODAY} />)
    expect(screen.getByText(/기한 07-01 · D\+14/)).toBeTruthy()
  })
})

describe('Horizon — no upcoming deadline', () => {
  it('renders 계획된 다음 기한이 없습니다 when no port is in the next state', () => {
    const entries = [entry(1, '완료 마일스톤', '2026-06-01', 1, 1)]
    const timeline: Timeline = {
      qlabels: [{ x: 50, label: 'Q2' }],
      ticks: [],
      shipX: 50,
      undated: [],
      ports: [{ x: 50, row: 'a', state: 'done', endCap: true, milestones: [{ id: 1, name: '완료 마일스톤', pct: 100, dday: '06-01' }] }],
    }
    render(<Horizon entries={entries} timeline={timeline} today={TODAY} />)
    expect(screen.getByText('계획된 다음 기한이 없습니다')).toBeTruthy()
    // Single qlabel: the range label is just that one label, no en dash.
    expect(screen.getByText(/항로 · Q2$/)).toBeTruthy()
  })
})

describe('Horizon — edge-case data shapes', () => {
  afterEach(cleanup)

  it('renders — for a milestone with no linked issues (pct is null)', () => {
    const entries = [entry(1, '이슈 없는 마일스톤', '2026-08-01', 0, 0)]
    const timeline: Timeline = {
      qlabels: [{ x: 50, label: 'Q3' }],
      ticks: [],
      shipX: 40,
      undated: [],
      ports: [{ x: 50, row: 'a', state: 'next', endCap: false, milestones: [{ id: 1, name: '이슈 없는 마일스톤', pct: null, dday: 'D+17' }] }],
    }
    render(<Horizon entries={entries} timeline={timeline} today={TODAY} />)
    expect(screen.getByText(/^—% ·/)).toBeTruthy()
  })

  it('falls back to no missed-date prefix when the overdue port references a milestone id absent from entries', () => {
    // Same-tick refetch race: timeline was built from a slightly different
    // entries snapshot than the one Horizon is given. Must not throw, and
    // must not print an undefined date.
    const timeline: Timeline = {
      qlabels: [{ x: 50, label: 'Q3' }],
      ticks: [],
      shipX: 40,
      undated: [],
      ports: [{ x: 50, row: 'a', state: 'overdue', endCap: false, milestones: [{ id: 999, name: '유령 마일스톤', pct: 0, dday: 'D+5' }] }],
    }
    const { container } = render(<Horizon entries={[]} timeline={timeline} today={TODAY} />)
    const caption = container.querySelector('.tl__pct')!
    expect(caption.textContent).not.toMatch(/기한/)
    expect(caption.textContent).toContain('D+5')
  })
})

describe('Horizon — shared overdue port', () => {
  it('does not repeat the 기한 prefix for a done milestone sharing an overdue port\'s date', () => {
    const entries = [
      entry(1, '완료된 짝', '2026-07-01', 2, 2), // done, shares the port's date
      entry(2, '미완료 짝', '2026-07-01', 2, 0), // not done — this one gets the prefix
    ]
    const timeline: Timeline = {
      qlabels: [{ x: 50, label: 'Q2' }],
      ticks: [],
      shipX: 60,
      undated: [],
      ports: [{
        x: 50, row: 'a', state: 'overdue', endCap: false,
        milestones: [
          { id: 1, name: '완료된 짝', pct: 100, dday: '07-01' },
          { id: 2, name: '미완료 짝', pct: 0, dday: 'D+14' },
        ],
      }],
    }
    const { container } = render(<Horizon entries={entries} timeline={timeline} today={TODAY} />)
    const captions = Array.from(container.querySelectorAll('.tl__pct')).map((el) => el.textContent)
    expect(captions[0]).not.toMatch(/기한/) // done sibling: no repeated reminder
    expect(captions[1]).toMatch(/기한 07-01 · D\+14/) // unfinished one: gets it
  })
})
