'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useApi, api, ApiError } from '@/ui/api'
import { useMe, useTopbarActions } from '@/ui/shell'
import { NewIssueButton } from '@/ui/new-issue'
import { useProducts, useUsers, useMilestones, nameOf, assignableUsers } from '@/ui/catalog-data'
import { countByProduct } from '@/ui/inbox-filters'
import { StatusChip, TypeTag } from '@/ui/chips'
import { shortDate } from '@/ui/format'
import { EmptyState, ReasonField } from '@/ui/bits'
import type { ApiIssue, ApiIssueDetail, ApiMilestone, ApiUser, Priority } from '@/ui/types'

const PRIORITIES: Priority[] = ['p0', 'p1', 'p2']

// Shown for the whole committed state, never only after a click: closing a
// committed panel refetches the row away (see InboxPage's effect), and the
// issue is safely in backlog either way — but an unsaved 담당자·마일스톤 pick
// goes with it, so the admin has to be told before choosing 닫기.
const CLOSE_WARNING = '닫으면 저장되지 않은 담당자·마일스톤 지정은 사라집니다.'

export default function InboxPage() {
  useTopbarActions(<NewIssueButton />)
  const me = useMe()
  const { data: issues, error, loading, refetch } = useApi<ApiIssue[]>('/api/v1/issues?status=inbox')
  const { products, error: productsError, refetch: refetchProducts } = useProducts()
  const { milestones, error: milestonesError, refetch: refetchMilestones } = useMilestones()
  const { users, error: usersError, refetch: refetchUsers } = useUsers()
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  // Which issues have had their POST .../transition commit during this page's
  // lifetime, and the version each one committed to. Lives here, not in
  // GroomingPanel: the panel unmounts every time its row closes, and a
  // committed-ness (or the version that came with it) that dies with the
  // panel lets the admin reopen a row the server has already moved out of
  // inbox and re-run 통관 (backlog -> backlog, 422) or 반송 in the wrong
  // context — or (Task 9) retry the assignment PATCH with the stale
  // pre-transition version, since GroomingPanel's own committedVersionRef
  // resets to null on every remount. Keyed by issue id so the version
  // survives exactly as long as the commit-ness does.
  const [committedVersions, setCommittedVersions] = useState<Map<number, number>>(new Map())

  // Drops a row the server has already moved to backlog, for every commit that
  // was known before its panel closed. Keyed off openId rather than any row's
  // own click handler, because a committed panel stops being open in more ways
  // than 닫기: switching to another row runs *that* row's onToggle, never this
  // one's. Uncommitted panels changed nothing, so they never refetch — and a
  // commit that arrives *after* its panel closed is invisible here (the openId
  // transition was consumed while the id was still uncommitted), so onCommitted
  // below owns that half.
  //
  // ponytail: the product filter is deliberately NOT covered — it unmounts the
  // row without touching openId, so switching the filter back restores the
  // same panel still in committed mode. The count staying stale until the next
  // refetch is display-only residual, chosen over refetching on every chip
  // click.
  const prevOpenIdRef = useRef<number | null>(null)
  useEffect(() => {
    const prev = prevOpenIdRef.current
    if (prev !== null && prev !== openId && committedVersions.has(prev)) refetch()
    prevOpenIdRef.current = openId
    // refetch's identity changes every render; openId/committedVersions are
    // the real triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, committedVersions])

  // What onCommitted reads to tell "still open" from "already closed" — its own
  // closure can't, having been built in a render where the panel was open by
  // definition. useLayoutEffect, not useEffect: layout effects flush inside the
  // commit phase, so no fetch continuation can resume between the render and
  // the sync and read a stale id.
  const openIdRef = useRef<number | null>(null)
  useLayoutEffect(() => { openIdRef.current = openId }, [openId])

  if (error) {
    return (
      <div className="empty">
        <span className="empty__title">불러오지 못했습니다</span>
        <span className="empty__body">{error.message}</span>
        <button className="btn btn--sm" type="button" onClick={refetch}>다시 시도</button>
      </div>
    )
  }
  if (loading || issues === null) return null

  if (issues.length === 0) {
    return (
      <EmptyState
        title="입항 대기 중인 화물이 없습니다"
        body="오늘 바다는 잔잔하네요 ⚓ 새 요청이 들어오면 여기 먼저 도착합니다."
      />
    )
  }

  const counts = countByProduct(issues)
  const productChips = (products ?? [])
    .filter((p) => counts.has(p.id))
    .map((p) => ({ id: p.id, name: p.name, count: counts.get(p.id)! }))
  const filteredIssues = selectedProductId === null
    ? issues
    : issues.filter((i) => i.productId === selectedProductId)

  return (
    <>
      <div className="view__head">
        <h2 className="h-view">통관을 기다리는 화물 {filteredIssues.length}건</h2>
      </div>
      <p className="view__lede">
        슬랙·웹·도선사(봇)로 들어온 요청이 먼저 여기 도착합니다. 통관하면 우선순위가 붙고
        선적 대기로 넘어갑니다. 통관 전에는 색이 없습니다 — 아직 아무 결정도 내려지지 않았다는 뜻입니다.
      </p>

      {/* Catalog failure annotates, never blocks: the issues list is
          independently useful for triage (title/type/date are all local to
          it), so a /products, /users or /milestones failure surfaces as this
          banner while rows render with blank names — not as a dead page.
          Tasks 7-10 inherit this pattern. Retry hits only the failed
          fetches. */}
      {productsError || milestonesError || usersError ? (
        <div className="inline" style={{ marginBottom: 'var(--s-4)' }}>
          <p className="hint">제품·마일스톤·담당자 정보를 불러오지 못했습니다. 목록은 표시되지만 일부 이름이나 선택지가 비어 보일 수 있습니다.</p>
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

      <div className="filters" style={{ marginBottom: 'var(--s-4)' }}>
        <button
          className="fchip"
          type="button"
          aria-pressed={selectedProductId === null}
          onClick={() => setSelectedProductId(null)}
        >
          전체<span className="fchip__n">{issues.length}</span>
        </button>
        {productChips.map((p) => (
          <button
            key={p.id}
            className="fchip"
            type="button"
            aria-pressed={selectedProductId === p.id}
            onClick={() => setSelectedProductId(p.id)}
          >
            {p.name}<span className="fchip__n">{p.count}</span>
          </button>
        ))}
      </div>

      <div className="panel">
        <div className="panel__head">
          <StatusChip status="inbox" />
          <span className="mono muted push">접수 순</span>
        </div>
        <div className="rows">
          {filteredIssues.map((issue) => (
            <InboxRow
              key={issue.id}
              issue={issue}
              productName={nameOf(products, issue.productId)}
              requesterName={nameOf(users, issue.requesterId)}
              milestones={milestones}
              users={users}
              isAdmin={me.role === 'admin'}
              open={openId === issue.id}
              committedVersion={committedVersions.get(issue.id)}
              onToggle={() => setOpenId((cur) => (cur === issue.id ? null : issue.id))}
              onCommitted={(version) => {
                setCommittedVersions((prev) => new Map(prev).set(issue.id, version))
                // Committed after its own panel had already closed (닫기 or a
                // switch-row while the POST was in flight): the effect above
                // can't see it, so the stale row gets dropped here instead.
                // Decided now, against the live openId, so a panel that was
                // closed without ever submitting can never queue a refetch that
                // lands on top of a later, legitimately open panel. Reopening
                // the *same* row before its POST resolves is the one case that
                // takes neither branch: no refetch (the panel is open, and
                // blanking it is the harm this guards), and the panel flips
                // into committed mode in place — which is the truth.
                if (openIdRef.current !== issue.id) refetch()
              }}
              // Just closes — the effect above owns every refetch, so the
              // clean path still ends in one (onCommitted, then openId → null).
              // Only closes *this* row: a transition that resolves after its
              // own panel was closed would otherwise shut whichever row the
              // admin opened in the meantime.
              onDone={() => setOpenId((cur) => (cur === issue.id ? null : cur))}
              onRefresh={refetch}
            />
          ))}
        </div>
      </div>
    </>
  )
}

function InboxRow({
  issue, productName, requesterName, milestones, users, isAdmin, open, committedVersion,
  onToggle, onCommitted, onDone, onRefresh,
}: {
  issue: ApiIssue
  // null = catalog still loading, not a real miss (nameOf) — render blank,
  // never '미배정', or a mid-load row would falsely claim "unassigned".
  productName: string | null
  requesterName: string | null
  milestones: ApiMilestone[] | null
  users: ApiUser[] | null
  isAdmin: boolean
  open: boolean
  // undefined = never committed this page lifetime. Defined = the version
  // POST .../transition committed to — see InboxPage's committedVersions for
  // why this outlives GroomingPanel's own remounts.
  committedVersion: number | undefined
  onToggle: () => void
  onCommitted: (version: number) => void
  onDone: () => void
  onRefresh: () => void
}) {
  return (
    <>
      <div className={open ? 'row row--open' : 'row'} onClick={isAdmin ? onToggle : undefined}>
        <span className="id">#{issue.id}</span>
        <span className="row__title">{issue.title}</span>
        <TypeTag type={issue.type} />
        <span className="mono faint">{productName ?? ''}</span>
        {/* PilotFlag intentionally omitted here — the list endpoint doesn't
            carry the requester's actor type, and an N+1 detail fetch per
            row just to show it isn't worth it; it lives on the detail view
            (Task 7). ponytail: revisit if the list ever returns actor type. */}
        <span className="mono">{requesterName ?? ''}</span>
        <span className="row__when mono">{shortDate(issue.createdAt)}</span>
        {isAdmin ? (
          <button
            className="btn btn--sm"
            type="button"
            aria-expanded={open}
            onClick={(e) => { e.stopPropagation(); onToggle() }}
          >
            {open ? '닫기' : '통관'}
          </button>
        ) : null}
      </div>
      {isAdmin && open ? (
        <GroomingPanel
          issue={issue}
          milestones={milestones}
          users={users}
          committedVersion={committedVersion}
          onCommitted={onCommitted}
          onDone={onDone}
          onRefresh={onRefresh}
        />
      ) : null}
    </>
  )
}

function GroomingPanel({
  issue, milestones, users, committedVersion, onCommitted, onDone, onRefresh,
}: {
  issue: ApiIssue
  milestones: ApiMilestone[] | null
  users: ApiUser[] | null
  // Owned by InboxPage, not this panel — see `committedVersions` there for
  // why. Defined once POST .../transition has committed for this issue: the
  // status/priority change is real even if the milestone/assignee PATCH
  // below failed, so the panel must stop offering 통관/반송/정박 (the issue
  // already left 입항 대기; re-offering them implies nothing happened) and
  // switch to retrying only the part that didn't save. Carries the version
  // that commit landed at, so a remounted panel (닫기 then reopen) still
  // knows it even though GroomingPanel's own committedVersionRef below
  // resets to null on every remount (Task 9).
  committedVersion: number | undefined
  onCommitted: (version: number) => void
  onDone: () => void
  onRefresh: () => void
}) {
  const committed = committedVersion !== undefined
  const [priority, setPriority] = useState<Priority | null>(null)
  // undefined = '미배정' selected = leave the field out of the PATCH body,
  // not "clear it" (these issues have never had one).
  const [milestoneId, setMilestoneId] = useState<number | undefined>(undefined)
  const [assigneeId, setAssigneeId] = useState<number | undefined>(undefined)
  const [reasonTarget, setReasonTarget] = useState<'rejected' | 'on_hold' | null>(null)
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  // The version the transition below actually committed, valid for this
  // mount's lifetime — the assignment PATCH that follows must send THIS, not
  // issue.version: the transition just bumped the row, so issue (the
  // parent's still-stale list snapshot) is one version behind by the time
  // this runs. patchAssignment also folds in the committedVersion prop
  // (Task 9): this ref alone resets to null on every remount (닫기 then
  // reopen unmounts and remounts GroomingPanel), which used to make the
  // retry PATCH fall back to the stale issue.version and 409 forever. The
  // prop is what survives a remount; this ref is only ahead of it within a
  // single mount, before InboxPage has re-rendered with the new prop value.
  const committedVersionRef = useRef<number | null>(null)
  // An async continuation (a hung transition POST or assignment PATCH) can
  // resolve after this exact panel instance has unmounted — its row closed,
  // or closed then reopened as a brand-new instance for the same issue.
  // Everything below that would act on the UI (onDone, setError, setConflict)
  // checks this first; onCommitted is the one exception — see its call site.
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  async function patchAssignment() {
    const patch: { milestoneId?: number; assigneeId?: number; expectedVersion: number } =
      { expectedVersion: Math.max(issue.version, committedVersionRef.current ?? 0, committedVersion ?? 0) }
    if (milestoneId !== undefined) patch.milestoneId = milestoneId
    if (assigneeId !== undefined) patch.assigneeId = assigneeId
    await api(`/api/v1/issues/${issue.id}`, { method: 'PATCH', body: JSON.stringify(patch) })
  }

  // Retries just the milestone/assignee PATCH — reused both right after a
  // successful transition and from the "다시 저장" button. Re-running the
  // transition itself isn't an option here: the issue is already in
  // backlog, and backlog -> backlog isn't a legal transition, so retrying
  // that would surface a confusing 422 in place of the real failure.
  async function retryAssignment() {
    if (pending) return
    setPending(true)
    setError(null)
    setConflict(false)
    try {
      // Gated on `committed` (the lifted, remount-surviving prop), not on
      // whether THIS mount's own conflict flag was ever set — `conflict` is
      // local state that resets to false on every fresh mount, so a
      // 닫기-then-reopen instance's first retry would otherwise skip the
      // re-sync exactly once (it has no failed attempt of its own yet) and
      // send the possibly-stale committedVersion straight into another 409.
      // Same mount-local blind spot Defect 2 had to fix for
      // committedVersionRef, one level up. `committed` reads false for the
      // internal call right after a fresh commit (the onCommitted prop
      // update hasn't landed in this render yet), so that path still skips
      // the GET, not a redundant one — the redundant case is a committed-mode
      // retry that turns out not to have conflicted, which Math.max in
      // patchAssignment makes harmless.
      if (committed) {
        const fresh = await api<ApiIssueDetail>(`/api/v1/issues/${issue.id}`)
        committedVersionRef.current = Math.max(committedVersionRef.current ?? 0, fresh.issue.version)
      }
      await patchAssignment()
      // Guarded: this exact panel instance may already be gone (its row
      // closed, or closed then reopened as a fresh instance for the same
      // issue) by the time this resolves — see the `alive` comment above.
      if (alive.current) onDone()
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : '요청에 실패했습니다'
      if (alive.current) {
        setError(`우선순위와 상태는 반영됐지만 담당자·마일스톤 지정에 실패했습니다: ${msg}`)
        setConflict(err instanceof ApiError && err.status === 409)
      }
    } finally {
      setPending(false)
    }
  }

  async function transition(body: Record<string, unknown>) {
    setPending(true)
    setError(null)
    setConflict(false)
    let updated: ApiIssue
    try {
      updated = await api<ApiIssue>(`/api/v1/issues/${issue.id}/transition`, {
        method: 'POST',
        body: JSON.stringify({ ...body, expectedVersion: issue.version }),
      })
    } catch (err) {
      // Nothing committed — this is the "before" failure, reported as-is.
      // Guarded like everything below: the admin can close this row while
      // the POST is in flight, and a reject arriving after must not touch
      // whatever panel (this row reopened, or none) is on screen now.
      if (alive.current) {
        setError(err instanceof ApiError ? err.message : '요청에 실패했습니다')
        setConflict(err instanceof ApiError && err.status === 409)
        setPending(false)
      }
      return
    }
    committedVersionRef.current = updated.version
    // Unguarded — the transition genuinely committed, and InboxPage's
    // committedVersions must learn that (and the version it committed to)
    // even if this exact panel instance is already gone; see its own comment.
    onCommitted(updated.version)
    // milestone/assignee are a separate call — transition only carries
    // status + priority (backend contract, not a UI choice).
    const needsAssignment = body.to === 'backlog' && (milestoneId !== undefined || assigneeId !== undefined)
    if (!needsAssignment) {
      if (alive.current) {
        setPending(false)
        onDone()
      }
      return
    }
    await retryAssignment()
  }

  return (
    <div className="row-expand">
      <div className="stack">
        {issue.description ? <p className="prose">{issue.description}</p> : null}

        {reasonTarget ? (
          <ReasonField
            action={reasonTarget === 'rejected' ? '반송' : '정박'}
            reason={reason}
            onReasonChange={setReason}
            onCancel={() => { setReasonTarget(null); setReason('') }}
            onConfirm={() => transition({ to: reasonTarget, reason })}
            pending={pending}
          />
        ) : (
          <>
            <div className="inline" style={{ gap: 'var(--s-5)' }}>
              <div className="field">
                <span className="label">우선순위 <span className="faint">필수</span></span>
                <div className="seg" role="radiogroup" aria-label="우선순위">
                  {PRIORITIES.map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={p === 'p0' ? 'seg__b seg__b--p0' : 'seg__b'}
                      role="radio"
                      aria-checked={priority === p}
                      disabled={committed || pending}
                      onClick={() => setPriority(p)}
                    >
                      {p.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label className="label" htmlFor={`ms-${issue.id}`}>마일스톤</label>
                <div className="select-wrap">
                  <select
                    id={`ms-${issue.id}`}
                    className="select"
                    value={milestoneId ?? ''}
                    // patchAssignment snapshots the ids before awaiting, so
                    // an edit made mid-request would show B on screen while
                    // A is what saved — and success closes the row, silently
                    // dropping B. Lock both selects for the round trip.
                    disabled={pending}
                    onChange={(e) => setMilestoneId(e.target.value === '' ? undefined : Number(e.target.value))}
                  >
                    <option value="">미배정</option>
                    {(milestones ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label className="label" htmlFor={`as-${issue.id}`}>담당자</label>
                <div className="select-wrap">
                  <select
                    id={`as-${issue.id}`}
                    className="select"
                    value={assigneeId ?? ''}
                    disabled={pending}
                    onChange={(e) => setAssigneeId(e.target.value === '' ? undefined : Number(e.target.value))}
                  >
                    <option value="">미배정</option>
                    {assignableUsers(users, assigneeId ?? null).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <div className="divider" />

            {committed ? (
              <div className="inline">
                {/* An empty PATCH body isn't a valid request, and a panel
                    reopened after 닫기 has lost the picks that were in
                    flight — so the button waits for a fresh selection. */}
                <button
                  type="button"
                  className="btn btn--accent"
                  disabled={pending || (milestoneId === undefined && assigneeId === undefined)}
                  onClick={retryAssignment}
                >
                  담당자·마일스톤 다시 저장
                </button>
                {/* Reopened panels lost the error text that explained why only
                    half the work saved, so without the first half this mode
                    reads as an unexplained missing 통관 button. */}
                <span className="hint push">
                  {error ? CLOSE_WARNING : `이미 통관되었습니다 — 담당자·마일스톤을 선택해 저장하세요. ${CLOSE_WARNING}`}
                </span>
              </div>
            ) : (
              <div className="inline">
                <button
                  type="button"
                  className="btn btn--accent"
                  disabled={!priority || pending}
                  onClick={() => priority && transition({ to: 'backlog', priority })}
                >
                  {/* 'P2'는 모음으로 끝나 '로', P0·P1은 읽기에 따라 갈리므로
                      기본값 '으로'를 유지한다. */}
                  {priority ? `${priority.toUpperCase()}${priority === 'p2' ? '로' : '으로'} 통관` : '통관'}
                </button>
                <button type="button" className="btn btn--danger" disabled={pending} onClick={() => setReasonTarget('rejected')}>반송</button>
                <button type="button" className="btn" disabled={pending} onClick={() => setReasonTarget('on_hold')}>정박</button>
                <span className="hint push">반송·정박은 사유를 남겨야 저장됩니다.</span>
              </div>
            )}
          </>
        )}

        {error ? (
          <div className="inline">
            <p className="hint">{error}</p>
            {/* Pre-commit only. After the transition committed, 새로고침
                (the whole inbox list refetch) would drop the already-backlog
                row and destroy the retry button along with the unsaved
                assignment — CLOSE_WARNING's exact worry, done to the admin
                without asking. A committed-mode 409 doesn't need it: 다시
                저장 itself now re-syncs with a single-issue GET before every
                committed-mode retry (Task 9) — gated on `committed`, not on
                whether THIS mount ever saw a conflict, since `conflict`
                resets to false on every fresh mount and would otherwise skip
                the re-sync on a reopened panel's first click. So it succeeds
                on the first try whether the stale version came from this
                mount's own 닫기-then-reopen or a genuine concurrent edit by
                someone else. Both failure classes reach the same button;
                only the retry's own behavior differs, not a second
                affordance. */}
            {conflict && !committed ? <button type="button" className="btn btn--sm" onClick={onRefresh}>새로고침</button> : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
