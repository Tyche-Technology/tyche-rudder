// @vitest-environment jsdom
// Fix round 2 regression: backlog.refetch() after a failed reorder used to
// trip the page's loading gate and blank the WHOLE board (all four columns,
// head, filters) for the reconciliation round-trip. Uses the keyboard path
// (⌥↓), not drag — no dataTransfer/getBoundingClientRect to fake in jsdom,
// and it exercises the exact same commitReorder as drag does.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@/ui/shell', () => ({
  useMe: () => ({ id: 1, email: 'hansol@tyche.test', name: '김한솔', role: 'admin', banned: false, slackUserId: null }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }))

import BoardPage from '@/app/(app)/board/page'

const ISSUE_A = {
  id: 1, title: 'Issue A', description: '', type: 'bug', productId: 1, status: 'backlog',
  priority: 'p1', requesterId: 2, assigneeId: null, milestoneId: null,
  sortOrder: 1, reason: null, version: 1,
  createdAt: '2026-07-30T01:00:00.000Z', updatedAt: '2026-07-30T01:00:00.000Z',
}
const ISSUE_B = { ...ISSUE_A, id: 2, title: 'Issue B', sortOrder: 2 }

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ ok: true, data }) })
const fail = (status: number, error: string) => ({ ok: false, status, json: async () => ({ ok: false, error }) })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

describe('board — reorder failure does not blank the page', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('keeps the board on screen through the rollback + reconciliation refetch', async () => {
    let backlogCalls = 0
    const refetchGate = deferred<{ ok: boolean; status: number; json: () => Promise<unknown> }>()
    vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (path.startsWith('/api/v1/products')) return ok([])
      if (path.startsWith('/api/v1/users')) return ok([])
      if (path.startsWith('/api/v1/milestones')) return ok([])
      if (path === '/api/v1/issues?status=backlog') {
        backlogCalls += 1
        return backlogCalls === 1 ? ok([ISSUE_A, ISSUE_B]) : refetchGate.promise
      }
      if (path.startsWith('/api/v1/issues?status=')) return ok([])
      if (method === 'POST' && /\/reorder$/.test(path)) return fail(404, '이슈를 찾을 수 없습니다')
      throw new Error(`unrouted ${method} ${path}`)
    }))

    render(<BoardPage />)
    await screen.findByText('선적 대기') // StatusChip's own text node — see getNodeText note below
    const cardA = screen.getByText('Issue A').closest('article')!
    fireEvent.keyDown(cardA, { key: 'ArrowDown', altKey: true })

    // The reorder POST fails, commitReorder rolls back and calls
    // backlog.refetch() — which is pending on refetchGate. The board must
    // still be rendered (not blanked to null) while that GET is in flight.
    await waitFor(() => expect(backlogCalls).toBe(2))
    expect(screen.getByText('선적 대기')).toBeTruthy()
    expect(screen.getByText('Issue A')).toBeTruthy()
    expect(screen.getByText(/저장하지 못했습니다/)).toBeTruthy()

    refetchGate.resolve(ok([ISSUE_A, ISSUE_B]))
    await waitFor(() => expect(backlogCalls).toBe(2)) // no further refetch loop
  })
})

// Task 16: the reorder route has no form to render issues[] next to — it's
// a validation.ts object-level refine ('afterId 또는 beforeId가 필요합니다')
// with no matching input, so the banner composes from issues[0].message
// instead of collapsing to the generic '입력값이 올바르지 않습니다' sentence.
describe('board — reorder banner prefers the specific issues[] message', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('shows issues[0].message rather than the generic parse-failure sentence', async () => {
    const failParse = (issues: Array<{ path: string; message: string }>) => ({
      ok: false, status: 400,
      json: async () => ({ ok: false, error: '입력값이 올바르지 않습니다', issues }),
    })
    vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (path.startsWith('/api/v1/products')) return ok([])
      if (path.startsWith('/api/v1/users')) return ok([])
      if (path.startsWith('/api/v1/milestones')) return ok([])
      if (path === '/api/v1/issues?status=backlog') return ok([ISSUE_A, ISSUE_B])
      if (path.startsWith('/api/v1/issues?status=')) return ok([])
      if (method === 'POST' && /\/reorder$/.test(path)) {
        return failParse([{ path: '', message: 'afterId 또는 beforeId가 필요합니다' }])
      }
      throw new Error(`unrouted ${method} ${path}`)
    }))

    render(<BoardPage />)
    await screen.findByText('선적 대기')
    const cardA = screen.getByText('Issue A').closest('article')!
    fireEvent.keyDown(cardA, { key: 'ArrowDown', altKey: true })

    await waitFor(() => expect(screen.getByText(/afterId 또는 beforeId가 필요합니다/)).toBeTruthy())
    expect(screen.queryByText(/입력값이 올바르지 않습니다/)).toBeNull()
  })
})

// Task 4: reorder now requires expectedVersion, and a successful reorder
// bumps the card's version — commitReorder must read the version off the
// card it's actually moving (from `order`, not a stale closure), and write
// the response's bumped version back so the NEXT reorder sends a fresh one.
describe('board — reorder sends and updates expectedVersion', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('sends the dragged card\'s current version and writes back the bumped one', async () => {
    const reorderBodies: Array<Record<string, unknown>> = []
    vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (path.startsWith('/api/v1/products')) return ok([])
      if (path.startsWith('/api/v1/users')) return ok([])
      if (path.startsWith('/api/v1/milestones')) return ok([])
      if (path === '/api/v1/issues?status=backlog') return ok([ISSUE_A, ISSUE_B])
      if (path.startsWith('/api/v1/issues?status=')) return ok([])
      if (method === 'POST' && /\/reorder$/.test(path)) {
        const body = JSON.parse(init?.body as string)
        reorderBodies.push(body)
        return ok({ ...ISSUE_A, sortOrder: 2048, version: (body.expectedVersion as number) + 1 })
      }
      throw new Error(`unrouted ${method} ${path}`)
    }))

    render(<BoardPage />)
    await screen.findByText('선적 대기')
    const cardA = screen.getByText('Issue A').closest('article')!
    fireEvent.keyDown(cardA, { key: 'ArrowDown', altKey: true })

    await waitFor(() => expect(reorderBodies).toHaveLength(1))
    expect(reorderBodies[0]).toMatchObject({ expectedVersion: ISSUE_A.version })

    // A second reorder must send the bumped version the first response
    // returned (ISSUE_A.version + 1), not the original ISSUE_A.version again.
    fireEvent.keyDown(cardA, { key: 'ArrowUp', altKey: true })
    await waitFor(() => expect(reorderBodies).toHaveLength(2))
    expect(reorderBodies[1]).toMatchObject({ expectedVersion: ISSUE_A.version + 1 })
  })
})
