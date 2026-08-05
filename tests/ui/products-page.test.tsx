// @vitest-environment jsdom
// Task 16: a 400 from POST /products carries `issues` naming the field that
// failed (Task 5's envelope) — the create-product row must render that
// message next to the name input, not just the generic form-level line.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@/ui/shell', () => ({
  useMe: () => ({ id: 1, email: 'hansol@tyche.test', name: '김한솔', role: 'admin', banned: false, slackUserId: null }),
}))

import ProductsPage from '@/app/(app)/products/page'

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ ok: true, data }) })
const failParse = (error: string, issues: Array<{ path: string; message: string }>) => ({
  ok: false, status: 400, json: async () => ({ ok: false, error, issues }),
})

describe('ProductsPage — add product surfaces field-level errors', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('renders the issues[].message for `name` next to the new-product input', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (path === '/api/v1/products' && method === 'GET') return ok([])
      if (path === '/api/v1/users') return ok([])
      if (path === '/api/v1/products' && method === 'POST') {
        return failParse('입력값이 올바르지 않습니다', [{ path: 'name', message: '이름은 100자 이하여야 합니다' }])
      }
      throw new Error(`unrouted ${method} ${path}`)
    }))

    render(<ProductsPage />)
    const input = await screen.findByLabelText('새 제품 이름')
    fireEvent.change(input, { target: { value: '아주 긴 제품 이름' } })
    fireEvent.click(screen.getByRole('button', { name: '제품 추가' }))

    await waitFor(() => expect(screen.getByText('이름은 100자 이하여야 합니다')).toBeTruthy())
    // The generic form-level line is still shown as the fallback.
    expect(screen.getByText('입력값이 올바르지 않습니다')).toBeTruthy()
  })
})

// Fix round 1: toggleActive cleared `error` but not `errors`, so a field
// error left over from a rejected rename kept rendering forever — not
// cleared by the toggle succeeding, failing, or reopening the editor.
describe('ProductsPage — toggling active clears a stale rename field error', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('drops the `name` hint once toggleActive runs, even though the rename never succeeded', async () => {
    const product = {
      id: 1, name: '제품 A', active: true, createdByUserId: null, updatedByUserId: null,
      createdAt: '2026-07-30T01:00:00.000Z', updatedAt: '2026-07-30T01:00:00.000Z',
    }
    vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (path === '/api/v1/products' && method === 'GET') return ok([product])
      if (path === '/api/v1/users') return ok([])
      if (path === '/api/v1/products/1' && method === 'PATCH') {
        const body = JSON.parse(init?.body as string)
        if ('name' in body) return failParse('입력값이 올바르지 않습니다', [{ path: 'name', message: '이름은 100자 이하여야 합니다' }])
        return ok({ ...product, active: !body.active })
      }
      throw new Error(`unrouted ${method} ${path}`)
    }))

    render(<ProductsPage />)
    fireEvent.click(await screen.findByRole('button', { name: '수정' }))
    fireEvent.change(screen.getByLabelText('제품 이름'), { target: { value: '아주 긴 이름' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(screen.getByText('이름은 100자 이하여야 합니다')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: '비활성화' }))
    await waitFor(() => expect(screen.queryByText('이름은 100자 이하여야 합니다')).toBeNull())
  })
})
