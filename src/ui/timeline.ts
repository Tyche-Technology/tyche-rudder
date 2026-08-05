// Roadmap horizon date math — every calendar computation the timeline needs
// lives here, pure and unit-tested, so horizon.tsx and the roadmap page never
// parse or compare a date on their own (design doc §4).
import { kstDayMillis, dateLabel } from './format'
import type { ApiRoadmapEntry } from './types'

export type PortState = 'done' | 'next' | 'future' | 'overdue' | 'dest'

export type TimelinePort = {
  x: number
  row: 'a' | 'b'
  state: PortState
  endCap: boolean
  milestones: Array<{ id: number; name: string; pct: number | null; dday: string }>
}

export type Timeline = {
  qlabels: Array<{ x: number; label: string }>
  ticks: number[]
  ports: TimelinePort[]
  shipX: number
  undated: number[]
}

const MS_PER_DAY = 86_400_000

// The wire sends milestone dates as a bare "YYYY-MM-DD" calendar day, with no
// time or timezone component at all. Rebuilding with Date.UTC keeps every
// value a plain calendar day, immune to the host's local timezone: local
// getters on a `new Date('YYYY-MM-DD')` (which parses as UTC midnight) can
// read back the previous day west of UTC, which is exactly the pitfall this
// avoids.
function dayMillis(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

// "Today" has no calendar day until you pick a timezone to read it in —
// unlike a wire date (always UTC-anchored, see dayMillis above), which
// already names a fixed calendar day. Rudder reads every date in KST
// (format.ts), so this delegates rather than picking a second answer, and
// stays exported because horizon.tsx's 기준 label must reduce "today"
// through this exact function — a parallel computation is what drifted
// before, showing a KST viewer one date in the header while the ship
// position and D-day counts used another.
export function todayMillis(today: Date): number {
  return kstDayMillis(today)
}

function quarterStartMillis(millis: number): number {
  const d = new Date(millis)
  return Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1)
}

// One day before the *next* quarter's start — Date.UTC normalizes a
// month index past 11 into the following year, so this holds across a
// year boundary too.
function quarterEndMillis(millis: number): number {
  const start = new Date(quarterStartMillis(millis))
  return Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 3, 1) - MS_PER_DAY
}

function nextQuarterStartMillis(millis: number): number {
  return quarterEndMillis(millis) + MS_PER_DAY
}

function quarterLabel(millis: number): string {
  return `Q${Math.floor(new Date(millis).getUTCMonth() / 3) + 1}`
}

function mapX(millis: number, rangeStart: number, rangeEnd: number): number {
  const t = (millis - rangeStart) / (rangeEnd - rangeStart)
  return Math.round((2 + t * 96) * 10) / 10
}

export function isDone(e: ApiRoadmapEntry): boolean {
  return e.milestone.closed || (e.total > 0 && e.done === e.total)
}

export function buildTimeline(entries: ApiRoadmapEntry[], today: Date): Timeline {
  const todayMs = todayMillis(today)

  const undated: number[] = []
  const grouped = new Map<string, ApiRoadmapEntry[]>()
  for (const e of entries) {
    if (e.milestone.endsOn === null) {
      undated.push(e.milestone.id)
      continue
    }
    const key = e.milestone.endsOn.slice(0, 10)
    grouped.set(key, [...(grouped.get(key) ?? []), e])
  }

  const dateKeys = [...grouped.keys()].sort()
  const rangeStart = quarterStartMillis(Math.min(todayMs, ...dateKeys.map(dayMillis)))
  const rangeEnd = quarterEndMillis(Math.max(todayMs, ...dateKeys.map(dayMillis)))

  const qlabels: Array<{ x: number; label: string }> = []
  const ticks: number[] = []
  let cursor = rangeStart
  let isFirstQuarter = true
  while (cursor <= rangeEnd) {
    const x = mapX(cursor, rangeStart, rangeEnd)
    qlabels.push({ x, label: quarterLabel(cursor) })
    if (!isFirstQuarter) ticks.push(x)
    isFirstQuarter = false
    cursor = nextQuarterStartMillis(cursor)
  }

  const drafts = dateKeys.map((key) => {
    const list = grouped.get(key)!
    const millis = dayMillis(key)
    const state: 'done' | 'overdue' | 'future' = list.every(isDone)
      ? 'done'
      : millis < todayMs ? 'overdue' : 'future'
    const milestones = list.map((e) => {
      const overdueThis = !isDone(e) && millis < todayMs
      return {
        id: e.milestone.id,
        name: e.milestone.name,
        pct: e.total === 0 ? null : Math.round((e.done / e.total) * 100),
        dday: overdueThis ? `D+${(todayMs - millis) / MS_PER_DAY}` : dateLabel(key),
      }
    })
    return { millis, state, milestones }
  })

  // The latest-dated port becomes the one lighthouse if it isn't already
  // done/overdue; the earliest remaining future port lights up as the next
  // buoy. Excluding the dest slot before searching for next is what makes
  // them coincide correctly (dest wins, no next) when there is only one
  // future port total.
  const destIndex = drafts.length > 0 && drafts[drafts.length - 1].state === 'future'
    ? drafts.length - 1
    : -1
  const nextIndex = drafts.findIndex((d, i) => i !== destIndex && d.state === 'future')

  const ports: TimelinePort[] = drafts.map((draft, i) => {
    const x = mapX(draft.millis, rangeStart, rangeEnd)
    return {
      x,
      row: i % 2 === 0 ? 'a' : 'b',
      state: i === destIndex ? 'dest' : i === nextIndex ? 'next' : draft.state,
      endCap: i === drafts.length - 1 && x > 90,
      milestones: draft.milestones,
    }
  })

  return { qlabels, ticks, ports, shipX: mapX(todayMs, rangeStart, rangeEnd), undated }
}

// Whole calendar days from today to a wire date — positive for a future date,
// negative for a past one. Shared by the Horizon header's "N일 남음" line and
// the roadmap page's overdue/in-window checks, so no caller re-parses a date
// on its own.
export function daysUntil(iso: string, today: Date): number {
  return Math.round((dayMillis(iso) - todayMillis(today)) / MS_PER_DAY)
}
