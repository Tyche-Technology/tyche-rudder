import { describe, it, expect } from 'vitest'
import { formatEvent } from '@/ui/history'
import type { ApiEvent, ApiUser } from '@/ui/types'

const USERS: ApiUser[] = [{ id: 1, email: 'u1@tyche.test', name: '박지연', role: 'user', banned: false, slackUserId: null }]

function event(overrides: Partial<ApiEvent>): ApiEvent {
  return {
    id: 1, issueId: 1, actorType: 'user', actorUserId: 1, actorTokenId: null,
    field: 'status', oldValue: null, newValue: null, createdAt: '2026-07-29T14:02:00.000Z',
    ...overrides,
  }
}

describe('formatEvent', () => {
  it('renders both Korean labels for a status change', () => {
    const { text } = formatEvent(event({ field: 'status', oldValue: 'inbox', newValue: 'backlog' }), USERS)
    expect(text).toBe('상태 입항 대기 → 선적 대기')
  })

  it('renders 도선사 for an agent-created event', () => {
    const { who, text } = formatEvent(
      event({ field: 'created', actorType: 'agent', actorUserId: null, oldValue: null, newValue: '제목' }),
      USERS,
    )
    expect(who).toBe('도선사')
    expect(text).toBe('등록')
  })

  it('renders 사용자 #{id} for an unknown user id', () => {
    const { who } = formatEvent(event({ actorUserId: 999 }), USERS)
    expect(who).toBe('사용자 #999')
  })

  it('renders blank while users is still loading, never a false miss', () => {
    const { who } = formatEvent(event({ actorUserId: 999 }), null)
    expect(who).toBe('')
  })

  it('omits raw sortOrder values from a sort_order event', () => {
    const { text } = formatEvent(event({ field: 'sort_order', oldValue: '3.5', newValue: null }), USERS)
    expect(text).toBe('백로그 순서 변경')
    expect(text).not.toContain('3.5')
  })

  it('renders 없음 → P0 for a null-to-p0 priority change', () => {
    const { text } = formatEvent(event({ field: 'priority', oldValue: null, newValue: 'p0' }), USERS)
    expect(text).toBe('우선순위 없음 → P0')
  })

  it('uppercases both sides of a priority change between two real values', () => {
    const { text } = formatEvent(event({ field: 'priority', oldValue: 'p1', newValue: 'p2' }), USERS)
    expect(text).toBe('우선순위 P1 → P2')
  })

  it('renders 사유 기록 when a reason is set', () => {
    const { text } = formatEvent(event({ field: 'reason', oldValue: null, newValue: '재고 부족' }), USERS)
    expect(text).toBe('사유 기록')
  })

  it('renders 사유 삭제 when a reason is cleared', () => {
    const { text } = formatEvent(event({ field: 'reason', oldValue: '재고 부족', newValue: null }), USERS)
    expect(text).toBe('사유 삭제')
  })

  it('renders 관계 추가 / 관계 해제 without the raw kind:#id payload', () => {
    expect(formatEvent(event({ field: 'relation_added', newValue: 'blocks:#5' }), USERS).text).toBe('관계 추가')
    expect(formatEvent(event({ field: 'relation_removed', oldValue: 'blocks:#5' }), USERS).text).toBe('관계 해제')
  })

  it('falls back to "{label} 변경" for other frozen fields', () => {
    expect(formatEvent(event({ field: 'milestone_id', oldValue: null, newValue: '3' }), USERS).text).toBe('마일스톤 변경')
    expect(formatEvent(event({ field: 'title' }), USERS).text).toBe('제목 변경')
  })

  it('carries the raw field value through unchanged, for the mono audit column', () => {
    expect(formatEvent(event({ field: 'assignee_id' }), USERS).field).toBe('assignee_id')
  })

  it('resolves who by users lookup on actorUserId', () => {
    expect(formatEvent(event({ actorUserId: 1 }), USERS).who).toBe('박지연')
  })
})
