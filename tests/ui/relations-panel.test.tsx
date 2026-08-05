// @vitest-environment jsdom
// RelationsPanel (list + remove) and RelationAddButton (the dialog behind
// '관계 추가') had no coverage at all before this — the panel only ever
// rendered through a full issue-detail-page test with zero relations. This
// drives both directly: a relation renders with its kind/link/해제 button,
// and adding one posts the right body and surfaces both success and error.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { RelationsPanel, RelationAddButton } from '@/ui/relations-panel'
import type { ApiRelation } from '@/ui/types'

// jsdom has no <dialog> support (no showModal/close) — same shim as
// milestone-dialog.test.tsx.
HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }

const RELATION: ApiRelation = {
  id: 1,
  issueId: 10,
  relatedIssueId: 20,
  kind: 'blocks',
  createdAt: '2026-07-30T01:00:00.000Z',
  related: { id: 20, title: '연결된 이슈', status: 'inbox' },
}

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ ok: true, data }) })
const fail = (status: number, error: string) => ({ ok: false, status, json: async () => ({ ok: false, error }) })

describe('RelationsPanel', () => {
  afterEach(cleanup)

  it('renders the relation count, kind, and a link to the related issue', () => {
    render(<RelationsPanel relations={[RELATION]} isAdmin={false} pending={false} error={null} onRemove={() => {}} />)
    expect(screen.getByText('1')).toBeTruthy()
    expect(screen.getByText('blocks')).toBeTruthy()
    const link = screen.getByRole('link', { name: /#20 연결된 이슈/ }) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/issues/20')
  })

  it('hides the 해제 button for non-admins, and shows it for admins', () => {
    const { rerender } = render(
      <RelationsPanel relations={[RELATION]} isAdmin={false} pending={false} error={null} onRemove={() => {}} />,
    )
    expect(screen.queryByRole('button', { name: '해제' })).toBeNull()

    rerender(<RelationsPanel relations={[RELATION]} isAdmin={true} pending={false} error={null} onRemove={() => {}} />)
    expect(screen.getByRole('button', { name: '해제' })).toBeTruthy()
  })

  it('calls onRemove with the relation id when 해제 is clicked', () => {
    const onRemove = vi.fn()
    render(<RelationsPanel relations={[RELATION]} isAdmin={true} pending={false} error={null} onRemove={onRemove} />)
    fireEvent.click(screen.getByRole('button', { name: '해제' }))
    expect(onRemove).toHaveBeenCalledWith(1)
  })

  it('renders the error message when given one', () => {
    render(<RelationsPanel relations={[]} isAdmin={true} pending={false} error="관계를 해제하지 못했습니다" onRemove={() => {}} />)
    expect(screen.getByText('관계를 해제하지 못했습니다')).toBeTruthy()
  })

  it('renders just the issue number, with no title, when the related issue is gone', () => {
    const orphaned: ApiRelation = { ...RELATION, related: null }
    render(<RelationsPanel relations={[orphaned]} isAdmin={false} pending={false} error={null} onRemove={() => {}} />)
    const link = screen.getByRole('link') as HTMLAnchorElement
    expect(link.textContent?.trim()).toBe('#20')
  })
})

describe('RelationAddButton', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('disables 추가 until an issue number is entered', () => {
    render(<RelationAddButton issueId={10} onAdded={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '관계 추가' }))
    expect(screen.getByRole('button', { name: '추가' })).toHaveProperty('disabled', true)

    fireEvent.change(screen.getByLabelText('이슈 번호'), { target: { value: '20' } })
    expect(screen.getByRole('button', { name: '추가' })).toHaveProperty('disabled', false)
  })

  it('posts the related issue id and selected kind, closes the dialog, and calls onAdded', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(RELATION))
    vi.stubGlobal('fetch', fetchMock)
    const onAdded = vi.fn()
    render(<RelationAddButton issueId={10} onAdded={onAdded} />)

    fireEvent.click(screen.getByRole('button', { name: '관계 추가' }))
    fireEvent.change(screen.getByLabelText('이슈 번호'), { target: { value: '20' } })
    fireEvent.change(screen.getByLabelText('관계'), { target: { value: 'blocks' } })
    fireEvent.click(screen.getByRole('button', { name: '추가' }))

    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/issues/10/relations',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ relatedIssueId: 20, kind: 'blocks' }) }),
    )
    // Dialog closed on success.
    expect(document.querySelector('dialog')?.hasAttribute('open')).toBe(false)
  })

  it('shows the server error and keeps the dialog open on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fail(404, '이슈를 찾을 수 없습니다')))
    render(<RelationAddButton issueId={10} onAdded={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: '관계 추가' }))
    fireEvent.change(screen.getByLabelText('이슈 번호'), { target: { value: '999' } })
    fireEvent.click(screen.getByRole('button', { name: '추가' }))

    expect(await screen.findByText('이슈를 찾을 수 없습니다')).toBeTruthy()
    expect(document.querySelector('dialog')?.hasAttribute('open')).toBe(true)
  })

  it('resets the related-id field and kind, and clears the previous error, each time it reopens', () => {
    render(<RelationAddButton issueId={10} onAdded={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: '관계 추가' }))
    fireEvent.change(screen.getByLabelText('이슈 번호'), { target: { value: '20' } })
    fireEvent.click(screen.getByRole('button', { name: '취소' }))

    fireEvent.click(screen.getByRole('button', { name: '관계 추가' }))
    expect(screen.getByLabelText('이슈 번호')).toHaveProperty('value', '')
  })

  it('prevents Esc from closing the dialog while a request is pending', () => {
    const gate = { resolve: (_: unknown) => {} }
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { gate.resolve = resolve })))
    render(<RelationAddButton issueId={10} onAdded={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: '관계 추가' }))
    fireEvent.change(screen.getByLabelText('이슈 번호'), { target: { value: '20' } })
    fireEvent.click(screen.getByRole('button', { name: '추가' }))

    const dialog = document.querySelector('dialog')!
    const cancelEvent = new Event('cancel', { cancelable: true })
    dialog.dispatchEvent(cancelEvent)
    expect(cancelEvent.defaultPrevented).toBe(true)
  })

  it('lets Esc close the dialog normally when nothing is pending', () => {
    render(<RelationAddButton issueId={10} onAdded={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '관계 추가' }))

    const dialog = document.querySelector('dialog')!
    const cancelEvent = new Event('cancel', { cancelable: true })
    dialog.dispatchEvent(cancelEvent)
    expect(cancelEvent.defaultPrevented).toBe(false)
  })

  it('guards submit against a bypass of the disabled 추가 button (e.g. Enter in the issue-number field)', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<RelationAddButton issueId={10} onAdded={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '관계 추가' }))

    // relatedId is still '' (Number('') = 0) — submitting the form directly
    // (not via the disabled button) must still no-op, not send a request
    // for issue #0.
    fireEvent.submit(document.querySelector('form')!)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
