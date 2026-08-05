'use client'

// The kanban unit (design §4 `.card`). Presentational — drag mechanics and
// the reorder decision live in board-column.tsx / reorder.ts; this component
// only renders markup and forwards the native drag/keyboard events it's
// given.
import { useRouter } from 'next/navigation'
import { PriorityTag, TypeTag } from './chips'
import { shortDate } from './format'
import type { ApiIssue } from './types'

export function IssueCard({
  issue,
  productName,
  assigneeName,
  milestoneName,
  draggable = false,
  dragging = false,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  issue: ApiIssue
  // null = catalog still loading (nameOf) — render blank, never '미배정'.
  productName: string | null
  assigneeName: string | null
  milestoneName: string | null
  // Drag + the ⌥↑/⌥↓ keyboard path only apply to backlog cards — every
  // other column passes these as their defaults (design §4: grip only
  // shows on backlog cards).
  draggable?: boolean
  dragging?: boolean
  onDragStart?: (e: React.DragEvent<HTMLElement>) => void
  onDragEnd?: () => void
  onMove?: (dir: 'up' | 'down') => void
}) {
  const router = useRouter()
  const className = [
    'card',
    issue.priority === 'p0' ? 'card--p0' : '',
    dragging ? 'card--lifted' : '',
  ].filter(Boolean).join(' ')

  return (
    <article
      className={className}
      tabIndex={0}
      draggable={draggable}
      data-issue-id={issue.id}
      onClick={() => router.push(`/issues/${issue.id}`)}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onKeyDown={(e) => {
        if (onMove && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault()
          onMove(e.key === 'ArrowUp' ? 'up' : 'down')
          return
        }
        if (e.key === 'Enter') router.push(`/issues/${issue.id}`)
      }}
    >
      <div className="card__top">
        <span className="id">#{issue.id}</span>
        <PriorityTag priority={issue.priority} />
        {draggable ? <span className="card__grip" aria-hidden="true">⠿</span> : null}
      </div>
      <h3 className="h-card">{issue.title}</h3>
      <div className="card__meta">
        <TypeTag type={issue.type} />
        <span className="mono faint">{productName ?? ''}</span>
      </div>
      {issue.status === 'on_hold' && issue.reason ? (
        <p className="hint">정박 사유 · {issue.reason}</p>
      ) : null}
      <footer className="card__foot">
        <span>{assigneeName ?? ''}</span>
        {issue.status === 'done'
          ? <span className="arrived push">{shortDate(issue.updatedAt)} 도착</span>
          : <span className="push mono">{milestoneName ?? ''}</span>}
      </footer>
    </article>
  )
}
