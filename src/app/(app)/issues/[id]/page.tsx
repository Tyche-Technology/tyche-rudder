'use client'

// Issue detail (design/05-issue.html). Not a nav page (pageFromPathname
// returns null for this segment) — this page owns its own heading and the
// topbar only carries the '관계 추가' action.
import { useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useApi, api, ApiError } from '@/ui/api'
import { useMe, useTopbarActions } from '@/ui/shell'
import { useProducts, useUsers, useMilestones, nameOf } from '@/ui/catalog-data'
import { StatusChip, PriorityTag, TypeTag } from '@/ui/chips'
import { ActionError } from '@/ui/bits'
import { formatDateTime } from '@/ui/format'
import { HistoryPanel } from '@/ui/history'
import { CommentThread } from '@/ui/comment-thread'
import { MetaPanel } from '@/ui/meta-panel'
import { RelationsPanel, RelationAddButton } from '@/ui/relations-panel'
import { AttachmentsPanel } from '@/ui/attachments-panel'
import type { ApiIssue, ApiIssueDetail, IssueStatus } from '@/ui/types'

// Same canonical-decimal-digits rule as respond.ts's parsePgId / validation.ts's
// pgId, bounded to Postgres's integer range. Number(params.id) alone would also
// accept "0x10", "1e2", or "007" — non-canonical strings that still parse to a
// real id, so /issues/0x10 would silently load issue 16.
const PG_INT_MAX = 2_147_483_647

export default function IssueDetailPage() {
  const params = useParams<{ id: string }>()
  const rawId = params.id
  const validId = /^[1-9]\d*$/.test(rawId) && Number(rawId) <= PG_INT_MAX
  const id = validId ? Number(rawId) : NaN
  const me = useMe()
  const isAdmin = me.role === 'admin'

  const { data: detail, error, loading, refetch } = useApi<ApiIssueDetail>(validId ? `/api/v1/issues/${id}` : null)
  const { products, error: productsError, refetch: refetchProducts } = useProducts()
  const { users, error: usersError, refetch: refetchUsers } = useUsers()
  const { milestones, error: milestonesError, refetch: refetchMilestones } = useMilestones()
  const backlogPath = detail?.issue.status === 'backlog' ? '/api/v1/issues?status=backlog' : null
  // useApi retains stale `data` across a path transition (by design, for
  // paths that stay the same) — leaving and re-entering backlog can leave an
  // old list sitting in `backlogList` while a fresh fetch is in flight, or
  // forever if that fetch fails. loading/error must gate the row, not just
  // `backlogList !== null`.
  const { data: backlogList, error: backlogError, loading: backlogLoading, refetch: refetchBacklog } = useApi<ApiIssue[]>(backlogPath)

  useTopbarActions(isAdmin && validId ? <RelationAddButton issueId={id} onAdded={refetch} /> : null)

  // The newest version any mutation on THIS page has actually seen back from
  // the server. refetch() is async, so two quick edits in a row (e.g. set
  // priority, then immediately edit the title) would otherwise both read the
  // same stale rendered issue.version and the second manufactures a spurious
  // 409 against the user's own first edit. Every mutation below composes its
  // request with Math.max(issue.version, versionRef.current) and bumps the
  // ref from its own response — a refetch landing later only ever raises
  // issue.version to match, never regresses this, so no reset logic is
  // needed. Shared across patchIssue/transition and the title/description
  // components (passed down as the ref itself) since any one of them can be
  // the "first" edit the others must not collide with.
  const versionRef = useRef(0)

  const [patchPending, setPatchPending] = useState(false)
  const [patchError, setPatchError] = useState<string | null>(null)
  const [patchConflict, setPatchConflict] = useState(false)

  async function patchIssue(body: Record<string, unknown>) {
    setPatchPending(true)
    setPatchError(null)
    setPatchConflict(false)
    try {
      const updated = await api<ApiIssue>(`/api/v1/issues/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...body, expectedVersion: Math.max(issue.version, versionRef.current) }),
      })
      versionRef.current = Math.max(versionRef.current, updated.version)
      refetch()
    } catch (err) {
      setPatchError(err instanceof ApiError ? err.message : '요청에 실패했습니다')
      setPatchConflict(err instanceof ApiError && err.status === 409)
    } finally {
      setPatchPending(false)
    }
  }

  const [reasonTarget, setReasonTarget] = useState<'rejected' | 'on_hold' | null>(null)
  const [reason, setReason] = useState('')
  const [transitionPending, setTransitionPending] = useState(false)
  const [transitionError, setTransitionError] = useState<string | null>(null)
  const [transitionConflict, setTransitionConflict] = useState(false)

  async function transition(to: IssueStatus, transitionReason?: string) {
    setTransitionPending(true)
    setTransitionError(null)
    setTransitionConflict(false)
    try {
      const updated = await api<ApiIssue>(`/api/v1/issues/${id}/transition`, {
        method: 'POST',
        body: JSON.stringify({
          ...(transitionReason !== undefined ? { to, reason: transitionReason } : { to }),
          expectedVersion: Math.max(issue.version, versionRef.current),
        }),
      })
      versionRef.current = Math.max(versionRef.current, updated.version)
      setReasonTarget(null)
      setReason('')
      refetch()
    } catch (err) {
      setTransitionError(err instanceof ApiError ? err.message : '요청에 실패했습니다')
      setTransitionConflict(err instanceof ApiError && err.status === 409)
    } finally {
      setTransitionPending(false)
    }
  }

  const [relationsError, setRelationsError] = useState<string | null>(null)
  const [relationsPending, setRelationsPending] = useState(false)

  async function removeRelation(relationId: number) {
    setRelationsPending(true)
    setRelationsError(null)
    try {
      await api(`/api/v1/issues/${id}/relations?relationId=${relationId}`, { method: 'DELETE' })
      refetch()
    } catch (err) {
      setRelationsError(err instanceof ApiError ? err.message : '요청에 실패했습니다')
    } finally {
      setRelationsPending(false)
    }
  }

  // A 404 is not retryable — the id is either invalid or the row is gone
  // either way. No 다시 시도, just a way back. (The topbar 관계 추가 button may
  // still be registered here per useTopbarActions' once-per-mount contract —
  // parked: it 404s honestly server-side if used.)
  if (!validId || error?.status === 404) {
    return (
      <div className="empty">
        <span className="empty__title">이슈를 찾을 수 없습니다</span>
        <span className="empty__body">주소를 다시 확인해주세요.</span>
        <Link className="btn btn--sm" href="/inbox">입항 대기로</Link>
      </div>
    )
  }
  if (error) {
    return (
      <div className="empty">
        <span className="empty__title">불러오지 못했습니다</span>
        <span className="empty__body">{error.message}</span>
        <button className="btn btn--sm" type="button" onClick={refetch}>다시 시도</button>
      </div>
    )
  }
  if (loading || detail === null) return null

  const { issue, comments, events, relations, attachments } = detail
  const productName = nameOf(products, issue.productId)
  const milestoneName = nameOf(milestones, issue.milestoneId)
  const assigneeName = nameOf(users, issue.assigneeId)
  const requesterName = nameOf(users, issue.requesterId)
  const pilotCreated = events[0]?.field === 'created' && events[0]?.actorType === 'agent'
  const backlogPos = backlogList ? backlogList.findIndex((i) => i.id === issue.id) : -1
  const canEdit = isAdmin || me.id === issue.requesterId

  return (
    <>
      {productsError || milestonesError || usersError ? (
        <div className="inline" style={{ marginBottom: 'var(--s-4)' }}>
          <p className="hint">제품·마일스톤·담당자 정보를 불러오지 못했습니다. 일부 이름이나 선택지가 비어 보일 수 있습니다.</p>
          <button
            className="btn btn--sm"
            type="button"
            onClick={() => {
              if (productsError) refetchProducts()
              if (milestonesError) refetchMilestones()
              if (usersError) refetchUsers()
            }}
          >
            다시 시도
          </button>
        </div>
      ) : null}

      <div className="inline" style={{ marginBottom: 'var(--s-2)' }}>
        <StatusChip status={issue.status} />
        <PriorityTag priority={issue.priority} />
        <TypeTag type={issue.type} />
        <span className="mono faint">{productName ?? ''}{milestoneName ? ` · ${milestoneName}` : ''}</span>
      </div>

      <IssueTitle issue={issue} canEdit={canEdit} onSaved={refetch} versionRef={versionRef} />

      <p className="view__lede">
        <span className="mono">#{issue.id}</span>
        {requesterName ? ` · ${requesterName}이 요청` : ''}
        {pilotCreated ? ' · 도선사(슬랙 봇)가 등록' : ''} · {formatDateTime(issue.createdAt)} 등록 ·{' '}
        <span className="mono">v{issue.version}</span>
      </p>

      <div className="split">
        <div className="stack">
          <section className="panel">
            <div className="panel__head"><h2 className="h-card">설명</h2></div>
            <div className="panel__body">
              <IssueDescription issue={issue} canEdit={canEdit} onSaved={refetch} versionRef={versionRef} />
            </div>
          </section>

          <AttachmentsPanel issueId={issue.id} attachments={attachments} onChanged={refetch} />

          <section className="panel">
            <div className="panel__head">
              <h2 className="h-card">댓글</h2>
              <span className="mono muted push">{comments.length}</span>
            </div>
            <div className="panel__body">
              <CommentThread issue={issue} comments={comments} users={users} me={me} onAdded={refetch} />
            </div>
          </section>
        </div>

        <aside className="stack">
          <MetaPanel
            issue={issue}
            products={products}
            milestones={milestones}
            users={users}
            productName={productName}
            milestoneName={milestoneName}
            assigneeName={assigneeName}
            requesterName={requesterName}
            pilotCreated={pilotCreated}
            backlogPos={backlogPos}
            backlogTotal={backlogList?.length ?? 0}
            backlogLoading={backlogLoading}
            backlogError={backlogError?.message ?? null}
            onBacklogRetry={refetchBacklog}
            isAdmin={isAdmin}
            onPatch={patchIssue}
            patchPending={patchPending}
            patchError={patchError}
            patchConflict={patchConflict}
            onPatchRetry={() => { setPatchError(null); setPatchConflict(false); refetch() }}
            reasonTarget={reasonTarget}
            reason={reason}
            onReasonChange={setReason}
            onReasonTarget={setReasonTarget}
            onTransition={transition}
            transitionPending={transitionPending}
            transitionError={transitionError}
            transitionConflict={transitionConflict}
            onTransitionRetry={() => { setTransitionError(null); setTransitionConflict(false); refetch() }}
          />

          <RelationsPanel
            relations={relations}
            isAdmin={isAdmin}
            pending={relationsPending}
            error={relationsError}
            onRemove={removeRelation}
          />

          <section className="panel">
            <div className="panel__head"><h2 className="h-card">히스토리</h2></div>
            <div className="panel__body">
              <HistoryPanel events={events} users={users} />
            </div>
          </section>
        </aside>
      </div>
    </>
  )
}

function IssueTitle({
  issue, canEdit, onSaved, versionRef,
}: { issue: ApiIssue; canEdit: boolean; onSaved: () => void; versionRef: { current: number } }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(issue.title)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)

  async function save() {
    if (!draft.trim() || pending) return
    setPending(true)
    setError(null)
    setConflict(false)
    try {
      const updated = await api<ApiIssue>(`/api/v1/issues/${issue.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: draft.trim(), expectedVersion: Math.max(issue.version, versionRef.current) }),
      })
      versionRef.current = Math.max(versionRef.current, updated.version)
      setEditing(false)
      onSaved()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '요청에 실패했습니다')
      setConflict(err instanceof ApiError && err.status === 409)
    } finally {
      setPending(false)
    }
  }

  if (!editing) {
    return (
      <h1 className="h-view" style={{ maxWidth: '62ch', marginBottom: 'var(--s-2)' }}>
        {issue.title}
        {canEdit ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            aria-label="제목 수정"
            style={{ marginLeft: 'var(--s-2)' }}
            onClick={() => { setDraft(issue.title); setError(null); setEditing(true) }}
          >
            ✎
          </button>
        ) : null}
      </h1>
    )
  }

  return (
    <div className="field" style={{ maxWidth: '62ch', marginBottom: 'var(--s-2)' }}>
      <input className="input" aria-label="제목" value={draft} disabled={pending} onChange={(e) => setDraft(e.target.value)} />
      <div className="inline">
        <button type="button" className="btn btn--ghost" disabled={pending} onClick={() => setEditing(false)}>취소</button>
        <button type="button" className="btn btn--primary" disabled={!draft.trim() || pending} onClick={save}>저장</button>
      </div>
      {error ? <ActionError message={error} conflict={conflict} onRetry={onSaved} /> : null}
    </div>
  )
}

function IssueDescription({
  issue, canEdit, onSaved, versionRef,
}: { issue: ApiIssue; canEdit: boolean; onSaved: () => void; versionRef: { current: number } }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(issue.description)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)

  async function save() {
    if (pending) return
    setPending(true)
    setError(null)
    setConflict(false)
    try {
      const updated = await api<ApiIssue>(`/api/v1/issues/${issue.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ description: draft, expectedVersion: Math.max(issue.version, versionRef.current) }),
      })
      versionRef.current = Math.max(versionRef.current, updated.version)
      setEditing(false)
      onSaved()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '요청에 실패했습니다')
      setConflict(err instanceof ApiError && err.status === 409)
    } finally {
      setPending(false)
    }
  }

  if (!editing) {
    return (
      <>
        {issue.description ? (
          <p className="prose" style={{ whiteSpace: 'pre-wrap' }}>{issue.description}</p>
        ) : (
          <p className="hint">설명이 없습니다.</p>
        )}
        {canEdit ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => { setDraft(issue.description); setError(null); setEditing(true) }}
          >
            ✎ 수정
          </button>
        ) : null}
      </>
    )
  }

  return (
    <div className="field">
      <textarea className="textarea" value={draft} disabled={pending} onChange={(e) => setDraft(e.target.value)} />
      <div className="inline">
        <button type="button" className="btn btn--ghost" disabled={pending} onClick={() => setEditing(false)}>취소</button>
        <button type="button" className="btn btn--primary" disabled={pending} onClick={save}>저장</button>
      </div>
      {error ? <ActionError message={error} conflict={conflict} onRetry={onSaved} /> : null}
    </div>
  )
}
