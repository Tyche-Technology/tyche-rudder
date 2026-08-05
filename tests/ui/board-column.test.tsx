// @vitest-environment jsdom
// BoardColumn's own drag arithmetic (dragOver -> drop index, dragLeave ->
// clear, drop -> commit) had no direct coverage — only the keyboard path was
// exercised, via board-reorder.test.tsx's full BoardPage render. This drives
// the DOM drag events straight at the component, stubbing
// getBoundingClientRect the way jsdom requires (it never lays out real
// boxes).
//
// jsdom has no native DragEvent, and @testing-library's fireEvent.dragOver /
// dragLeave silently drop clientY / relatedTarget when building a plain
// Event for an unrecognized type — every property below the helper had to
// be verified by hand against a throwaway instrumented run of board-column
// before trusting it. MouseEvent's own constructor
// DOES honor clientY and relatedTarget (both are real MouseEventInit
// fields); dataTransfer isn't, so it's bolted on afterward via
// defineProperty, since MouseEvent has no accessor guarding that name.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { BoardColumn } from '@/ui/board-column'
import type { ApiIssue } from '@/ui/types'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }))

function issue(id: number, title: string): ApiIssue {
  return {
    id, title, description: '', type: 'bug', productId: 1, status: 'backlog',
    priority: 'p1', requesterId: 1, assigneeId: null, milestoneId: null,
    sortOrder: id, reason: null, version: 1,
    createdAt: '2026-07-30T01:00:00.000Z', updatedAt: '2026-07-30T01:00:00.000Z',
  }
}

function dragEvent(
  type: string,
  init: { clientY?: number; relatedTarget?: EventTarget | null; dataTransfer?: unknown } = {},
) {
  const { dataTransfer, ...ctorInit } = init
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...ctorInit })
  if (dataTransfer !== undefined) Object.defineProperty(event, 'dataTransfer', { value: dataTransfer, configurable: true })
  return event
}

function fakeDataTransfer() {
  return { effectAllowed: '', setData: vi.fn(), getData: vi.fn() }
}

// board-column's own scan filters OUT the dragging card before indexing, so
// stub rects the same way: only the non-dragged cards get a position (0,
// 100, 200, ... in list order), 100px apart, so dragOver's midpoint check
// (clientY < rect.top + rect.height / 2) has a deterministic answer.
function stubCardLayout(container: HTMLElement, draggingId: number) {
  const others = Array.from(container.querySelectorAll<HTMLElement>('[data-issue-id]'))
    .filter((el) => Number(el.dataset.issueId) !== draggingId)
  others.forEach((card, i) => {
    card.getBoundingClientRect = () => ({
      top: i * 100, bottom: i * 100 + 100, height: 100, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => {},
    } as DOMRect)
  })
}

describe('BoardColumn — empty state', () => {
  afterEach(cleanup)

  it('renders the 이 열은 비어 있습니다 hint when there are no issues', () => {
    render(<BoardColumn status="backlog" issues={[]} products={null} users={null} milestones={null} />)
    expect(screen.getByText('이 열은 비어 있습니다.')).toBeTruthy()
  })
})

describe('BoardColumn — drag indicator', () => {
  afterEach(cleanup)

  it('shows the drop indicator at the hovered index, and clears it when the drag leaves the column', () => {
    const onReorder = vi.fn()
    const issues = [issue(1, 'A'), issue(2, 'B'), issue(3, 'C')]
    const { container } = render(
      <BoardColumn status="backlog" issues={issues} products={null} users={null} milestones={null} onReorder={onReorder} />,
    )
    const body = screen.getByRole('region', { name: '선적 대기 카드' })

    fireEvent(screen.getByText('A').closest('article')!, dragEvent('dragstart', { dataTransfer: fakeDataTransfer() }))
    stubCardLayout(container, 1) // dragging A (id 1): others are B, C

    // clientY=40 is above B's midpoint (the first "other", top=0..100) -> drop index 0.
    fireEvent(body, dragEvent('dragover', { clientY: 40 }))
    expect(container.querySelector('.drop')).toBeTruthy()

    // Leaving the column entirely (no relatedTarget inside .col__body) clears it.
    fireEvent(body, dragEvent('dragleave', { relatedTarget: null }))
    expect(container.querySelector('.drop')).toBeNull()
  })

  it('does not clear the indicator when the drag only moves onto a child element', () => {
    const onReorder = vi.fn()
    const issues = [issue(1, 'A'), issue(2, 'B')]
    const { container } = render(
      <BoardColumn status="backlog" issues={issues} products={null} users={null} milestones={null} onReorder={onReorder} />,
    )
    const body = screen.getByRole('region', { name: '선적 대기 카드' })
    const cardB = screen.getByText('B').closest('article')!

    fireEvent(screen.getByText('A').closest('article')!, dragEvent('dragstart', { dataTransfer: fakeDataTransfer() }))
    stubCardLayout(container, 1)
    fireEvent(body, dragEvent('dragover', { clientY: 40 }))
    expect(container.querySelector('.drop')).toBeTruthy()

    // relatedTarget is card B, which IS inside .col__body -> stays open.
    fireEvent(body, dragEvent('dragleave', { relatedTarget: cardB }))
    expect(container.querySelector('.drop')).toBeTruthy()
  })

  it('commits the drop as afterId of the card above the drop point', () => {
    const onReorder = vi.fn()
    const issues = [issue(1, 'A'), issue(2, 'B'), issue(3, 'C')]
    const { container } = render(
      <BoardColumn status="backlog" issues={issues} products={null} users={null} milestones={null} onReorder={onReorder} />,
    )
    const body = screen.getByRole('region', { name: '선적 대기 카드' })

    fireEvent(screen.getByText('A').closest('article')!, dragEvent('dragstart', { dataTransfer: fakeDataTransfer() }))
    stubCardLayout(container, 1)

    // Others are [B (top 0-100), C (top 100-200)]. clientY=149 fails B's
    // midpoint (50) but is before C's midpoint (150) -> drop index 1,
    // i.e. "after B, before C".
    fireEvent(body, dragEvent('dragover', { clientY: 149 }))
    fireEvent(body, dragEvent('drop', { clientY: 149 }))

    expect(onReorder).toHaveBeenCalledWith(1, { afterId: 2 })
    // State resets after drop: a further dragOver with no new dragstart lands on cards.length (past-the-end).
    fireEvent(body, dragEvent('dragover', { clientY: 40 }))
    expect(container.querySelector('.drop')).toBeNull()
  })

  it('commits the drop past the last card as afterId of the last card', () => {
    const onReorder = vi.fn()
    const issues = [issue(1, 'A'), issue(2, 'B'), issue(3, 'C')]
    const { container } = render(
      <BoardColumn status="backlog" issues={issues} products={null} users={null} milestones={null} onReorder={onReorder} />,
    )
    const body = screen.getByRole('region', { name: '선적 대기 카드' })

    fireEvent(screen.getByText('A').closest('article')!, dragEvent('dragstart', { dataTransfer: fakeDataTransfer() }))
    stubCardLayout(container, 1)

    // Past both remaining cards' midpoints -> drop index == others.length (2).
    fireEvent(body, dragEvent('dragover', { clientY: 500 }))
    expect(container.querySelector('.drop')).toBeTruthy()
    fireEvent(body, dragEvent('drop', { clientY: 500 }))

    expect(onReorder).toHaveBeenCalledWith(1, { afterId: 3 })
  })

  it('still commits a drop that reproduces the current position — no-op suppression is the caller\'s job', () => {
    const onReorder = vi.fn()
    const issues = [issue(1, 'A'), issue(2, 'B')]
    const { container } = render(
      <BoardColumn status="backlog" issues={issues} products={null} users={null} milestones={null} onReorder={onReorder} />,
    )
    const body = screen.getByRole('region', { name: '선적 대기 카드' })

    fireEvent(screen.getByText('A').closest('article')!, dragEvent('dragstart', { dataTransfer: fakeDataTransfer() }))
    stubCardLayout(container, 1)
    // Only "other" card is B at row 0 -> dropping before it reproduces A's
    // own current spot (A is already first). reorder.ts's isNoopReorder is
    // what would suppress this; board-column just reports the target.
    fireEvent(body, dragEvent('dragover', { clientY: 40 }))
    fireEvent(body, dragEvent('drop', { clientY: 40 }))

    expect(onReorder).toHaveBeenCalledWith(1, { beforeId: 2 })
  })
})

describe('BoardColumn — non-draggable columns', () => {
  afterEach(cleanup)

  it('renders cards without a grip and ignores drag events when onReorder is not passed', () => {
    const { container } = render(
      <BoardColumn status="done" issues={[issue(1, 'A')]} products={null} users={null} milestones={null} />,
    )
    expect(container.querySelector('.card__grip')).toBeNull()
    const body = screen.getByRole('region', { name: '배송 완료 카드' })
    // No handlers attached: firing dragOver must not throw and must not add
    // a drop indicator, since draggable columns never call setDraggingId.
    fireEvent(body, dragEvent('dragover', { clientY: 40 }))
    expect(container.querySelector('.drop')).toBeNull()
  })
})

describe('BoardColumn — note', () => {
  afterEach(cleanup)

  it('renders the note slot when provided', () => {
    render(
      <BoardColumn status="backlog" issues={[]} products={null} users={null} milestones={null} note={<span>안내 문구</span>} />,
    )
    expect(screen.getByText('안내 문구')).toBeTruthy()
  })
})
