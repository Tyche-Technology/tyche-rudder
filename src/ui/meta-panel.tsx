// Issue detail's right-column meta summary (status/priority/product/
// milestone/assignee/requester) plus the admin decision-button row. Split
// out of issues/[id]/page.tsx (Task 8) to keep that file under the line
// target — props are unchanged from their in-page shape, and every mutation
// (patch/transition) is still owned by the page, not this component.
import { PriorityTag, StatusChip, PilotFlag } from '@/ui/chips'
import { ReasonField, Avatar, ActionError } from '@/ui/bits'
import { assignableUsers } from '@/ui/catalog-data'
import type { ApiIssue, ApiMilestone, ApiProduct, ApiUser, IssueStatus, Priority } from '@/ui/types'

const PRIORITIES: Priority[] = ['p0', 'p1', 'p2']

type NextAction = { to: IssueStatus; label: string; needsReason: boolean; tone?: 'accent' | 'danger' }

// Mirrors src/domain/transitions.ts's TRANSITIONS table — duplicated here
// because src/ui/** cannot import src/domain/** (Architecture A). This table
// only decides which buttons are worth *offering*; the server's own 422
// ("... 전이는 허용되지 않습니다") stays the single authority on what's
// actually legal, so a drift here just surfaces as that message instead of
// a client-side block.
const NEXT_ACTIONS: Record<IssueStatus, NextAction[]> = {
  inbox: [
    { to: 'backlog', label: '선적 대기로', needsReason: false },
    { to: 'on_hold', label: '정박', needsReason: true },
    { to: 'rejected', label: '반송', needsReason: true, tone: 'danger' },
  ],
  backlog: [
    { to: 'in_progress', label: '항해 시작', needsReason: false, tone: 'accent' },
    { to: 'on_hold', label: '정박', needsReason: true },
    { to: 'rejected', label: '반송', needsReason: true, tone: 'danger' },
  ],
  in_progress: [
    { to: 'done', label: '배송 완료', needsReason: false, tone: 'accent' },
    { to: 'backlog', label: '선적 대기로', needsReason: false },
    { to: 'on_hold', label: '정박', needsReason: true },
  ],
  on_hold: [
    { to: 'backlog', label: '선적 대기로', needsReason: false },
    { to: 'rejected', label: '반송', needsReason: true, tone: 'danger' },
  ],
  done: [{ to: 'backlog', label: '선적 대기로', needsReason: false }],
  rejected: [],
}

function actionButtonClass(tone: NextAction['tone']): string {
  if (tone === 'accent') return 'btn btn--accent btn--sm'
  if (tone === 'danger') return 'btn btn--danger btn--sm'
  return 'btn btn--sm'
}

export function MetaPanel({
  issue, products, milestones, users, productName, milestoneName, assigneeName, requesterName,
  pilotCreated, backlogPos, backlogTotal, backlogLoading, backlogError, onBacklogRetry, isAdmin,
  onPatch, patchPending, patchError, patchConflict, onPatchRetry,
  reasonTarget, reason, onReasonChange, onReasonTarget,
  onTransition, transitionPending, transitionError, transitionConflict, onTransitionRetry,
}: {
  issue: ApiIssue
  products: ApiProduct[] | null
  milestones: ApiMilestone[] | null
  users: ApiUser[] | null
  productName: string | null
  milestoneName: string | null
  assigneeName: string | null
  requesterName: string | null
  pilotCreated: boolean
  backlogPos: number
  backlogTotal: number
  backlogLoading: boolean
  backlogError: string | null
  onBacklogRetry: () => void
  isAdmin: boolean
  onPatch: (body: Record<string, unknown>) => void
  patchPending: boolean
  patchError: string | null
  patchConflict: boolean
  onPatchRetry: () => void
  reasonTarget: 'rejected' | 'on_hold' | null
  reason: string
  onReasonChange: (v: string) => void
  onReasonTarget: (v: 'rejected' | 'on_hold' | null) => void
  onTransition: (to: IssueStatus, reason?: string) => void
  transitionPending: boolean
  transitionError: string | null
  transitionConflict: boolean
  onTransitionRetry: () => void
}) {
  return (
    <section className="panel">
      <div className="panel__body">
        <div className="meta">
          <div className="meta__row">
            <span className="meta__k">상태</span>
            <span className="meta__v"><StatusChip status={issue.status} /></span>
          </div>
          <div className="meta__row">
            <span className="meta__k">우선순위</span>
            <span className="meta__v">
              {isAdmin ? (
                <div className="seg" role="radiogroup" aria-label="우선순위">
                  {PRIORITIES.map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={p === 'p0' ? 'seg__b seg__b--p0' : 'seg__b'}
                      role="radio"
                      aria-checked={issue.priority === p}
                      disabled={patchPending}
                      onClick={() => onPatch({ priority: p })}
                    >
                      {p.toUpperCase()}
                    </button>
                  ))}
                </div>
              ) : <PriorityTag priority={issue.priority} />}
            </span>
          </div>
          <div className="meta__row">
            <span className="meta__k">제품</span>
            <span className="meta__v">
              {isAdmin ? (
                <div className="select-wrap">
                  <select
                    className="select"
                    aria-label="제품"
                    value={issue.productId}
                    disabled={patchPending || products === null}
                    onChange={(e) => onPatch({ productId: Number(e.target.value) })}
                  >
                    {(products ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              ) : (productName ?? '')}
            </span>
          </div>
          <div className="meta__row">
            <span className="meta__k">마일스톤</span>
            <span className="meta__v">
              {isAdmin ? (
                <div className="select-wrap">
                  <select
                    className="select"
                    aria-label="마일스톤"
                    value={issue.milestoneId ?? ''}
                    disabled={patchPending || milestones === null}
                    onChange={(e) => onPatch({ milestoneId: e.target.value === '' ? null : Number(e.target.value) })}
                  >
                    <option value="">미배정</option>
                    {(milestones ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
              ) : (milestoneName ?? '')}
            </span>
          </div>
          <div className="meta__row">
            <span className="meta__k">담당자</span>
            <span className="meta__v">
              {isAdmin ? (
                <div className="select-wrap">
                  <select
                    className="select"
                    aria-label="담당자"
                    value={issue.assigneeId ?? ''}
                    disabled={patchPending || users === null}
                    onChange={(e) => onPatch({ assigneeId: e.target.value === '' ? null : Number(e.target.value) })}
                  >
                    <option value="">미배정</option>
                    {assignableUsers(users, issue.assigneeId).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
              ) : issue.assigneeId === null ? '미배정' : assigneeName ? (
                <><Avatar name={assigneeName} />{assigneeName}</>
              ) : null}
            </span>
          </div>
          <div className="meta__row">
            <span className="meta__k">요청자</span>
            <span className="meta__v">
              {requesterName ? <><Avatar name={requesterName} />{requesterName}</> : null}
              {pilotCreated ? <PilotFlag /> : null}
            </span>
          </div>
          {issue.status === 'backlog' && backlogError ? (
            <div className="meta__row">
              <span className="meta__k">백로그 순서</span>
              <span className="meta__v">
                <span className="hint">{backlogError}</span>
                <button type="button" className="btn btn--sm" onClick={onBacklogRetry}>다시 시도</button>
              </span>
            </div>
          ) : null}
          {issue.status === 'backlog' && !backlogError && !backlogLoading && backlogPos !== -1 ? (
            <div className="meta__row">
              <span className="meta__k">백로그 순서</span>
              <span className="meta__v mono">{backlogPos + 1} / {backlogTotal}</span>
            </div>
          ) : null}
        </div>

        {patchError ? <ActionError message={patchError} conflict={patchConflict} onRetry={onPatchRetry} /> : null}

        {isAdmin ? (
          <>
            <div className="divider" style={{ margin: 'var(--s-4) 0' }} />
            {reasonTarget ? (
              <ReasonField
                action={reasonTarget === 'rejected' ? '반송' : '정박'}
                reason={reason}
                onReasonChange={onReasonChange}
                onCancel={() => { onReasonTarget(null); onReasonChange('') }}
                onConfirm={() => onTransition(reasonTarget, reason)}
                pending={transitionPending}
              />
            ) : (
              <div className="inline">
                {NEXT_ACTIONS[issue.status].map((a) => (
                  <button
                    key={a.to}
                    type="button"
                    className={actionButtonClass(a.tone)}
                    disabled={transitionPending}
                    onClick={() => (a.needsReason ? onReasonTarget(a.to === 'rejected' ? 'rejected' : 'on_hold') : onTransition(a.to))}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            )}
            {transitionError ? <ActionError message={transitionError} conflict={transitionConflict} onRetry={onTransitionRetry} /> : null}
          </>
        ) : null}
      </div>
    </section>
  )
}
