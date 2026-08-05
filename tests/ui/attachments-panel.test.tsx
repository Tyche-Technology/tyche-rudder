// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { AttachmentsPanel } from '@/ui/attachments-panel'
import type { ApiAttachment } from '@/ui/types'

const ATTACHMENT: ApiAttachment = {
  id: 1,
  issueId: 7,
  filename: '배치로그.png',
  contentType: 'image/png',
  sizeBytes: 1536,
  actorType: 'user',
  actorUserId: 1,
  actorTokenId: null,
  createdAt: '2026-07-31T09:37:00.000Z',
}

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ ok: true, data }) })
const fail = (status: number, error: string) => ({ ok: false, status, json: async () => ({ ok: false, error }) })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

describe('AttachmentsPanel', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('renders the 첨부된 화물이 없습니다 empty state with no attachments', () => {
    render(<AttachmentsPanel issueId={7} attachments={[]} onChanged={() => {}} />)
    expect(screen.getByText('첨부된 화물이 없습니다')).toBeTruthy()
  })

  it('renders each attachment as a download link with its size and date', () => {
    render(<AttachmentsPanel issueId={7} attachments={[ATTACHMENT]} onChanged={() => {}} />)
    const link = screen.getByRole('link', { name: /배치로그\.png/ }) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/api/v1/attachments/1')
    expect(screen.getByText(/1\.5KB/)).toBeTruthy()
    expect(screen.getByText(/07-31/)).toBeTruthy()
  })

  it('uploads the selected file as FormData and calls onChanged on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(ATTACHMENT))
    vi.stubGlobal('fetch', fetchMock)
    const onChanged = vi.fn()
    render(<AttachmentsPanel issueId={7} attachments={[]} onChanged={onChanged} />)

    const file = new File(['hello'], 'note.txt', { type: 'text/plain' })
    fireEvent.change(screen.getByLabelText('파일 선택'), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: '업로드' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    const [path, init] = fetchMock.mock.calls[0]
    expect(path).toBe('/api/v1/issues/7/attachments')
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.body as FormData).get('file')).toBe(file)
    // The FormData seam in api(): no forced json content-type on this body.
    expect(init.headers['content-type']).toBeUndefined()
  })

  it('disables the file input and upload button while the request is pending, and re-enables after success', async () => {
    const gate = deferred<{ ok: boolean; status: number; json: () => Promise<unknown> }>()
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(gate.promise))
    render(<AttachmentsPanel issueId={7} attachments={[]} onChanged={() => {}} />)

    const file = new File(['hello'], 'note.txt', { type: 'text/plain' })
    fireEvent.change(screen.getByLabelText('파일 선택'), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: '업로드' }))

    await waitFor(() => expect(screen.getByLabelText('파일 선택')).toHaveProperty('disabled', true))
    expect(screen.getByRole('button', { name: '업로드' })).toHaveProperty('disabled', true)

    gate.resolve(ok(ATTACHMENT))

    // The file input re-enables so a new file can be picked. The upload
    // button stays disabled — the just-uploaded file was cleared on
    // success, so there is nothing left to submit until a new one is chosen.
    await waitFor(() => expect(screen.getByLabelText('파일 선택')).toHaveProperty('disabled', false))
    expect(screen.getByRole('button', { name: '업로드' })).toHaveProperty('disabled', true)
  })

  it('shows the server message and re-enables the control on a 413', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fail(413, '파일이 너무 큽니다 (최대 10MB)')))
    render(<AttachmentsPanel issueId={7} attachments={[]} onChanged={() => {}} />)

    const file = new File(['hello'], 'huge.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('파일 선택'), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: '업로드' }))

    expect(await screen.findByText('파일이 너무 큽니다 (최대 10MB)')).toBeTruthy()
    expect(screen.getByRole('button', { name: '업로드' })).toHaveProperty('disabled', false)
  })

  it('shows the server message on a 422 (unsupported type)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fail(422, '지원하지 않는 파일 형식입니다')))
    render(<AttachmentsPanel issueId={7} attachments={[]} onChanged={() => {}} />)

    const file = new File(['<svg/>'], 'icon.svg', { type: 'image/svg+xml' })
    fireEvent.change(screen.getByLabelText('파일 선택'), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: '업로드' }))

    expect(await screen.findByText('지원하지 않는 파일 형식입니다')).toBeTruthy()
  })
})
