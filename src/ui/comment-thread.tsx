'use client'

// Comment thread + composer for the issue detail view (design doc §4 .cmt /
// .thread). Agent comments never appear — comments/route.ts forbids them —
// so actorDisplayName's agent branch is unreachable here in practice, kept
// only because ApiComment's type still allows it.
import { useState, type FormEvent } from 'react'
import { api, ApiError } from './api'
import { fieldErrors } from './field-errors'
import { Avatar } from './bits'
import { formatDateTime } from './format'
import { actorDisplayName } from './history'
import type { ApiComment, ApiIssue, ApiUser } from './types'

// '요청자'/'담당자' is this issue's relation to the commenter, not a global
// department — the mockup's "운영 · 요청자" department half has no backing
// data (ApiUser carries no department), so it's dropped rather than
// fabricated.
function relationLabel(issue: ApiIssue, actorUserId: number | null): string | null {
  if (actorUserId === null) return null
  if (actorUserId === issue.requesterId) return '요청자'
  if (actorUserId === issue.assigneeId) return '담당자'
  return null
}

export function CommentThread({
  issue, comments, users, me, onAdded,
}: {
  issue: ApiIssue
  comments: ApiComment[]
  users: ApiUser[] | null
  me: ApiUser
  onAdded: () => void
}) {
  const [body, setBody] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!body.trim() || pending) return
    setPending(true)
    setError(null)
    setErrors({})
    try {
      await api(`/api/v1/issues/${issue.id}/comments`, { method: 'POST', body: JSON.stringify({ body }) })
      setBody('')
      onAdded()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '요청에 실패했습니다')
      setErrors(fieldErrors(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <div className="thread">
        {comments.map((c) => {
          const who = actorDisplayName(c.actorType, c.actorUserId, users)
          const role = relationLabel(issue, c.actorUserId)
          return (
            <div className="cmt" key={c.id}>
              <Avatar name={who} />
              <div>
                <div className="cmt__head">
                  <span className="cmt__who">{who}</span>
                  {role ? <span className="cmt__role">{role}</span> : null}
                  <span className="mono faint push">{formatDateTime(c.createdAt)}</span>
                </div>
                <div className="cmt__body">{c.body}</div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="divider" style={{ margin: 'var(--s-5) 0 var(--s-4)' }} />

      <form className="cmt" onSubmit={submit}>
        <Avatar name={me.name} />
        <div className="stack stack--sm" style={{ display: 'flex', flexDirection: 'column' }}>
          <textarea
            className="textarea"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="댓글을 남기면 요청자에게 슬랙으로 전달됩니다."
            aria-label="댓글 입력"
            disabled={pending}
          />
          {errors.body ? <p className="hint">{errors.body}</p> : null}
          <div className="inline">
            {error ? <p className="hint">{error}</p> : null}
            <span className="push">
              <button type="submit" className="btn btn--primary btn--sm" disabled={!body.trim() || pending}>
                댓글 남기기
              </button>
            </span>
          </div>
        </div>
      </form>
    </>
  )
}
