'use client'

// Issue detail's relations panel + the topbar's '관계 추가' dialog. Split out
// of issues/[id]/page.tsx (Task 8) to keep that file under the line target —
// props are unchanged from their in-page shape.
import { useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { api, ApiError } from '@/ui/api'
import { RELATION_LABEL } from '@/ui/labels'
import type { ApiRelation } from '@/ui/types'

const RELATION_KINDS: Array<'duplicate' | 'relates' | 'blocks'> = ['duplicate', 'relates', 'blocks']

export function RelationsPanel({
  relations, isAdmin, pending, error, onRemove,
}: {
  relations: ApiRelation[]
  isAdmin: boolean
  pending: boolean
  error: string | null
  onRemove: (relationId: number) => void
}) {
  return (
    <section className="panel">
      <div className="panel__head">
        <h2 className="h-card">관계</h2>
        <span className="mono muted push">{relations.length}</span>
      </div>
      <div className="panel__body">
        {relations.map((r) => (
          <div className="rel" key={r.id}>
            <span className="rel__kind">{r.kind}</span>
            <Link className="rel__title" href={`/issues/${r.relatedIssueId}`}>
              #{r.relatedIssueId} {r.related?.title ?? ''}
            </Link>
            {isAdmin ? (
              <button type="button" className="btn btn--sm" disabled={pending} onClick={() => onRemove(r.id)}>해제</button>
            ) : null}
          </div>
        ))}
        {error ? <p className="hint">{error}</p> : null}
      </div>
    </section>
  )
}

// Self-contained per useTopbarActions' registration contract: `issueId`
// never changes after this page mounts, and `onAdded` (the page's refetch)
// stays correct even if its identity goes stale — every render's refetch
// closes over the same underlying setTick from useApi, so calling any past
// copy still triggers a real refetch.
export function RelationAddButton({ issueId, onAdded }: { issueId: number; onAdded: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [relatedId, setRelatedId] = useState('')
  const [kind, setKind] = useState<'duplicate' | 'relates' | 'blocks'>('relates')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function open() {
    setRelatedId('')
    setKind('relates')
    setError(null)
    dialogRef.current?.showModal()
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const relatedIssueId = Number(relatedId)
    if (!relatedIssueId || pending) return
    setPending(true)
    setError(null)
    try {
      await api(`/api/v1/issues/${issueId}/relations`, {
        method: 'POST',
        body: JSON.stringify({ relatedIssueId, kind }),
      })
      dialogRef.current?.close()
      onAdded()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '요청에 실패했습니다')
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <button className="btn btn--sm" type="button" onClick={open}>관계 추가</button>
      <dialog
        ref={dialogRef}
        aria-label="관계 추가"
        // Esc fires the dialog's cancel event, which closes it natively —
        // without this the modal vanishes while the request keeps running
        // and still commits, the same "취소 that commits" the buttons guard.
        onCancel={(e) => { if (pending) e.preventDefault() }}
      >
        <form className="stack" onSubmit={submit}>
          <h2 className="h-panel">관계 추가</h2>
          <div className="inline" style={{ gap: 'var(--s-3)', alignItems: 'flex-start' }}>
            <div className="field">
              <label className="label" htmlFor="rel-id">이슈 번호</label>
              <input
                id="rel-id"
                className="input"
                type="number"
                min={1}
                required
                value={relatedId}
                disabled={pending}
                onChange={(e) => setRelatedId(e.target.value)}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="rel-kind">관계</label>
              <div className="select-wrap">
                <select
                  id="rel-kind"
                  className="select"
                  value={kind}
                  disabled={pending}
                  onChange={(e) => setKind(e.target.value as typeof kind)}
                >
                  {RELATION_KINDS.map((k) => <option key={k} value={k}>{RELATION_LABEL[k]}</option>)}
                </select>
              </div>
            </div>
          </div>
          {error ? <p className="hint">{error}</p> : null}
          <div className="divider" />
          <div className="inline">
            <button type="button" className="btn btn--ghost" disabled={pending} onClick={() => dialogRef.current?.close()}>취소</button>
            <button type="submit" className="btn btn--primary push" disabled={!relatedId || pending}>추가</button>
          </div>
        </form>
      </dialog>
    </>
  )
}
