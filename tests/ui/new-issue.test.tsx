// @vitest-environment jsdom
// Task 16: a 400 from POST /issues carries `issues: [{ path: 'title', ... }]`
// (createIssueSchema) — that message must render next to the 제목 input, not
// just the generic form-level line.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }))

import { NewIssueButton } from '@/ui/new-issue'

// jsdom has no <dialog> support (no showModal/close).
HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }

const PRODUCT = { id: 1, name: '제품 A', active: true, createdByUserId: null, updatedByUserId: null, createdAt: '', updatedAt: '' }

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ ok: true, data }) })
const failParse = (error: string, issues: Array<{ path: string; message: string }>) => ({
  ok: false, status: 400, json: async () => ({ ok: false, error, issues }),
})

describe('NewIssueButton — surfaces field-level errors', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('renders the issues[].message for `title` next to the 제목 input', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (path === '/api/v1/products' && method === 'GET') return ok([PRODUCT])
      if (path === '/api/v1/issues' && method === 'POST') {
        return failParse('입력값이 올바르지 않습니다', [{ path: 'title', message: '제목은 200자 이하여야 합니다' }])
      }
      throw new Error(`unrouted ${method} ${path}`)
    }))

    render(<NewIssueButton />)
    fireEvent.click(screen.getByRole('button', { name: '새 이슈' }))
    fireEvent.change(await screen.findByLabelText('제목'), { target: { value: '아주 긴 제목' } })
    fireEvent.click(screen.getByRole('button', { name: '등록' }))

    await waitFor(() => expect(screen.getByText('제목은 200자 이하여야 합니다')).toBeTruthy())
    // The generic form-level line is still shown as the fallback.
    expect(screen.getByText('입력값이 올바르지 않습니다')).toBeTruthy()
  })
})
