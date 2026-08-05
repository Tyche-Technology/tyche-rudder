import { describe, it, expect } from 'vitest'
import { notFound, conflict, ruleViolation } from '@/domain/result'
import { KIND_STATUS } from '@/app/api/v1/respond'

describe('domain error constructors', () => {
  it('notFound produces kind not_found', () => {
    expect(notFound('이슈를 찾을 수 없습니다')).toEqual({ ok: false, kind: 'not_found', error: '이슈를 찾을 수 없습니다' })
  })

  it('conflict produces kind conflict', () => {
    expect(conflict('충돌')).toEqual({ ok: false, kind: 'conflict', error: '충돌' })
  })

  it('ruleViolation produces kind rule', () => {
    expect(ruleViolation('규칙 위반')).toEqual({ ok: false, kind: 'rule', error: '규칙 위반' })
  })
})

describe('KIND_STATUS', () => {
  it('maps each error kind to its pinned HTTP status', () => {
    expect(KIND_STATUS).toEqual({ not_found: 404, conflict: 409, rule: 422 })
  })
})
