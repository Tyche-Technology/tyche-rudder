// @vitest-environment jsdom
// MetaPanel had almost no direct coverage (47/45/35/50) — the one existing
// exercise is through the full issue-detail-page (issue-detail-version.test)
// with a single priority PATCH. This drives the panel directly: read-only
// vs admin rendering, a patch that saves, a patch that comes back a 409
// conflict, the reason-required transition flow, and the backlog-position
// row's three states.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MetaPanel } from '@/ui/meta-panel'
import type { ApiIssue } from '@/ui/types'

afterEach(cleanup)

const ISSUE: ApiIssue = {
  id: 1, title: '이슈', description: '', type: 'bug', productId: 1, status: 'backlog',
  priority: 'p1', requesterId: 2, assigneeId: 3, milestoneId: 5,
  sortOrder: 1, reason: null, version: 1,
  createdAt: '2026-07-30T01:00:00.000Z', updatedAt: '2026-07-30T01:00:00.000Z',
}

function baseProps(overrides: Partial<Parameters<typeof MetaPanel>[0]> = {}) {
  return {
    issue: ISSUE,
    products: [{ id: 1, name: '제품A', active: true, createdByUserId: null, updatedByUserId: null, createdAt: '', updatedAt: '' }],
    milestones: [{ id: 5, name: 'M1', startsOn: null, endsOn: null, closed: false, version: 1, createdByUserId: null, updatedByUserId: null, createdAt: '', updatedAt: '' }],
    users: [{ id: 3, email: 'u3@tyche.test', name: '담당자', role: 'user' as const, banned: false, slackUserId: null }],
    productName: '제품A',
    milestoneName: 'M1',
    assigneeName: '김담당',
    requesterName: '박요청',
    pilotCreated: false,
    backlogPos: -1,
    backlogTotal: 0,
    backlogLoading: false,
    backlogError: null,
    onBacklogRetry: vi.fn(),
    isAdmin: false,
    onPatch: vi.fn(),
    patchPending: false,
    patchError: null,
    patchConflict: false,
    onPatchRetry: vi.fn(),
    reasonTarget: null,
    reason: '',
    onReasonChange: vi.fn(),
    onReasonTarget: vi.fn(),
    onTransition: vi.fn(),
    transitionPending: false,
    transitionError: null,
    transitionConflict: false,
    onTransitionRetry: vi.fn(),
    ...overrides,
  }
}

describe('MetaPanel — read-only (non-admin)', () => {
  it('renders product/milestone/assignee/requester as plain text, with no edit controls or action buttons', () => {
    render(<MetaPanel {...baseProps()} />)
    expect(screen.getByText('제품A')).toBeTruthy()
    expect(screen.getByText('M1')).toBeTruthy()
    expect(screen.getByText('김담당')).toBeTruthy()
    expect(screen.getByText('박요청')).toBeTruthy()
    expect(screen.queryByRole('radiogroup', { name: '우선순위' })).toBeNull()
    expect(screen.queryByRole('button', { name: '선적 대기로' })).toBeNull()
  })

  it('renders the pilot flag when the issue was pilot-created', () => {
    render(<MetaPanel {...baseProps({ pilotCreated: true })} />)
    expect(screen.getByTitle('도선사(슬랙 봇)가 대신 등록')).toBeTruthy()
  })

  it('renders 미배정 for an issue with no assignee, even before the catalog resolves a name', () => {
    render(<MetaPanel {...baseProps({ issue: { ...ISSUE, assigneeId: null }, assigneeName: null })} />)
    expect(screen.getByText('미배정')).toBeTruthy()
  })

  it('renders blank (not 미배정) while a real assignee id is still resolving against the catalog', () => {
    render(<MetaPanel {...baseProps({ assigneeName: null })} />)
    expect(screen.queryByText('미배정')).toBeNull()
    expect(screen.queryByText('김담당')).toBeNull()
  })
})

describe('MetaPanel — admin edits', () => {
  it('calls onPatch with the clicked priority', () => {
    const onPatch = vi.fn()
    render(<MetaPanel {...baseProps({ isAdmin: true, onPatch })} />)
    fireEvent.click(screen.getByRole('radio', { name: 'P0' }))
    expect(onPatch).toHaveBeenCalledWith({ priority: 'p0' })
  })

  it('marks the current priority as checked', () => {
    render(<MetaPanel {...baseProps({ isAdmin: true })} />)
    expect(screen.getByRole('radio', { name: 'P1' })).toHaveProperty('ariaChecked', 'true')
    expect(screen.getByRole('radio', { name: 'P0' })).toHaveProperty('ariaChecked', 'false')
  })

  it('calls onPatch with null when the assignee select is cleared to 미배정', () => {
    const onPatch = vi.fn()
    render(<MetaPanel {...baseProps({ isAdmin: true, onPatch })} />)
    fireEvent.change(screen.getByLabelText('담당자'), { target: { value: '' } })
    expect(onPatch).toHaveBeenCalledWith({ assigneeId: null })
  })

  it('calls onPatch with the numeric id when the product select changes', () => {
    const onPatch = vi.fn()
    const products = [
      { id: 1, name: '제품A', active: true, createdByUserId: null, updatedByUserId: null, createdAt: '', updatedAt: '' },
      { id: 2, name: '제품B', active: true, createdByUserId: null, updatedByUserId: null, createdAt: '', updatedAt: '' },
    ]
    render(<MetaPanel {...baseProps({ isAdmin: true, onPatch, products })} />)
    fireEvent.change(screen.getByLabelText('제품'), { target: { value: '2' } })
    expect(onPatch).toHaveBeenCalledWith({ productId: 2 })
  })

  it('disables every edit control while a patch is pending', () => {
    render(<MetaPanel {...baseProps({ isAdmin: true, patchPending: true })} />)
    expect(screen.getByRole('radio', { name: 'P0' })).toHaveProperty('disabled', true)
    expect(screen.getByLabelText('담당자')).toHaveProperty('disabled', true)
  })

  it('shows a select-disabling loading state when the catalog is still null', () => {
    render(<MetaPanel {...baseProps({ isAdmin: true, products: null, milestones: null, users: null })} />)
    expect(screen.getByLabelText('제품')).toHaveProperty('disabled', true)
    expect(screen.getByLabelText('마일스톤')).toHaveProperty('disabled', true)
    expect(screen.getByLabelText('담당자')).toHaveProperty('disabled', true)
  })
})

describe('MetaPanel — patch error and conflict', () => {
  it('shows the patch error with no retry button when it is not a conflict', () => {
    render(<MetaPanel {...baseProps({ patchError: '요청에 실패했습니다', patchConflict: false })} />)
    expect(screen.getByText('요청에 실패했습니다')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '새로고침' })).toBeNull()
  })

  it('surfaces a patch conflict and calls onPatchRetry from its 새로고침 button', () => {
    const onPatchRetry = vi.fn()
    render(<MetaPanel {...baseProps({ patchError: '다른 사용자가 먼저 저장했습니다', patchConflict: true, onPatchRetry })} />)
    fireEvent.click(screen.getByRole('button', { name: '새로고침' }))
    expect(onPatchRetry).toHaveBeenCalledTimes(1)
  })
})

describe('MetaPanel — status transitions (admin)', () => {
  it('fires a no-reason transition (선적 대기로 from in_progress) immediately', () => {
    const onTransition = vi.fn()
    render(<MetaPanel {...baseProps({ isAdmin: true, issue: { ...ISSUE, status: 'in_progress' }, onTransition })} />)
    fireEvent.click(screen.getByRole('button', { name: '선적 대기로' }))
    expect(onTransition).toHaveBeenCalledWith('backlog')
  })

  it('routes a reason-required action (반송) through onReasonTarget instead of transitioning immediately', () => {
    const onTransition = vi.fn()
    const onReasonTarget = vi.fn()
    render(<MetaPanel {...baseProps({ isAdmin: true, onTransition, onReasonTarget })} />)
    fireEvent.click(screen.getByRole('button', { name: '반송' }))
    expect(onReasonTarget).toHaveBeenCalledWith('rejected')
    expect(onTransition).not.toHaveBeenCalled()
  })

  it('renders the ReasonField once a reason target is set, and confirming calls onTransition with the target and reason', () => {
    const onTransition = vi.fn()
    render(<MetaPanel {...baseProps({ isAdmin: true, reasonTarget: 'rejected', reason: '재고 없음', onTransition })} />)
    fireEvent.click(screen.getByRole('button', { name: '반송' }))
    expect(onTransition).toHaveBeenCalledWith('rejected', '재고 없음')
  })

  it('cancelling the reason field clears both the target and the typed reason', () => {
    const onReasonTarget = vi.fn()
    const onReasonChange = vi.fn()
    render(<MetaPanel {...baseProps({ isAdmin: true, reasonTarget: 'on_hold', reason: '검토 중', onReasonTarget, onReasonChange })} />)
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(onReasonTarget).toHaveBeenCalledWith(null)
    expect(onReasonChange).toHaveBeenCalledWith('')
  })

  it('renders no action buttons for a rejected (terminal) issue', () => {
    render(<MetaPanel {...baseProps({ isAdmin: true, issue: { ...ISSUE, status: 'rejected' } })} />)
    expect(screen.queryByRole('button', { name: '반송' })).toBeNull()
    expect(screen.queryByRole('button', { name: '정박' })).toBeNull()
  })

  it('surfaces a transition conflict and calls onTransitionRetry from its 새로고침 button', () => {
    const onTransitionRetry = vi.fn()
    render(<MetaPanel {...baseProps({ isAdmin: true, transitionError: '상태가 변경되었습니다', transitionConflict: true, onTransitionRetry })} />)
    fireEvent.click(screen.getByRole('button', { name: '새로고침' }))
    expect(onTransitionRetry).toHaveBeenCalledTimes(1)
  })

  it('disables every action button while a transition is pending', () => {
    render(<MetaPanel {...baseProps({ isAdmin: true, transitionPending: true })} />)
    expect(screen.getByRole('button', { name: '반송' })).toHaveProperty('disabled', true)
  })
})

describe('MetaPanel — backlog position row', () => {
  it('shows the position/total when loaded with no error', () => {
    render(<MetaPanel {...baseProps({ backlogPos: 2, backlogTotal: 9 })} />)
    expect(screen.getByText('3 / 9')).toBeTruthy()
  })

  it('shows the backlog error with a retry button instead of a position', () => {
    const onBacklogRetry = vi.fn()
    render(<MetaPanel {...baseProps({ backlogError: '순서를 불러오지 못했습니다', onBacklogRetry })} />)
    expect(screen.getByText('순서를 불러오지 못했습니다')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(onBacklogRetry).toHaveBeenCalledTimes(1)
  })

  it('hides the position row while loading even once a real position is known', () => {
    // backlogPos/backlogTotal are already resolved here — only backlogLoading
    // is what must suppress the row, isolating that clause from the
    // (also-guarding) backlogPos !== -1 check.
    render(<MetaPanel {...baseProps({ backlogLoading: true, backlogPos: 2, backlogTotal: 9 })} />)
    expect(screen.queryByText('3 / 9')).toBeNull()
    expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull()
  })

  // updateIssue refuses a banned assignee, so offering one only buys a
  // rejection — but the person already assigned has to stay in the list or
  // the <select> value matches no option and reads as 미배정.
  it('drops suspended crew from the assignee options, keeping the current assignee', () => {
    const users = [
      { id: 3, email: 'u3@tyche.test', name: '담당자', role: 'user' as const, banned: true, slackUserId: null },
      { id: 4, email: 'u4@tyche.test', name: '정지된선원', role: 'user' as const, banned: true, slackUserId: null },
      { id: 5, email: 'u5@tyche.test', name: '활성선원', role: 'user' as const, banned: false, slackUserId: null },
    ]
    render(<MetaPanel {...baseProps({ isAdmin: true, users })} />)
    const select = screen.getByLabelText('담당자') as HTMLSelectElement
    const labels = Array.from(select.options).map((o) => o.textContent)
    expect(labels).toContain('활성선원')
    expect(labels).not.toContain('정지된선원')
    expect(labels).toContain('담당자') // banned, but currently assigned (ISSUE.assigneeId === 3)
    expect(select.value).toBe('3')
  })

  it('renders no backlog row at all for a non-backlog issue', () => {
    render(<MetaPanel {...baseProps({ issue: { ...ISSUE, status: 'done' }, backlogPos: 2, backlogTotal: 9 })} />)
    expect(screen.queryByText('3 / 9')).toBeNull()
  })
})
