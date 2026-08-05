// @vitest-environment jsdom
// Task 16: a 400 from POST /milestones with an invalid date range carries
// `issues: [{ path: 'endsOn', message: ... }]` (validation.ts's
// createMilestoneSchema.refine). That message must render next to the 종료일
// input, not just the generic form-level line.
import { createRef } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MilestoneDialog, type MilestoneDialogHandle } from '@/ui/milestone-dialog'

// jsdom has no <dialog> support (no showModal/close) — same gap every native
// <dialog> component here would hit under jsdom, not specific to this test.
HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }

const failParse = (error: string, issues: Array<{ path: string; message: string }>) => ({
  ok: false, status: 400, json: async () => ({ ok: false, error, issues }),
})

describe('MilestoneDialog — surfaces field-level errors', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('renders the issues[].message for `endsOn` next to the 종료일 input', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      failParse('입력값이 올바르지 않습니다', [{ path: 'endsOn', message: '시작일은 종료일보다 늦을 수 없습니다' }]),
    ))

    const ref = createRef<MilestoneDialogHandle>()
    render(<MilestoneDialog ref={ref} onSaved={() => {}} />)
    ref.current!.open()

    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '분기 마감' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(screen.getByText('시작일은 종료일보다 늦을 수 없습니다')).toBeTruthy())
    // The generic form-level line is still shown as the fallback.
    expect(screen.getByText('입력값이 올바르지 않습니다')).toBeTruthy()
  })
})
