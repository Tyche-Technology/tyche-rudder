// @vitest-environment jsdom
// Task 4 fix round 1, Finding 2: two rapid mutations from the issue detail
// page must not manufacture a conflict against each other. refetch() is
// async, so between two quick edits the page can still be rendering the
// PRE-first-edit issue.version — the second mutation must use the version
// the first one's response actually returned, not the stale rendered value.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@/ui/shell', () => ({
  useMe: () => ({ id: 1, email: 'hansol@tyche.test', name: '김한솔', role: 'admin', banned: false, slackUserId: null }),
  useTopbarActions: () => {},
}))
vi.mock('next/navigation', () => ({ useParams: () => ({ id: '1' }) }))

import IssueDetailPage from '@/app/(app)/issues/[id]/page'

const ISSUE = {
  id: 1,
  title: '재고 동기화가 멈춥니다',
  description: '',
  type: 'bug',
  productId: 1,
  status: 'inbox',
  priority: null,
  requesterId: 2,
  assigneeId: null,
  milestoneId: null,
  sortOrder: null,
  reason: null,
  version: 1,
  createdAt: '2026-07-30T01:00:00.000Z',
  updatedAt: '2026-07-30T01:00:00.000Z',
}
const DETAIL = { issue: ISSUE, comments: [], events: [], relations: [], attachments: [] }

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ ok: true, data }) })

describe('issue detail — rapid sequential mutations do not self-conflict', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('sends the version the first mutation returned to the second, not the stale rendered version', async () => {
    const patchBodies: Array<Record<string, unknown>> = []
    // The GET always hands back the original, pre-mutation DETAIL — never
    // the bumped version a real backend would show after the first PATCH.
    // This isolates the fix (a page-level tracked version) from the natural
    // refetch race: an unfixed page would otherwise sometimes pass anyway if
    // the refetch happened to land before the second mutation fires.
    vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (path.startsWith('/api/v1/products')) return ok([])
      if (path.startsWith('/api/v1/users')) return ok([])
      if (path.startsWith('/api/v1/milestones')) return ok([])
      if (method === 'PATCH' && path === '/api/v1/issues/1') {
        const body = JSON.parse(init?.body as string)
        patchBodies.push(body)
        return ok({ ...ISSUE, priority: 'p0', version: (body.expectedVersion as number) + 1 })
      }
      if (path === '/api/v1/issues/1') return ok(DETAIL)
      throw new Error(`unrouted ${method} ${path}`)
    }))

    render(<IssueDetailPage />)

    // First mutation: set priority via MetaPanel.
    fireEvent.click(await screen.findByRole('radio', { name: 'P0' }))
    await waitFor(() => expect(patchBodies).toHaveLength(1))
    expect(patchBodies[0]).toMatchObject({ expectedVersion: 1 })

    // Second mutation, right on the heels of the first: edit the title.
    // findByRole (not getByRole) because the first mutation's own refetch()
    // briefly re-renders the page through its `loading` state — without the
    // fix, this reads the still-stale rendered issue.version (1) and 409s
    // against the priority PATCH that already won.
    fireEvent.click(await screen.findByRole('button', { name: '제목 수정' }))
    fireEvent.change(screen.getByLabelText('제목'), { target: { value: '수정된 제목' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(patchBodies).toHaveLength(2))
    expect(patchBodies[1]).toMatchObject({ expectedVersion: 2 })
  })
})
