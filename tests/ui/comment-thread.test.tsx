// @vitest-environment jsdom
// Task 16: a 400 from POST /comments carries `issues: [{ path: 'body', ... }]`
// (commentSchema) — that message must render next to the composer textarea,
// not just the generic form-level line.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { CommentThread } from '@/ui/comment-thread'
import type { ApiComment, ApiIssue, ApiUser } from '@/ui/types'

const ISSUE: ApiIssue = {
  id: 1, title: '이슈', description: '', type: 'bug', productId: 1, status: 'inbox',
  priority: null, requesterId: 2, assigneeId: 3, milestoneId: null,
  sortOrder: null, reason: null, version: 1,
  createdAt: '2026-07-30T01:00:00.000Z', updatedAt: '2026-07-30T01:00:00.000Z',
}
const ME: ApiUser = { id: 2, email: 'me@tyche.test', name: '나', role: 'user', banned: false, slackUserId: null }
const ASSIGNEE: ApiUser = { id: 3, email: 'assignee@tyche.test', name: '담당', role: 'user', banned: false, slackUserId: null }
const OTHER: ApiUser = { id: 9, email: 'other@tyche.test', name: '제3자', role: 'user', banned: false, slackUserId: null }

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ ok: true, data }) })
const failParse = (error: string, issues: Array<{ path: string; message: string }>) => ({
  ok: false, status: 400, json: async () => ({ ok: false, error, issues }),
})

function comment(id: number, actorUserId: number | null, body: string): ApiComment {
  return { id, issueId: 1, actorType: 'user', actorUserId, actorTokenId: null, body, createdAt: '2026-07-30T01:00:00.000Z' }
}

describe('CommentThread — posting', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('posts the typed body, clears the composer, and calls onAdded on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(comment(1, 2, '새 댓글')))
    vi.stubGlobal('fetch', fetchMock)
    const onAdded = vi.fn()
    render(<CommentThread issue={ISSUE} comments={[]} users={[ME]} me={ME} onAdded={onAdded} />)

    const textarea = screen.getByLabelText('댓글 입력') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '새 댓글' } })
    fireEvent.click(screen.getByRole('button', { name: '댓글 남기기' }))

    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1))
    expect(textarea.value).toBe('')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/issues/1/comments',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ body: '새 댓글' }) }),
    )
  })

  it('disables the submit button for a blank or whitespace-only body', () => {
    render(<CommentThread issue={ISSUE} comments={[]} users={[ME]} me={ME} onAdded={() => {}} />)
    expect(screen.getByRole('button', { name: '댓글 남기기' })).toHaveProperty('disabled', true)

    fireEvent.change(screen.getByLabelText('댓글 입력'), { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: '댓글 남기기' })).toHaveProperty('disabled', true)
  })
})

describe('CommentThread — relation labels', () => {
  afterEach(cleanup)

  it("labels the requester's comment 요청자 and the assignee's comment 담당자, with no label for anyone else", () => {
    render(
      <CommentThread
        issue={ISSUE}
        comments={[comment(1, 2, '요청자 코멘트'), comment(2, 3, '담당자 코멘트'), comment(3, 9, '제3자 코멘트')]}
        users={[ME, ASSIGNEE, OTHER]}
        me={ME}
        onAdded={() => {}}
      />,
    )
    const requesterRow = screen.getByText('요청자 코멘트').closest('.cmt')!
    const assigneeRow = screen.getByText('담당자 코멘트').closest('.cmt')!
    const otherRow = screen.getByText('제3자 코멘트').closest('.cmt')!

    expect(requesterRow.querySelector('.cmt__role')?.textContent).toBe('요청자')
    expect(assigneeRow.querySelector('.cmt__role')?.textContent).toBe('담당자')
    expect(otherRow.querySelector('.cmt__role')).toBeNull()
  })
})

describe('CommentThread — surfaces field-level errors', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('renders the issues[].message for `body` next to the composer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      failParse('입력값이 올바르지 않습니다', [{ path: 'body', message: '댓글은 10000자 이하여야 합니다' }]),
    ))

    render(<CommentThread issue={ISSUE} comments={[]} users={[ME]} me={ME} onAdded={() => {}} />)

    fireEvent.change(screen.getByLabelText('댓글 입력'), { target: { value: '내용' } })
    fireEvent.click(screen.getByRole('button', { name: '댓글 남기기' }))

    await waitFor(() => expect(screen.getByText('댓글은 10000자 이하여야 합니다')).toBeTruthy())
    // The generic form-level line is still shown as the fallback.
    expect(screen.getByText('입력값이 올바르지 않습니다')).toBeTruthy()
  })
})
