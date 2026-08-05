'use client'

// The requester's own view of every issue they've filed — no grooming
// controls, no product/requester columns (it's implicitly "me"), just
// enough to answer "where is my request". Data source is a flat
// ApiIssue[] with no per-row actor info, so the rejection reason block
// below can't cite who rejected it or when (design/04-my-requests.html's
// mockup attribution suffix) without an N+1 detail fetch per row — the
// same tradeoff Inbox's PilotFlag comment already made.
import Link from 'next/link'
import { useApi } from '@/ui/api'
import { useTopbarActions } from '@/ui/shell'
import { NewIssueButton } from '@/ui/new-issue'
import { useMilestones, nameOf } from '@/ui/catalog-data'
import { StatusChip, TypeTag, PriorityTag } from '@/ui/chips'
import { shortDate } from '@/ui/format'
import { EmptyState } from '@/ui/bits'
import type { ApiIssue, IssueStatus } from '@/ui/types'

// design/04-my-requests.html overrides the base .row grid (68px last
// column) to 96px so a milestone quarter or MM-DD date fits.
const ROW_COLS = '52px minmax(0,1fr) auto auto auto 96px auto'
const CLOSED_STATUSES: IssueStatus[] = ['done', 'rejected']

export default function RequestsPage() {
  // design/04-my-requests.html's topbar carries a 새 이슈 button, same as
  // Inbox's. Roadmap's topbar carries 마일스톤 추가 for admins instead;
  // Board has no topbar action at all.
  useTopbarActions(<NewIssueButton />)
  const { data: issues, error, loading, refetch } = useApi<ApiIssue[]>('/api/v1/issues?requester=me')
  const { milestones, error: milestonesError, refetch: refetchMilestones } = useMilestones()

  if (error) {
    return (
      <div className="empty">
        <span className="empty__title">불러오지 못했습니다</span>
        <span className="empty__body">{error.message}</span>
        <button className="btn btn--sm" type="button" onClick={refetch}>다시 시도</button>
      </div>
    )
  }
  if (loading || issues === null) return null

  if (issues.length === 0) {
    return (
      <EmptyState
        title="아직 보낸 요청이 없습니다"
        body="새 이슈로 첫 요청을 등록해 보세요."
      />
    )
  }

  const inProgress = issues.filter((i) => !CLOSED_STATUSES.includes(i.status))
  const closed = issues.filter((i) => CLOSED_STATUSES.includes(i.status))
  // The 통관 hint only makes sense while something is actually waiting on
  // it — a progress list with no inbox row (all backlog/in_progress/on_hold)
  // has nothing for that copy to explain.
  const showInboxHint = inProgress.some((i) => i.status === 'inbox')

  return (
    <>
      <div className="view__head">
        <h2 className="h-view">내가 보낸 화물 {issues.length}건</h2>
        <span className="mono muted push">진행 {inProgress.length} · 종료 {closed.length}</span>
      </div>
      <p className="view__lede">
        내가 요청한 건만 모아 보여줍니다. 상태가 바뀌면 슬랙으로도 알려드립니다.
        진행이 멈춘 것처럼 보이면 이슈를 열어 댓글로 물어보세요.
      </p>

      {/* Catalog failure annotates, never blocks (Tasks 7-10 shared
          pattern) — only the milestone quarter column goes blank. */}
      {milestonesError ? (
        <div className="inline" style={{ marginBottom: 'var(--s-4)' }}>
          <p className="hint">마일스톤 정보를 불러오지 못했습니다. 목록은 표시되지만 일부 정보가 비어 보일 수 있습니다.</p>
          <button className="btn btn--sm" type="button" onClick={refetchMilestones}>다시 시도</button>
        </div>
      ) : null}

      {inProgress.length > 0 ? (
        <div className="panel" style={{ marginBottom: 'var(--s-5)' }}>
          <div className="panel__head">
            <h3 className="h-card">진행 중</h3>
            <span className="mono muted push">{inProgress.length}건</span>
          </div>
          <div className="rows">
            {inProgress.map((issue) => (
              <div key={issue.id} className="row" style={{ gridTemplateColumns: ROW_COLS }}>
                <span className="id">#{issue.id}</span>
                <span className="row__title">{issue.title}</span>
                <TypeTag type={issue.type} />
                <StatusChip status={issue.status} />
                <PriorityTag priority={issue.priority} />
                {/* nameOf(null id) is '미배정' — exactly what a not-yet-
                    scheduled inbox/backlog row should show here. */}
                <span className="mono faint">{nameOf(milestones, issue.milestoneId) ?? ''}</span>
                <Link className="btn btn--sm" href={`/issues/${issue.id}`}>열기</Link>
              </div>
            ))}
          </div>
          {showInboxHint ? (
            <div className="panel__body" style={{ borderTop: '1px solid var(--hairline)', paddingTop: 'var(--s-3)' }}>
              <p className="hint">
                입항 대기는 아직 통관 전이라 우선순위와 마일스톤이 정해지지 않은 상태입니다.
                보통 3일 안에 통관됩니다.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {closed.length > 0 ? (
        <div className="panel">
          <div className="panel__head">
            <h3 className="h-card">종료</h3>
            <span className="mono muted push">{closed.length}건</span>
          </div>
          <div className="rows">
            {closed.map((issue) => <ClosedRow key={issue.id} issue={issue} />)}
          </div>
        </div>
      ) : null}

      <p className="hint" style={{ marginTop: 'var(--s-4)', maxWidth: '74ch', lineHeight: 'var(--lh-prose)' }}>
        반송은 요청을 닫는 결정이므로 사유가 반드시 함께 표시됩니다.
        사유 없이 반송된 이슈는 저장되지 않습니다.
      </p>
    </>
  )
}

// Returns a Fragment, not a wrapping <div>, so the optional reason block
// stays a flat sibling of .row under .rows — a wrapper would make every
// row falsely match `.row:last-child` (see rudder.css §9) and strip the
// divider between two consecutive rows that both lack one.
function ClosedRow({ issue }: { issue: ApiIssue }) {
  return (
    <>
      <div className="row" style={{ gridTemplateColumns: ROW_COLS }}>
        <span className="id">#{issue.id}</span>
        <span className="row__title">{issue.title}</span>
        <TypeTag type={issue.type} />
        <StatusChip status={issue.status} />
        {issue.status === 'done' ? <span className="arrived">도착</span> : <span className="mono faint">—</span>}
        <span className="mono faint">{shortDate(issue.updatedAt)}</span>
        <Link className="btn btn--sm" href={`/issues/${issue.id}`}>열기</Link>
      </div>
      {/* reason == null guard: a rejected issue always has one in practice
          (반송 requires a reason server-side), but never render the stamp
          off a value that isn't there. */}
      {issue.status === 'rejected' && issue.reason ? (
        <div className="row-expand">
          <div className="inline" style={{ gap: 'var(--s-3)' }}>
            <span className="stamp">반송</span>
            <p className="prose" style={{ fontSize: 'var(--t-13)', flex: 1, minWidth: 220 }}>
              <b>#{issue.id} 반송 사유</b> · {issue.reason}
            </p>
          </div>
        </div>
      ) : null}
    </>
  )
}
