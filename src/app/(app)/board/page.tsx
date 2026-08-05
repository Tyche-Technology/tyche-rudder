'use client'

import { useEffect, useState } from 'react'
import { useApi, api, ApiError } from '@/ui/api'
import { useMe } from '@/ui/shell'
import { useProducts, useUsers, useMilestones } from '@/ui/catalog-data'
import { countByProduct } from '@/ui/inbox-filters'
import { BoardColumn } from '@/ui/board-column'
import { isNoopReorder, type Target } from '@/ui/reorder'
import { STATUS_LABEL } from '@/ui/labels'
import type { ApiIssue } from '@/ui/types'

function filterByProduct(issues: ApiIssue[], selected: Set<number>): ApiIssue[] {
  return selected.size === 0 ? issues : issues.filter((i) => selected.has(i.productId))
}

// Immutable reposition of the dragged issue within the full backlog order —
// used for the optimistic update in commitReorder below. anchorId always
// comes from `target`, which board-column.tsx derived from this same list
// (or a filtered view of it), so it is always present.
function reposition(list: ApiIssue[], draggedId: number, target: Target): ApiIssue[] {
  const dragged = list.find((i) => i.id === draggedId)
  if (!dragged) return list
  const rest = list.filter((i) => i.id !== draggedId)
  const anchorId = 'afterId' in target ? target.afterId : target.beforeId
  const anchorIdx = rest.findIndex((i) => i.id === anchorId)
  if (anchorIdx === -1) return list
  const insertAt = 'afterId' in target ? anchorIdx + 1 : anchorIdx
  return [...rest.slice(0, insertAt), dragged, ...rest.slice(insertAt)]
}

export default function BoardPage() {
  // Only admins can reorder (POST .../reorder 403s for anyone else — same
  // requireAdmin gate Inbox's 통관 button follows), so a non-admin sees the
  // board read-only rather than being offered a drag/keyboard interaction
  // that's guaranteed to fail server-side.
  const isAdmin = useMe().role === 'admin'
  const backlog = useApi<ApiIssue[]>('/api/v1/issues?status=backlog')
  const inProgress = useApi<ApiIssue[]>('/api/v1/issues?status=in_progress')
  const onHold = useApi<ApiIssue[]>('/api/v1/issues?status=on_hold')
  const done = useApi<ApiIssue[]>('/api/v1/issues?status=done')
  const { products, error: productsError, refetch: refetchProducts } = useProducts()
  const { users, error: usersError, refetch: refetchUsers } = useUsers()
  const { milestones, error: milestonesError, refetch: refetchMilestones } = useMilestones()

  // 반송 is hidden by default and only fetched once the admin asks for it
  // (useApi's path=null skip — same dependent-query pattern api.ts documents).
  const [showRejected, setShowRejected] = useState(false)
  const rejected = useApi<ApiIssue[]>(showRejected ? '/api/v1/issues?status=rejected' : null)

  const [selectedProducts, setSelectedProducts] = useState<Set<number>>(new Set())
  const [showAllDone, setShowAllDone] = useState(false)

  // The backlog column's own editable order — the other three columns
  // render straight off their fetch; only backlog needs a local copy to
  // reorder optimistically ahead of the server confirming it.
  const [order, setOrder] = useState<ApiIssue[] | null>(null)
  useEffect(() => { if (backlog.data) setOrder(backlog.data) }, [backlog.data])
  const [reorderError, setReorderError] = useState<string | null>(null)
  // Serializes drag + ⌥↑/⌥↓ commits (both funnel through commitReorder):
  // without it, a key held down or a drop landing mid-flight fires
  // overlapping requests, and an earlier one's failure can roll back over a
  // later one's already-confirmed success. Dropped rapid attempts are fine;
  // a queue is not needed — same discipline as the Inbox grooming panel's
  // `pending` guard.
  const [reorderPending, setReorderPending] = useState(false)

  async function commitReorder(draggedId: number, target: Target) {
    if (!order || reorderPending) return
    // The no-op check MUST run against the canonical (full) backlog order,
    // never a filtered view: with a product filter active, the card's
    // neighbor in the VISIBLE list can differ from its neighbor in the
    // canonical list (a hidden card can sit between them), so checking
    // against the filtered ids can mistake a real move for a no-op and
    // silently drop the request (see reorder.test.ts's probe case).
    const canonicalIds = order.map((i) => i.id)
    if (isNoopReorder(canonicalIds, draggedId, target)) return

    const snapshot = order
    setReorderPending(true)
    setOrder(reposition(order, draggedId, target))
    setReorderError(null)
    try {
      const updated = await api<ApiIssue>(`/api/v1/issues/${draggedId}/reorder`, {
        method: 'POST',
        body: JSON.stringify({ ...target, expectedVersion: order.find((i) => i.id === draggedId)!.version }),
      })
      setOrder((cur) => cur && cur.map((i) => (i.id === draggedId ? { ...i, sortOrder: updated.sortOrder, version: updated.version } : i)))
    } catch (err) {
      setOrder(snapshot)
      // No form backs this request (see field-errors.ts / Task 16), so a
      // validation issue (e.g. 'afterId 또는 beforeId가 필요합니다') can't render
      // next to an input — surface its specific message in the banner
      // instead of letting it collapse into the generic '입력값이 올바르지
      // 않습니다' sentence.
      setReorderError(err instanceof ApiError ? (err.issues?.[0]?.message ?? err.message) : '요청에 실패했습니다')
      // The endpoint 404s when the issue vanished from backlog entirely
      // (someone else transitioned it) — the snapshot rollback alone would
      // resurrect a card the server no longer has there, so refetch to
      // reconcile to truth on top of the instant rollback.
      backlog.refetch()
    } finally {
      setReorderPending(false)
    }
  }

  const coreError = backlog.error || inProgress.error || onHold.error || done.error
  if (coreError) {
    return (
      <div className="empty">
        <span className="empty__title">불러오지 못했습니다</span>
        <span className="empty__body">{coreError.message}</span>
        <button
          className="btn btn--sm"
          type="button"
          onClick={() => { backlog.refetch(); inProgress.refetch(); onHold.refetch(); done.refetch() }}
        >
          다시 시도
        </button>
      </div>
    )
  }
  if (
    // backlog.loading alone would re-blank the whole board on the
    // reorder-failure reconciliation refetch (backlog.refetch() above) even
    // though `order` still holds the rolled-back snapshot — gate on it only
    // until the first load lands (order === null), not on every subsequent
    // refetch.
    (backlog.loading && order === null) || inProgress.loading || onHold.loading || done.loading
    || order === null || inProgress.data === null || onHold.data === null || done.data === null
  ) return null

  const filteredBacklog = filterByProduct(order, selectedProducts)
  const filteredInProgress = filterByProduct(inProgress.data, selectedProducts)
  const filteredOnHold = filterByProduct(onHold.data, selectedProducts)
  const filteredDone = filterByProduct(done.data, selectedProducts)
  const doneToShow = showAllDone ? filteredDone : filteredDone.slice(0, 5)

  const allIssues = [...order, ...inProgress.data, ...onHold.data, ...done.data]
  const filteredAll = [...filteredBacklog, ...filteredInProgress, ...filteredOnHold, ...filteredDone]
  const totalCount = filteredAll.length
  const p0Count = filteredAll.filter((i) => i.priority === 'p0').length

  const counts = countByProduct(allIssues)
  const productChips = (products ?? [])
    .filter((p) => counts.has(p.id))
    .map((p) => ({ id: p.id, name: p.name, count: counts.get(p.id)! }))

  function toggleProduct(id: number) {
    setSelectedProducts((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <>
      <div className="view__head">
        <h2 className="h-view">선적 대기 보드</h2>
        <span className="mono muted push">{totalCount}건 · P0 {p0Count}건</span>
      </div>
      <p className="view__lede">
        선적 대기 열의 순서가 팀이 다음에 할 일의 순서입니다.
        {isAdmin ? ' 카드를 끌어 옮기거나 카드를 선택하고 ⌥↑ / ⌥↓ 로 바꿉니다. 순서 변경은 히스토리에 남습니다.' : ''}
      </p>

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

      {reorderError ? (
        <div className="inline" style={{ marginBottom: 'var(--s-4)' }}>
          <p className="hint">순서를 저장하지 못했습니다: {reorderError}</p>
          <button className="btn btn--sm" type="button" onClick={() => setReorderError(null)}>닫기</button>
        </div>
      ) : null}

      <div className="inline" style={{ marginBottom: 'var(--s-4)' }}>
        <div className="filters">
          <button className="fchip" type="button" aria-pressed={selectedProducts.size === 0} onClick={() => setSelectedProducts(new Set())}>
            전체<span className="fchip__n">{allIssues.length}</span>
          </button>
          {productChips.map((p) => (
            <button
              key={p.id}
              className="fchip"
              type="button"
              aria-pressed={selectedProducts.has(p.id)}
              onClick={() => toggleProduct(p.id)}
            >
              {p.name}<span className="fchip__n">{p.count}</span>
            </button>
          ))}
        </div>
        <span className="push">
          <button className="btn btn--sm" type="button" onClick={() => setShowRejected((v) => !v)}>
            {showRejected ? '반송 숨기기' : '반송 보기'}
          </button>
        </span>
      </div>

      <div className="board">
        <BoardColumn
          status="backlog"
          issues={filteredBacklog}
          products={products}
          users={users}
          milestones={milestones}
          onReorder={isAdmin ? commitReorder : undefined}
          note={isAdmin ? '드래그로 순서 변경 · 카드 선택 후 ⌥↑ / ⌥↓' : undefined}
        />
        <BoardColumn status="in_progress" issues={filteredInProgress} products={products} users={users} milestones={milestones} />
        <BoardColumn status="on_hold" issues={filteredOnHold} products={products} users={users} milestones={milestones} />
        <BoardColumn
          status="done"
          issues={doneToShow}
          products={products}
          users={users}
          milestones={milestones}
          note={filteredDone.length > 5 ? (
            <>
              {showAllDone ? `전체 ${filteredDone.length}건 표시 중` : '최근 5건만 표시'}
              {' · '}
              <button type="button" className="btn btn--sm" onClick={() => setShowAllDone((v) => !v)}>
                {showAllDone ? '접기' : '전체 보기'}
              </button>
            </>
          ) : undefined}
        />
        {showRejected ? (
          rejected.error ? (
            <section className="col" aria-label={STATUS_LABEL.rejected.ko}>
              <div className="empty">
                <span className="empty__title">불러오지 못했습니다</span>
                <span className="empty__body">{rejected.error.message}</span>
                <button className="btn btn--sm" type="button" onClick={rejected.refetch}>다시 시도</button>
              </div>
            </section>
          ) : rejected.loading || rejected.data === null ? null : (
            <BoardColumn status="rejected" issues={filterByProduct(rejected.data, selectedProducts)} products={products} users={users} milestones={milestones} />
          )
        ) : null}
      </div>
    </>
  )
}
