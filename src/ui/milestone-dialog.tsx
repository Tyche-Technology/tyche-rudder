'use client'

// Milestone create/edit — native <dialog>, no custom modal system (design
// doc, src/ui/new-issue.tsx is the reference). One dialog instance serves
// both the topbar '마일스톤 추가' button and every panel's edit button:
// open(undefined) starts a blank create form, open(milestone) seeds an edit.
import { forwardRef, useImperativeHandle, useRef, useState, type FormEvent } from 'react'
import { api, ApiError } from './api'
import { fieldErrors } from './field-errors'
import type { ApiMilestone } from './types'

export type MilestoneDialogHandle = { open: (milestone?: ApiMilestone) => void }

// <input type="date"> wants "YYYY-MM-DD"; the wire already sends exactly
// that (or null for unset) — nothing to slice or convert anymore.
function toDateInput(iso: string | null): string {
  return iso ?? ''
}

export const MilestoneDialog = forwardRef<MilestoneDialogHandle, { onSaved: () => void }>(
  function MilestoneDialog({ onSaved }, ref) {
    const dialogRef = useRef<HTMLDialogElement>(null)
    const [editing, setEditing] = useState<ApiMilestone | null>(null)
    const [name, setName] = useState('')
    const [startsOn, setStartsOn] = useState('')
    const [endsOn, setEndsOn] = useState('')
    const [closed, setClosed] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [errors, setErrors] = useState<Record<string, string>>({})
    const [pending, setPending] = useState(false)
    // What the form looked like right after open() — PATCH diffs against
    // this, not against `editing`'s raw fields, so a field the user never
    // touched is left out of the request instead of being re-sent (stale
    // relative to a concurrent edit) as if it had just changed.
    const snapshotRef = useRef({ name: '', startsOn: '', endsOn: '', closed: false })

    useImperativeHandle(ref, () => ({
      open(milestone) {
        const snapshot = {
          name: milestone?.name ?? '',
          startsOn: toDateInput(milestone?.startsOn ?? null),
          endsOn: toDateInput(milestone?.endsOn ?? null),
          closed: milestone?.closed ?? false,
        }
        setEditing(milestone ?? null)
        setName(snapshot.name)
        setStartsOn(snapshot.startsOn)
        setEndsOn(snapshot.endsOn)
        setClosed(snapshot.closed)
        snapshotRef.current = snapshot
        setError(null)
        setErrors({})
        dialogRef.current?.showModal()
      },
    }))

    async function submit(e: FormEvent) {
      e.preventDefault()
      if (!name.trim() || pending) return
      setPending(true)
      setError(null)
      setErrors({})
      try {
        if (editing) {
          // Only the fields that actually changed from open-time go in the
          // PATCH — an untouched field must never overwrite a concurrent
          // edit with the stale value this form opened with. A changed date
          // field still sends an explicit null when emptied (WYSIWYG:
          // clearing the input means clearing the date), unlike Inbox's
          // assignee/milestone picks where "no selection" means "don't
          // touch" from the start.
          const snap = snapshotRef.current
          const patch: { name?: string; startsOn?: string | null; endsOn?: string | null; closed?: boolean; expectedVersion: number } =
            { expectedVersion: editing.version }
          if (name !== snap.name) patch.name = name
          if (startsOn !== snap.startsOn) patch.startsOn = startsOn || null
          if (endsOn !== snap.endsOn) patch.endsOn = endsOn || null
          if (closed !== snap.closed) patch.closed = closed
          await api(`/api/v1/milestones/${editing.id}`, { method: 'PATCH', body: JSON.stringify(patch) })
        } else {
          // create rejects an explicit null date (schema difference from
          // PATCH) — omit rather than send one for a blank input.
          await api('/api/v1/milestones', {
            method: 'POST',
            body: JSON.stringify({
              name,
              ...(startsOn ? { startsOn } : {}),
              ...(endsOn ? { endsOn } : {}),
            }),
          })
        }
        dialogRef.current?.close()
        onSaved()
      } catch (err) {
        setError(err instanceof ApiError ? err.message : '요청에 실패했습니다')
        setErrors(fieldErrors(err))
      } finally {
        setPending(false)
      }
    }

    return (
      <dialog
        ref={dialogRef}
        aria-label={editing ? '마일스톤 수정' : '마일스톤 추가'}
        // Esc fires the dialog's cancel event, which closes it natively —
        // without this the modal vanishes while the request keeps running
        // and still commits, the same "취소 that commits" the buttons guard.
        onCancel={(e) => { if (pending) e.preventDefault() }}
      >
        <form className="stack" onSubmit={submit}>
          <h2 className="h-panel">{editing ? '마일스톤 수정' : '마일스톤 추가'}</h2>
          <div className="field">
            <label className="label" htmlFor="ms-name">이름</label>
            <input
              id="ms-name"
              className="input"
              required
              value={name}
              disabled={pending}
              onChange={(e) => setName(e.target.value)}
            />
            {errors.name ? <span className="hint">{errors.name}</span> : null}
          </div>
          <div className="inline" style={{ gap: 'var(--s-3)' }}>
            <div className="field" style={{ flex: 1 }}>
              <label className="label" htmlFor="ms-start">시작일</label>
              <input
                id="ms-start"
                className="input"
                type="date"
                value={startsOn}
                disabled={pending}
                onChange={(e) => setStartsOn(e.target.value)}
              />
              {errors.startsOn ? <span className="hint">{errors.startsOn}</span> : null}
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label className="label" htmlFor="ms-end">종료일</label>
              <input
                id="ms-end"
                className="input"
                type="date"
                value={endsOn}
                disabled={pending}
                onChange={(e) => setEndsOn(e.target.value)}
              />
              {errors.endsOn ? <span className="hint">{errors.endsOn}</span> : null}
            </div>
          </div>
          {editing ? (
            <label className="inline" style={{ gap: 'var(--s-2)' }}>
              <input
                type="checkbox"
                checked={closed}
                disabled={pending}
                onChange={(e) => setClosed(e.target.checked)}
              />
              마감 처리
            </label>
          ) : null}
          {error ? <p className="hint">{error}</p> : null}
          <div className="divider" />
          <div className="inline">
            <button type="button" className="btn btn--ghost" disabled={pending} onClick={() => dialogRef.current?.close()}>취소</button>
            <button type="submit" className="btn btn--primary push" disabled={!name.trim() || pending}>
              {pending ? '저장 중…' : '저장'}
            </button>
          </div>
        </form>
      </dialog>
    )
  },
)
