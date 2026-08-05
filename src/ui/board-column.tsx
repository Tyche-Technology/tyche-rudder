'use client'

// One kanban column (design §4 `.col`). Drag ordering and the ⌥↑/⌥↓
// keyboard path are wired only when `onReorder` is passed — the page only
// passes it for the backlog column, since reorderIssue (domain/ordering.ts)
// rejects any other status.
import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import { StatusChip } from './chips'
import { IssueCard } from './issue-card'
import { nameOf } from './catalog-data'
import { reorderTarget, keyboardTarget, type Target } from './reorder'
import { STATUS_LABEL } from './labels'
import type { ApiIssue, ApiMilestone, ApiProduct, ApiUser, IssueStatus } from './types'

export function BoardColumn({
  status,
  issues,
  products,
  users,
  milestones,
  onReorder,
  note,
}: {
  status: IssueStatus
  // Already filtered (product chips) and, for backlog, in the caller's
  // live optimistic order — this column just renders it.
  issues: ApiIssue[]
  products: ApiProduct[] | null
  users: ApiUser[] | null
  milestones: ApiMilestone[] | null
  onReorder?: (draggedId: number, target: Target) => void
  note?: ReactNode
}) {
  const draggable = onReorder !== undefined
  const [draggingId, setDraggingId] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const bodyRef = useRef<HTMLElement>(null)

  const orderedIds = issues.map((i) => i.id)
  const others = orderedIds.filter((id) => id !== draggingId)

  function handleDragOver(e: DragEvent<HTMLElement>) {
    if (draggingId === null) return
    e.preventDefault()
    const container = bodyRef.current
    if (!container) return
    const cards = Array.from(container.querySelectorAll<HTMLElement>('[data-issue-id]'))
      .filter((el) => Number(el.dataset.issueId) !== draggingId)
    let idx = cards.length
    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i].getBoundingClientRect()
      if (e.clientY < rect.top + rect.height / 2) { idx = i; break }
    }
    setDropIndex(idx)
  }

  function handleDragLeave(e: DragEvent<HTMLElement>) {
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return
    setDropIndex(null)
  }

  function handleDrop(e: DragEvent<HTMLElement>) {
    e.preventDefault()
    if (draggingId !== null && dropIndex !== null) {
      const target = reorderTarget(orderedIds, draggingId, dropIndex)
      if (target) onReorder?.(draggingId, target)
    }
    setDraggingId(null)
    setDropIndex(null)
  }

  const dropIndicator = <div className="drop" aria-hidden="true" key="drop" />
  const nodes: ReactNode[] = []
  let otherIndex = 0
  for (const issue of issues) {
    const isDragging = issue.id === draggingId
    if (!isDragging && draggingId !== null && dropIndex === otherIndex) nodes.push(dropIndicator)
    nodes.push(
      <IssueCard
        key={issue.id}
        issue={issue}
        productName={nameOf(products, issue.productId)}
        assigneeName={nameOf(users, issue.assigneeId)}
        milestoneName={nameOf(milestones, issue.milestoneId)}
        draggable={draggable}
        dragging={isDragging}
        onDragStart={draggable ? (e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(issue.id)); setDraggingId(issue.id) } : undefined}
        onDragEnd={draggable ? () => { setDraggingId(null); setDropIndex(null) } : undefined}
        onMove={draggable ? (dir) => {
          const target = keyboardTarget(orderedIds, issue.id, dir)
          if (target) onReorder?.(issue.id, target)
        } : undefined}
      />,
    )
    if (!isDragging) otherIndex += 1
  }
  if (draggingId !== null && dropIndex === others.length) nodes.push(dropIndicator)

  return (
    <section className="col" aria-label={STATUS_LABEL[status].ko}>
      <div className="col__head">
        <StatusChip status={status} />
        <span className="col__n">{issues.length}</span>
      </div>
      <section
        className="col__body"
        aria-label={`${STATUS_LABEL[status].ko} 카드`}
        ref={bodyRef}
        onDragOver={draggable ? handleDragOver : undefined}
        onDragLeave={draggable ? handleDragLeave : undefined}
        onDrop={draggable ? handleDrop : undefined}
      >
        {issues.length === 0 ? <p className="hint">이 열은 비어 있습니다.</p> : nodes}
      </section>
      {note ? <div className="col__note">{note}</div> : null}
    </section>
  )
}
