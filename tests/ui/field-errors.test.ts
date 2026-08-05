import { describe, it, expect } from 'vitest'
import { ApiError } from '@/ui/api'
import { fieldErrors } from '@/ui/field-errors'

describe('fieldErrors', () => {
  it('maps an ApiError with issues to a path→message lookup', () => {
    const err = new ApiError(400, '입력값이 올바르지 않습니다')
    err.issues = [{ path: 'name', message: '제품 이름을 입력해주세요' }]
    expect(fieldErrors(err)).toEqual({ name: '제품 이름을 입력해주세요' })
  })

  it('returns an empty lookup for a non-ApiError or an error without issues', () => {
    expect(fieldErrors(new Error('boom'))).toEqual({})
    expect(fieldErrors(new ApiError(500, '서버 오류가 발생했습니다'))).toEqual({})
  })
})
