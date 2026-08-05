// Small shared pieces with no state of their own — avatar initial, the one
// shared empty-state illustration (design §4), the compact waterline gauge.
import type { CSSProperties } from 'react'

// aria-hidden: always rendered next to the name it stands for, never alone.
export function Avatar({ name }: { name: string }) {
  return <span className="avatar" aria-hidden="true">{name.charAt(0)}</span>
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty">
      <span className="px-sea" aria-hidden="true" />
      <span className="empty__title">{title}</span>
      <span className="empty__body">{body}</span>
    </div>
  )
}

// Compact list-variant waterline (design §4 "gauge"). 100% turns the done
// colour — arrival is a result, not just a full bar.
export function Gauge({ fill }: { fill: number }) {
  const style = { '--fill': `${fill}%` } as CSSProperties
  return (
    <div className={`gauge${fill >= 100 ? ' gauge--arrived' : ''}`} style={style}>
      <div className="gauge__fill" />
    </div>
  )
}

// The one error+retry shape every mutation on the issue detail page uses. A
// 409 is always a stale-version conflict (server copy is CONFLICT_ERROR from
// domain/issues.ts) and always resolved the same way: reload and look again
// — every mutation re-reads the current row inside its own transaction, so
// the retry itself needs nothing but fresh state on screen.
export function ActionError({ message, conflict, onRetry }: { message: string; conflict: boolean; onRetry: () => void }) {
  return (
    <div className="inline">
      <p className="hint">{message}</p>
      {conflict ? <button type="button" className="btn btn--sm" onClick={onRetry}>새로고침</button> : null}
    </div>
  )
}

// Shared by Inbox's grooming panel and Task 7's issue detail page: 반송/정박
// both require a non-empty reason before the server accepts the transition
// (a blank one comes back 422). Fully controlled — the caller owns which
// action is active, the reason text, and what onConfirm actually does, so
// this component has no assumptions about where it's mounted.
export function ReasonField({
  action,
  reason,
  onReasonChange,
  onCancel,
  onConfirm,
  pending,
}: {
  action: '반송' | '정박'
  reason: string
  onReasonChange: (value: string) => void
  onCancel: () => void
  onConfirm: () => void
  pending: boolean
}) {
  return (
    <div className="stack stack--sm">
      <div className="field">
        <textarea
          className="textarea"
          disabled={pending}
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          placeholder="사유를 입력해주세요"
          aria-label={`${action} 사유`}
        />
        <span className="hint">반송·정박은 사유를 남겨야 저장됩니다.</span>
      </div>
      <div className="inline">
        <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={pending}>취소</button>
        {/* Label stays the action name, not '확정' — design doc §6: a label
            tracks the same action name across the whole flow. */}
        <button type="button" className="btn btn--danger" onClick={onConfirm} disabled={!reason.trim() || pending}>
          {action}
        </button>
      </div>
    </div>
  )
}
