'use client'

// The roadmap hero — sun/moon, sea, and the `.tl` date-axis track. Purely a
// renderer of a `Timeline` someone else built: every date computation
// (position, state, dday) already happened in timeline.ts, so this file only
// ever formats strings for display.
import { Fragment, type CSSProperties } from 'react'
import { dateLabel } from './format'
import { daysUntil, isDone, todayMillis, type Timeline, type PortState } from './timeline'
import { Sun, Moon, Ship, Lighthouse, Buoy, DangerBuoy, FlagPort } from './sprites'
import type { ApiRoadmapEntry } from './types'

// Buoys float (hull dips below the waterline via .tl__port--afloat); land
// markers (done flag, dest lighthouse) sit on it (design doc §4).
const AFLOAT_STATES: PortState[] = ['next', 'future', 'overdue']

function PortMarker({ state }: { state: PortState }) {
  if (state === 'done') return <FlagPort />
  if (state === 'dest') return <Lighthouse />
  if (state === 'overdue') return <DangerBuoy />
  // next and future share the same buoy sprite — the lit topmark comes from
  // the wrapping .tl__port--next class, not a different component.
  return <Buoy />
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function Horizon({ entries, timeline, today }: {
  entries: ApiRoadmapEntry[]
  timeline: Timeline
  today: Date
}) {
  const rangeLabel = timeline.qlabels.length > 1
    ? `${timeline.qlabels[0].label} – ${timeline.qlabels[timeline.qlabels.length - 1].label}`
    : timeline.qlabels[0]?.label ?? ''

  // A port can bundle a completed milestone with an unfinished one sharing a
  // date (that's exactly why it isn't 'done' overall) — name the first
  // unfinished one, never just milestones[0], or the header can name a
  // milestone that already arrived.
  const nextPort = timeline.ports.find((p) => p.state === 'next')
  const nextMilestone = nextPort
    ? nextPort.milestones
        .map((m) => entries.find((e) => e.milestone.id === m.id))
        .find((e) => e !== undefined && !isDone(e))?.milestone
    : undefined
  const daysRemaining = nextMilestone?.endsOn ? daysUntil(nextMilestone.endsOn, today) : null

  // Reduced through the same function buildTimeline classifies against, so
  // this label and the ship/ports it sits beside can never disagree about
  // what day it is (todayMillis is UTC-anchored, hence the UTC getters here).
  const displayToday = new Date(todayMillis(today))
  const todayLabel = `${displayToday.getUTCFullYear()}-${pad2(displayToday.getUTCMonth() + 1)}-${pad2(displayToday.getUTCDate())}`

  return (
    <section className="horizon">
      <Sun />
      <Moon />
      <span className="horizon__sea" aria-hidden="true" />

      <div className="horizon__head">
        <div>
          <span className="eyebrow">{displayToday.getUTCFullYear()} 항로 · {rangeLabel}</span>
          <h2 className="h-view" style={{ marginTop: 'var(--s-1)' }}>
            {nextMilestone
              ? `다음 기한: ${nextMilestone.name} · ${daysRemaining}일 남음`
              : '계획된 다음 기한이 없습니다'}
          </h2>
        </div>
        <span className="mono muted push">기준 {todayLabel}</span>
      </div>

      <div className="tl-scroll">
        <div className="tl">
          {timeline.qlabels.map((q) => (
            // x, not label: "Q2" repeats every year, but x is a strictly
            // increasing position along the range — always unique.
            <span key={q.x} className="tl__qlabel" style={{ left: `${q.x}%` }}>{q.label}</span>
          ))}
          {timeline.ticks.map((x) => (
            <span key={x} className="tl__tick" style={{ left: `${x}%` }} aria-hidden="true" />
          ))}

          {timeline.ports.map((port) => (
            <PortGroup key={port.milestones[0].id} port={port} entries={entries} />
          ))}

          <span className="tl__ship" style={{ '--x': `${timeline.shipX}%` } as CSSProperties} aria-hidden="true">
            <Ship />
            <span className="tl__today">오늘</span>
          </span>
        </div>
      </div>
    </section>
  )
}

function PortGroup({ port, entries }: { port: Timeline['ports'][number]; entries: ApiRoadmapEntry[] }) {
  const style = { '--x': `${port.x}%` } as CSSProperties
  const capClass = `tl__cap tl__cap--${port.row}${port.endCap ? ' tl__cap--end' : ''}`
  const portClass = `tl__port tl__port--${port.state}${AFLOAT_STATES.includes(port.state) ? ' tl__port--afloat' : ''}`
  // dday alone is "D+6" (timeline.ts's contract is either D+n or MM-DD,
  // never both); the mockup's overdue caption also names the missed date,
  // so look the raw endsOn back up here rather than stretching that
  // contract. Every milestone in a port shares one date, so any of them
  // gives the same answer.
  const overdueDate = port.state === 'overdue'
    ? entries.find((e) => e.milestone.id === port.milestones[0].id)?.milestone.endsOn ?? null
    : null
  return (
    <>
      <span className={capClass} style={style}>
        {/* No wrapper element per milestone: .tl__cap is already a flex
            column, so stacking several name/pct pairs (one milestone
            sharing this port with another) falls out of that alone — no new
            CSS needed for the multi-milestone case. */}
        {port.milestones.map((m) => {
          // A done milestone sharing an overdue port's date already has its
          // date as dday (MM-DD, not D+n) — prefixing 기한 again would double
          // it up ("100% · 기한 07-25 · 07-25"). Only the actually-overdue
          // ones in this port need the reminder of which date they missed.
          const raw = entries.find((e) => e.milestone.id === m.id)
          const showOverdueDate = overdueDate != null && raw !== undefined && !isDone(raw)
          return (
            <Fragment key={m.id}>
              <span className="tl__name">{m.name}</span>
              <span className={`tl__pct${port.state === 'overdue' ? ' tl__pct--overdue' : ''}`}>
                {m.pct ?? '—'}% · {showOverdueDate ? `기한 ${dateLabel(overdueDate)} · ` : ''}{m.dday}
              </span>
            </Fragment>
          )
        })}
      </span>
      <span className={portClass} style={style} aria-hidden="true">
        <PortMarker state={port.state} />
      </span>
    </>
  )
}
