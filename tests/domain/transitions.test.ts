import { describe, it, expect } from 'vitest'
import { validateTransition } from '@/domain/transitions'

describe('validateTransition', () => {
  it('inbox → backlog requires a priority', () => {
    const noPrio = validateTransition({ status: 'inbox', priority: null }, { to: 'backlog' })
    expect(noPrio).toEqual({ ok: false, kind: 'rule', error: '백로그 진입에는 우선순위(P0/P1/P2)가 필요합니다' })
    const withPrio = validateTransition({ status: 'inbox', priority: null }, { to: 'backlog', priority: 'p1' })
    expect(withPrio).toEqual({ ok: true, priority: 'p1' })
  })

  it('keeps existing priority when re-entering backlog', () => {
    expect(validateTransition({ status: 'done', priority: 'p2' }, { to: 'backlog' }))
      .toEqual({ ok: true, priority: 'p2' })
  })

  it('rejected/on_hold require a reason', () => {
    expect(validateTransition({ status: 'inbox', priority: null }, { to: 'rejected' }).ok).toBe(false)
    expect(validateTransition({ status: 'inbox', priority: null }, { to: 'on_hold', reason: '3분기 이후 재검토' }).ok).toBe(true)
  })

  it('blocks illegal jumps and terminal states', () => {
    expect(validateTransition({ status: 'inbox', priority: null }, { to: 'done' }))
      .toEqual({ ok: false, kind: 'rule', error: 'inbox → done 전이는 허용되지 않습니다' })
    expect(validateTransition({ status: 'rejected', priority: null }, { to: 'backlog', priority: 'p1' }).ok).toBe(false)
    expect(validateTransition({ status: 'done', priority: 'p1' }, { to: 'backlog' }).ok).toBe(true) // reopen
  })

  it('backlog → in_progress carries the existing priority forward', () => {
    expect(validateTransition({ status: 'backlog', priority: 'p0' }, { to: 'in_progress' }))
      .toEqual({ ok: true, priority: 'p0' })
  })

  it('backlog → rejected/on_hold require a reason', () => {
    expect(validateTransition({ status: 'backlog', priority: 'p1' }, { to: 'rejected' }).ok).toBe(false)
    expect(validateTransition({ status: 'backlog', priority: 'p1' }, { to: 'rejected', reason: '중복 이슈' }).ok).toBe(true)
    expect(validateTransition({ status: 'backlog', priority: 'p1' }, { to: 'on_hold' }).ok).toBe(false)
    expect(validateTransition({ status: 'backlog', priority: 'p1' }, { to: 'on_hold', reason: '보류' }).ok).toBe(true)
  })

  it('in_progress → done/backlog carry the existing priority forward', () => {
    expect(validateTransition({ status: 'in_progress', priority: 'p2' }, { to: 'done' }))
      .toEqual({ ok: true, priority: 'p2' })
    expect(validateTransition({ status: 'in_progress', priority: 'p2' }, { to: 'backlog' }))
      .toEqual({ ok: true, priority: 'p2' })
  })

  it('in_progress → on_hold requires a reason', () => {
    expect(validateTransition({ status: 'in_progress', priority: 'p2' }, { to: 'on_hold' }).ok).toBe(false)
    expect(validateTransition({ status: 'in_progress', priority: 'p2' }, { to: 'on_hold', reason: '의존성 대기' }).ok).toBe(true)
  })

  it('on_hold → backlog carries the existing priority forward', () => {
    expect(validateTransition({ status: 'on_hold', priority: 'p0' }, { to: 'backlog' }))
      .toEqual({ ok: true, priority: 'p0' })
  })

  it('on_hold → rejected requires a reason', () => {
    expect(validateTransition({ status: 'on_hold', priority: 'p0' }, { to: 'rejected' }).ok).toBe(false)
    expect(validateTransition({ status: 'on_hold', priority: 'p0' }, { to: 'rejected', reason: '우선순위 낮음' }).ok).toBe(true)
  })

  it('rejects a whitespace-only reason', () => {
    expect(validateTransition({ status: 'inbox', priority: null }, { to: 'on_hold', reason: '   ' }).ok).toBe(false)
  })
})
