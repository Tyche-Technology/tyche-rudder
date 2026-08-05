import { describe, it, expect } from 'vitest'
import { countByProduct } from '@/ui/inbox-filters'
import type { ApiIssue } from '@/ui/types'

function issue(productId: number): ApiIssue {
  return {
    id: 1, title: 't', description: '', type: 'bug', productId, status: 'inbox',
    priority: null, requesterId: 1, assigneeId: null, milestoneId: null,
    sortOrder: null, reason: null, version: 1, createdAt: '', updatedAt: '',
  }
}

describe('countByProduct', () => {
  it('returns an empty map for an empty list', () => {
    expect(countByProduct([])).toEqual(new Map())
  })

  it('counts issues per productId', () => {
    const issues = [issue(1), issue(2), issue(1), issue(3), issue(1)]
    expect(countByProduct(issues)).toEqual(new Map([[1, 3], [2, 1], [3, 1]]))
  })
})
