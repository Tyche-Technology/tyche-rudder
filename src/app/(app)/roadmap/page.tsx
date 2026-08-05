'use client'

import { useRef, type CSSProperties } from 'react'
import { useApi } from '@/ui/api'
import { useMe, useTopbarActions } from '@/ui/shell'
import { useUsers } from '@/ui/catalog-data'
import { Horizon } from '@/ui/horizon'
import { MilestoneDialog, type MilestoneDialogHandle } from '@/ui/milestone-dialog'
import { buildTimeline, daysUntil, isDone, type PortState } from '@/ui/timeline'
import { StatusChip, PriorityTag } from '@/ui/chips'
import { shortDate, dateLabel } from '@/ui/format'
import { EmptyState } from '@/ui/bits'
import type { ApiRoadmapEntry, ApiMilestone, ApiUser } from '@/ui/types'

// Calendar-quarter month ranges, MM-DD — constant regardless of leap years
// (Feb's extra day only ever shifts membership within Q1, never its end).
const Q_RANGE: Record<number, [string, string]> = {
  1: ['01-01', '03-31'], 2: ['04-01', '06-30'], 3: ['07-01', '09-30'], 4: ['10-01', '12-31'],
}

function quarterKey(endsOn: string): string {
  const q = Math.floor((Number(endsOn.slice(5, 7)) - 1) / 3) + 1
  return `${endsOn.slice(0, 4)}-Q${q}`
}

// Both attribution columns are nullable independently of catalog loading:
// null means "created before Task 3 existed," not "still loading" — the
// catalog-loading case (users === null) renders blank instead, same as
// catalog-data's nameOf, but this can't reuse nameOf because a null id here
// means "no attribution recorded," never "미배정."
function attributionName(milestone: ApiMilestone, users: ApiUser[] | null): string | null {
  const actorId = milestone.updatedByUserId ?? milestone.createdByUserId
  if (actorId === null) return '—'
  if (users === null) return null
  return users.find((u) => u.id === actorId)?.name ?? '—'
}

type ChipInfo = { label: string; cls: string; flag: string | null; en: string | null }

function milestoneChip(entry: ApiRoadmapEntry, today: Date): ChipInfo {
  if (isDone(entry)) return { label: '완료', cls: 'chip--done', flag: 'flag--done', en: 'Done' }
  if (entry.milestone.endsOn !== null && daysUntil(entry.milestone.endsOn, today) < 0) {
    return { label: `지연 D+${-daysUntil(entry.milestone.endsOn, today)}`, cls: 'chip--rejected', flag: null, en: null }
  }
  if (entry.done > 0) return { label: '항해 중', cls: 'chip--progress', flag: 'flag--progress', en: 'In Progress' }
  return { label: '계획', cls: 'chip--inbox', flag: 'flag--inbox', en: 'Planned' }
}

export default function RoadmapPage() {
  const me = useMe()
  const isAdmin = me.role === 'admin'
  const { data: entries, error, loading, refetch } = useApi<ApiRoadmapEntry[]>('/api/v1/roadmap')
  const { users, error: usersError, refetch: refetchUsers } = useUsers()
  const dialogRef = useRef<MilestoneDialogHandle>(null)

  useTopbarActions(
    isAdmin
      ? <button className="btn btn--sm" type="button" onClick={() => dialogRef.current?.open()}>마일스톤 추가</button>
      : null,
  )

  if (error) {
    return (
      <div className="empty">
        <span className="empty__title">불러오지 못했습니다</span>
        <span className="empty__body">{error.message}</span>
        <button className="btn btn--sm" type="button" onClick={refetch}>다시 시도</button>
      </div>
    )
  }
  if (loading || entries === null) return null

  if (entries.length === 0) {
    return (
      <>
        <MilestoneDialog ref={dialogRef} onSaved={refetch} />
        <EmptyState
          title="이 분기 항로가 아직 비어 있습니다"
          body="마일스톤을 만들고 선적 대기 이슈를 배치하면 진척률이 여기 표시됩니다."
        />
      </>
    )
  }

  // A fixed instant for this render — buildTimeline and every "오늘" derived
  // from it must agree, or the ship and the panel chips could disagree about
  // what day it is.
  const today = new Date()
  const timeline = buildTimeline(entries, today)
  const stateByMilestoneId = new Map<number, PortState>()
  for (const port of timeline.ports) {
    for (const m of port.milestones) stateByMilestoneId.set(m.id, port.state)
  }

  const undatedEntries = entries.filter((e) => e.milestone.endsOn === null)
  const groups = new Map<string, ApiRoadmapEntry[]>()
  for (const e of entries) {
    if (e.milestone.endsOn === null) continue
    const key = quarterKey(e.milestone.endsOn)
    groups.set(key, [...(groups.get(key) ?? []), e])
  }
  const sortedKeys = [...groups.keys()].sort()
  for (const key of sortedKeys) {
    groups.set(key, [...groups.get(key)!].sort((a, b) => a.milestone.endsOn!.localeCompare(b.milestone.endsOn!)))
  }

  return (
    <>
      <MilestoneDialog ref={dialogRef} onSaved={refetch} />

      {/* Catalog failure annotates, never blocks — same pattern as Inbox. */}
      {usersError ? (
        <div className="inline" style={{ marginBottom: 'var(--s-4)' }}>
          <p className="hint">담당자 정보를 불러오지 못했습니다. 최종 수정자 이름이 비어 보일 수 있습니다.</p>
          <button className="btn btn--sm" type="button" onClick={refetchUsers}>다시 시도</button>
        </div>
      ) : null}

      <Horizon entries={entries} timeline={timeline} today={today} />

      <section className="stack" style={{ gap: 'var(--s-6)' }}>
        {sortedKeys.map((key) => (
          <QuarterSection
            key={key}
            title={`${key.slice(0, 4)} ${key.slice(5)}`}
            range={Q_RANGE[Number(key.slice(-1))]}
            entries={groups.get(key)!}
            users={users}
            today={today}
            stateByMilestoneId={stateByMilestoneId}
            isAdmin={isAdmin}
            onEdit={(m) => dialogRef.current?.open(m)}
          />
        ))}
        {undatedEntries.length > 0 ? (
          <QuarterSection
            title="기간 미정"
            range={null}
            entries={undatedEntries}
            users={users}
            today={today}
            stateByMilestoneId={stateByMilestoneId}
            isAdmin={isAdmin}
            onEdit={(m) => dialogRef.current?.open(m)}
          />
        ) : null}
      </section>

      <p className="hint" style={{ marginTop: 'var(--s-5)', maxWidth: '78ch', lineHeight: 'var(--lh-prose)' }}>
        타임라인의 가로 위치는 실제 날짜입니다 — 항구는 마일스톤 종료일에, 배는 오늘에 서 있습니다.
        마일스톤은 종료일이 속한 분기로 묶입니다. 진척률 분모는 반송된 이슈를 제외한 건수이며,
        반송 건수는 화면에 함께 적습니다. 정박은 분모에 남습니다 — 취소가 아니라 지연이기 때문입니다.
      </p>
    </>
  )
}

function QuarterSection({ title, range, entries, users, today, stateByMilestoneId, isAdmin, onEdit }: {
  title: string
  range: [string, string] | null
  entries: ApiRoadmapEntry[]
  users: ApiUser[] | null
  today: Date
  stateByMilestoneId: Map<number, PortState>
  isAdmin: boolean
  onEdit: (m: ApiMilestone) => void
}) {
  return (
    <div>
      <div className="inline" style={{ marginBottom: 'var(--s-3)' }}>
        <h3 className="h-panel">{title}</h3>
        {range ? <span className="mono faint">{range[0]} → {range[1]}</span> : null}
        <span className="mono muted push">{entries.length}개 마일스톤</span>
      </div>
      <div className="grid3">
        {entries.map((entry) => (
          <MilestonePanel
            key={entry.milestone.id}
            entry={entry}
            users={users}
            today={today}
            portState={stateByMilestoneId.get(entry.milestone.id)}
            isAdmin={isAdmin}
            onEdit={onEdit}
          />
        ))}
      </div>
    </div>
  )
}

function MilestonePanel({ entry, users, today, portState, isAdmin, onEdit }: {
  entry: ApiRoadmapEntry
  users: ApiUser[] | null
  today: Date
  portState: PortState | undefined
  isAdmin: boolean
  onEdit: (m: ApiMilestone) => void
}) {
  const { milestone, total, done } = entry
  const done_ = isDone(entry)
  const chip = milestoneChip(entry, today)
  const overdue = chip.cls === 'chip--rejected'
  const pct = total === 0 ? null : Math.round((done / total) * 100)
  const rejectedCount = entry.issues.filter((i) => i.status === 'rejected').length
  // The waterline's "current milestone" crest drift is chronological, not
  // completion-based: it's live exactly while today sits inside the
  // milestone's own [startsOn, endsOn] window (design doc §4).
  const inWindow = milestone.startsOn !== null && milestone.endsOn !== null
    && daysUntil(milestone.startsOn, today) <= 0 && daysUntil(milestone.endsOn, today) >= 0
  const fill = pct ?? 0

  return (
    <article
      className={`panel berth${done_ ? ' berth--arrived' : !overdue && inWindow ? ' berth--live' : ''}`}
      style={{ '--fill': `${fill}%` } as CSSProperties}
    >
      <span className="berth__water" aria-hidden="true" />
      <div className="panel__body">
        <div className="inline">
          <span className={`chip ${chip.cls}`}>
            {chip.flag ? <span className={`flag ${chip.flag}`} aria-hidden="true" /> : null}
            {chip.label}
            {chip.en ? <span className="chip__en">{chip.en}</span> : null}
          </span>
          <span className="mono faint push">
            {milestone.startsOn ? `${dateLabel(milestone.startsOn)} → ` : ''}
            {milestone.endsOn ? dateLabel(milestone.endsOn) : '기한 없음'}
          </span>
          {isAdmin ? (
            <button className="btn btn--sm" type="button" onClick={() => onEdit(milestone)}>수정</button>
          ) : null}
        </div>
        <h4 className="h-panel" style={{ margin: 'var(--s-3) 0 var(--s-1)' }}>{milestone.name}</h4>
        <div className="counts" style={{ marginTop: 'var(--s-3)' }}>
          <span><b>{pct ?? '—'}</b>%</span>
          <span>{done} / {total}</span>
          {rejectedCount > 0 ? <span className="counts__ex">반송 {rejectedCount} · 집계 제외</span> : null}
        </div>
        <div className={`gauge${done_ ? ' gauge--arrived' : ''}`} style={{ '--fill': `${fill}%`, marginTop: 'var(--s-3)' } as CSSProperties}>
          <div className="gauge__fill" />
        </div>
        <div className="divider" style={{ margin: 'var(--s-4) 0' }} />
        <PanelBody entry={entry} done={done_} overdue={overdue} isNext={portState === 'next'} today={today} />
        <p className="hint" style={{ marginTop: 'var(--s-3)' }}>
          최종 수정 · {attributionName(milestone, users) ?? ''} · {shortDate(milestone.updatedAt)}
        </p>
      </div>
    </article>
  )
}

// Exactly one of five things sits below the divider, in this priority: a
// milestone that arrived, one that's overdue, or the one lit next-deadline
// buoy each explain themselves instead of listing issues; an empty
// milestone says so; only the ordinary in-progress case lists work.
function PanelBody({ entry, done, overdue, isNext, today }: {
  entry: ApiRoadmapEntry
  done: boolean
  overdue: boolean
  isNext: boolean
  today: Date
}) {
  const m = entry.milestone
  if (done) {
    return <span className="arrived">{m.endsOn ? `${dateLabel(m.endsOn)} ` : ''}전량 도착</span>
  }
  if (overdue) {
    return (
      <p className="hint">
        기한 {dateLabel(m.endsOn!)} 경과 · 미완료 {entry.total - entry.done}건 — 남은 이슈를 옮기거나 기한을 조정하세요.
      </p>
    )
  }
  if (isNext) {
    return <p className="hint">다음 기한 · {daysUntil(m.endsOn!, today)}일 남음 — 항로 부표에 불이 켜졌습니다.</p>
  }
  const activeIssues = entry.issues.filter((i) => i.status !== 'rejected')
  if (activeIssues.length === 0) {
    return (
      <div className="empty" style={{ padding: 'var(--s-5) 0' }}>
        <span className="empty__body">아직 항로가 비어 있습니다. 선적 대기 이슈를 이 마일스톤에 배치하면 진척률이 채워집니다.</span>
      </div>
    )
  }
  return (
    <ul className="stack--sm" style={{ display: 'flex', flexDirection: 'column' }}>
      {activeIssues.slice(0, 3).map((issue) => (
        <li className="rel" key={issue.id}>
          <StatusChip status={issue.status} />
          <span className="rel__title">{issue.title}</span>
          <span className="push"><PriorityTag priority={issue.priority} /></span>
        </li>
      ))}
    </ul>
  )
}
