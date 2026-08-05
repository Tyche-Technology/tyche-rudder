// @vitest-environment jsdom
// The small shared pieces in src/ui/bits.tsx had no dedicated coverage at
// all — every consumer (meta-panel, comment-thread, relations-panel) only
// ever exercised the Avatar branch. This file drives the rest directly:
// Gauge's arrival threshold, ActionError's conflict-vs-plain-error split,
// and ReasonField's full submit/cancel/pending contract.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Avatar, EmptyState, Gauge, ActionError, ReasonField } from '@/ui/bits'

describe('Avatar', () => {
  afterEach(cleanup)

  it('renders the first character of the name', () => {
    render(<Avatar name="한솔" />)
    expect(screen.getByText('한')).toBeTruthy()
  })
})

describe('EmptyState', () => {
  afterEach(cleanup)

  it('renders the given title and body copy', () => {
    render(<EmptyState title="관계가 없습니다" body="아직 연결된 이슈가 없습니다" />)
    expect(screen.getByText('관계가 없습니다')).toBeTruthy()
    expect(screen.getByText('아직 연결된 이슈가 없습니다')).toBeTruthy()
  })
})

describe('Gauge', () => {
  afterEach(cleanup)

  it('does not mark arrival below 100% fill', () => {
    const { container } = render(<Gauge fill={40} />)
    const gauge = container.querySelector('.gauge')!
    expect(gauge.className).not.toContain('gauge--arrived')
    expect(gauge.getAttribute('style')).toContain('40%')
  })

  it('marks arrival at 100% fill', () => {
    const { container } = render(<Gauge fill={100} />)
    expect(container.querySelector('.gauge')!.className).toContain('gauge--arrived')
  })
})

describe('ActionError', () => {
  afterEach(cleanup)

  it('renders the message with no retry button when not a conflict', () => {
    render(<ActionError message="요청에 실패했습니다" conflict={false} onRetry={() => {}} />)
    expect(screen.getByText('요청에 실패했습니다')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '새로고침' })).toBeNull()
  })

  it('shows a 새로고침 button on conflict and calls onRetry when clicked', () => {
    const onRetry = vi.fn()
    render(<ActionError message="버전이 달라졌습니다" conflict={true} onRetry={onRetry} />)
    fireEvent.click(screen.getByRole('button', { name: '새로고침' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})

describe('ReasonField', () => {
  afterEach(cleanup)

  const noop = () => {}

  it('disables confirm until a reason is entered, and forwards changes via onReasonChange', () => {
    const onReasonChange = vi.fn()
    const { rerender } = render(
      <ReasonField action="반송" reason="" onReasonChange={onReasonChange} onCancel={noop} onConfirm={noop} pending={false} />,
    )
    expect(screen.getByRole('button', { name: '반송' })).toHaveProperty('disabled', true)

    fireEvent.change(screen.getByLabelText('반송 사유'), { target: { value: '재고 없음' } })
    expect(onReasonChange).toHaveBeenCalledWith('재고 없음')

    rerender(
      <ReasonField action="반송" reason="재고 없음" onReasonChange={onReasonChange} onCancel={noop} onConfirm={noop} pending={false} />,
    )
    expect(screen.getByRole('button', { name: '반송' })).toHaveProperty('disabled', false)
  })

  it('treats a whitespace-only reason as still blank', () => {
    render(<ReasonField action="정박" reason="   " onReasonChange={noop} onCancel={noop} onConfirm={noop} pending={false} />)
    expect(screen.getByRole('button', { name: '정박' })).toHaveProperty('disabled', true)
  })

  it('calls onConfirm with no args on confirm, and onCancel on cancel', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<ReasonField action="정박" reason="재고 확인 중" onReasonChange={noop} onCancel={onCancel} onConfirm={onConfirm} pending={false} />)

    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(onCancel).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '정박' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('disables the textarea and both buttons while pending, even with a valid reason', () => {
    render(<ReasonField action="반송" reason="사유 있음" onReasonChange={noop} onCancel={noop} onConfirm={noop} pending={true} />)
    expect(screen.getByLabelText('반송 사유')).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: '취소' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: '반송' })).toHaveProperty('disabled', true)
  })
})
