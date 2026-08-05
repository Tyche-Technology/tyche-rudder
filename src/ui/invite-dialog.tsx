'use client'

// The invite create/reissue dialog — native <dialog>, matching
// milestone-dialog.tsx/new-issue.tsx (design doc: no custom modal system).
// One instance serves both the crew page's '초대' button (blank form) and
// every row's '재발급' button (skips the form and POSTs immediately using
// the row's own email/name/role — see reissue()). POST /api/v1/invites
// returns the raw token exactly once; the dialog's whole job after a
// successful POST is making that unmistakable and impossible to lose before
// it's copied.
import { forwardRef, useImperativeHandle, useRef, useState, type FormEvent } from 'react'
import { api, ApiError } from './api'
import { fieldErrors } from './field-errors'

export type InviteDialogHandle = {
  openCreate: () => void
  // Fires the POST immediately — the row's email/name/role are already
  // known, there is nothing left for the admin to fill in.
  reissue: (user: { email: string; name: string; role: 'admin' | 'user' }) => void
}

type InviteResponse = { inviteUrl: string; userId: number; expiresAt: string }

export const InviteDialog = forwardRef<InviteDialogHandle, { onIssued: () => void }>(
  function InviteDialog({ onIssued }, ref) {
    const dialogRef = useRef<HTMLDialogElement>(null)
    const [email, setEmail] = useState('')
    const [name, setName] = useState('')
    const [role, setRole] = useState<'admin' | 'user'>('user')
    // Non-null once a POST has succeeded — switches the dialog body from
    // the form to the one-time link view. Reset to null on every open() so
    // a stale link from a previous invite can never show through. Carries
    // email/name alongside the url (not just the raw token) so the result
    // view can show whose link this is — without it, a reissue fired on one
    // row while another row's reissue is still in flight can display the
    // wrong person's link with nothing on screen to catch the mismatch.
    const [issued, setIssued] = useState<{ url: string; email: string; name: string } | null>(null)
    const [copied, setCopied] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [errors, setErrors] = useState<Record<string, string>>({})
    const [pending, setPending] = useState(false)

    async function issue(payload: { email: string; name: string; role: 'admin' | 'user' }) {
      setPending(true)
      setError(null)
      setErrors({})
      try {
        const data = await api<InviteResponse>('/api/v1/invites', { method: 'POST', body: JSON.stringify(payload) })
        setIssued({ url: data.inviteUrl, email: payload.email, name: payload.name })
        setCopied(false)
        onIssued()
      } catch (err) {
        setError(err instanceof ApiError ? err.message : '요청에 실패했습니다')
        setErrors(fieldErrors(err))
      } finally {
        setPending(false)
      }
    }

    useImperativeHandle(ref, () => ({
      openCreate() {
        setEmail('')
        setName('')
        setRole('user')
        setIssued(null)
        setCopied(false)
        setError(null)
        setErrors({})
        dialogRef.current?.showModal()
      },
      reissue(user) {
        setEmail(user.email)
        setName(user.name)
        setRole(user.role)
        setIssued(null)
        setCopied(false)
        setError(null)
        setErrors({})
        dialogRef.current?.showModal()
        void issue({ email: user.email, name: user.name, role: user.role })
      },
    }))

    async function submitCreate(e: FormEvent) {
      e.preventDefault()
      if (!email.trim() || !name.trim() || pending) return
      await issue({ email: email.trim(), name: name.trim(), role })
    }

    async function copyLink() {
      if (!issued) return
      try {
        await navigator.clipboard.writeText(issued.url)
        setCopied(true)
      } catch {
        // A clipboard permission block (some browser configs, or a
        // non-secure context) must not strand the admin — the link is
        // still selectable/copyable by hand from the readOnly input below.
        setError('복사에 실패했습니다. 링크를 직접 선택해 복사해주세요.')
      }
    }

    return (
      <dialog
        ref={dialogRef}
        // Distinct from the '초대 링크' <label> inside: getByLabelText also
        // matches a plain aria-label on any element (not just form
        // controls), so reusing that string here would make the dialog
        // itself a second match for the input's own label text.
        aria-label={issued ? '초대 결과' : '선원 초대'}
        // Esc must not lose the one-time link — mid-request (pending) so a
        // reissue's response doesn't land on an already-dismissed dialog,
        // and once the link is displayed (issued) so the raw token, which
        // lives only in this component's state, can't be dismissed by
        // accident. 복사/닫기 remain the only way out of that state.
        onCancel={(e) => { if (pending || issued) e.preventDefault() }}
      >
        {issued ? (
          <div className="stack">
            <h2 className="h-panel">{issued.name} ({issued.email})의 초대 링크가 생성되었습니다</h2>
            <div className="field">
              <label className="label" htmlFor="invite-link">초대 링크</label>
              <input id="invite-link" className="input mono" readOnly value={issued.url} />
            </div>
            <p className="hint">이 링크는 다시 표시되지 않습니다 · 7일 후 만료</p>
            {error ? <p className="hint">{error}</p> : null}
            <div className="divider" />
            <div className="inline">
              <button type="button" className="btn" onClick={copyLink}>{copied ? '복사됨' : '복사'}</button>
              <button
                type="button"
                className="btn btn--primary push"
                onClick={() => { dialogRef.current?.close(); setIssued(null) }}
              >
                닫기
              </button>
            </div>
          </div>
        ) : (
          <form className="stack" onSubmit={submitCreate}>
            <h2 className="h-panel">선원 초대</h2>
            <div className="field">
              <label className="label" htmlFor="inv-email">이메일</label>
              <input
                id="inv-email"
                type="email"
                className="input"
                required
                disabled={pending}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              {errors.email ? <span className="hint">{errors.email}</span> : null}
            </div>
            <div className="field">
              <label className="label" htmlFor="inv-name">이름</label>
              <input
                id="inv-name"
                className="input"
                required
                disabled={pending}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              {errors.name ? <span className="hint">{errors.name}</span> : null}
            </div>
            <div className="field">
              <label className="label" htmlFor="inv-role">역할</label>
              <div className="select-wrap">
                <select
                  id="inv-role"
                  className="select"
                  disabled={pending}
                  value={role}
                  onChange={(e) => setRole(e.target.value === 'admin' ? 'admin' : 'user')}
                >
                  <option value="user">일반</option>
                  <option value="admin">관리자</option>
                </select>
              </div>
              {errors.role ? <span className="hint">{errors.role}</span> : null}
            </div>
            {error ? <p className="hint">{error}</p> : null}
            <div className="divider" />
            <div className="inline">
              <button type="button" className="btn btn--ghost" disabled={pending} onClick={() => dialogRef.current?.close()}>취소</button>
              <button type="submit" className="btn btn--primary push" disabled={!email.trim() || !name.trim() || pending}>
                {pending ? '생성 중…' : '초대 생성'}
              </button>
            </div>
          </form>
        )}
      </dialog>
    )
  },
)
