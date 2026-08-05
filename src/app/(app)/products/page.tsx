'use client'

// Products admin: rename, activate/deactivate, add — nothing else lives
// here (milestone management is the Roadmap page's job). requireAdmin is
// already enforced server-side on POST/PATCH; GET /products is open to
// every authenticated user (the New Issue dialog's product picker needs
// it), so hiding this page's body for non-admins is a client-side courtesy,
// not the actual guard.
import { useState } from 'react'
import { api, ApiError } from '@/ui/api'
import { useMe } from '@/ui/shell'
import { useProducts, useUsers, nameOf } from '@/ui/catalog-data'
import { shortDate } from '@/ui/format'
import { EmptyState } from '@/ui/bits'
import { fieldErrors } from '@/ui/field-errors'
import type { ApiProduct, ApiUser } from '@/ui/types'

export default function ProductsPage() {
  const me = useMe()
  // Called unconditionally regardless of role (Inbox precedent) — GET
  // /products/users cost nothing extra for a non-admin, and conditionally
  // calling hooks based on role would break the rules of hooks.
  const { products, error, refetch } = useProducts()
  const { users, error: usersError, refetch: refetchUsers } = useUsers()

  if (me.role !== 'admin') {
    return (
      <EmptyState
        title="권한이 없습니다"
        body="제품 관리는 관리자만 사용할 수 있습니다."
      />
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
  // useProducts() has no separate loading flag — data stays null until the
  // fetch resolves either way, and error (checked above) already claimed
  // the failure branch, so null here means "still in flight".
  if (products === null) return null

  return (
    <>
      <div className="view__head">
        <h2 className="h-view">제품 관리</h2>
        <span className="mono muted push">{products.length}건</span>
      </div>
      <p className="view__lede">
        여기서 만든 제품이 새 이슈 등록의 선택지가 됩니다. 비활성화하면 목록에서 숨겨지지만
        기존 이슈에는 영향이 없습니다.
      </p>

      {usersError ? (
        <div className="inline" style={{ marginBottom: 'var(--s-4)' }}>
          <p className="hint">담당자 정보를 불러오지 못해 최종 수정자 이름이 비어 보일 수 있습니다.</p>
          <button className="btn btn--sm" type="button" onClick={refetchUsers}>다시 시도</button>
        </div>
      ) : null}

      <div className="panel">
        <div className="rows">
          {products.length === 0 ? (
            <div className="panel__body">
              <EmptyState
                title="등록된 제품이 없습니다"
                body="제품을 추가하면 이슈 등록 시 선택할 수 있습니다."
              />
            </div>
          ) : products.map((product) => (
            <ProductRow key={product.id} product={product} users={users} onSaved={refetch} />
          ))}
          <AddProductRow onCreated={refetch} />
        </div>
      </div>
    </>
  )
}

function ProductRow({
  product, users, onSaved,
}: {
  product: ApiProduct
  // null while the catalog is still loading or failed — nameOf renders
  // blank rather than falsely claiming 미배정.
  users: ApiUser[] | null
  onSaved: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(product.name)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // A fresh product's updatedByUserId is null until its first PATCH
  // (creation only sets createdByUserId — Task 3 schema); fall back to the
  // creator so 최종 수정 doesn't falsely read 미배정 for a just-created row.
  // Only a true pre-attribution legacy row (both ids null) gets the honest
  // '—' — 미배정 would claim an assignment that was never tracked.
  const attributedById = product.updatedByUserId ?? product.createdByUserId
  const attributedAt = product.updatedByUserId !== null ? product.updatedAt : product.createdAt
  const attributedName = attributedById === null ? '—' : nameOf(users, attributedById)

  async function saveName() {
    if (pending) return
    const name = draftName.trim()
    if (!name || name === product.name) {
      setEditing(false)
      setDraftName(product.name)
      return
    }
    setPending(true)
    setError(null)
    setErrors({})
    try {
      await api(`/api/v1/products/${product.id}`, { method: 'PATCH', body: JSON.stringify({ name }) })
      setEditing(false)
      onSaved()
    } catch (err) {
      // 422 dup-name message from updateProduct's ruleViolation, shown as-is.
      setError(err instanceof ApiError ? err.message : '요청에 실패했습니다')
      setErrors(fieldErrors(err))
    } finally {
      setPending(false)
    }
  }

  async function toggleActive() {
    if (pending) return
    setPending(true)
    setError(null)
    setErrors({})
    try {
      await api(`/api/v1/products/${product.id}`, { method: 'PATCH', body: JSON.stringify({ active: !product.active }) })
      onSaved()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '요청에 실패했습니다')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="row" style={{ gridTemplateColumns: 'minmax(0,1fr) auto auto' }}>
      <div className="stack stack--sm" style={{ minWidth: 0 }}>
        {editing ? (
          <div className="inline">
            <input
              className="input"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              disabled={pending}
              aria-label="제품 이름"
            />
            <button className="btn btn--sm" type="button" onClick={saveName} disabled={pending || !draftName.trim()}>저장</button>
            <button
              className="btn btn--ghost btn--sm"
              type="button"
              disabled={pending}
              onClick={() => { setEditing(false); setDraftName(product.name); setError(null); setErrors({}) }}
            >
              취소
            </button>
          </div>
        ) : (
          <span className="row__title">{product.name}</span>
        )}
        {errors.name ? <span className="hint">{errors.name}</span> : null}
        <span className="hint">
          최종 수정 · {attributedName ?? ''} · {shortDate(attributedAt)}
        </span>
        {error ? <span className="hint">{error}</span> : null}
      </div>
      <span className={product.active ? 'mono' : 'mono faint'}>{product.active ? '활성' : '비활성'}</span>
      <div className="inline">
        <button className="btn btn--sm" type="button" disabled={pending} onClick={toggleActive}>
          {product.active ? '비활성화' : '활성화'}
        </button>
        {!editing ? (
          // Reset the draft from the CURRENT name here, not just at mount —
          // this row is id-keyed and survives refetches, so a rename that
          // landed from elsewhere since mount must not be clobbered by a
          // stale draft on save.
          <button
            className="btn btn--ghost btn--sm"
            type="button"
            disabled={pending}
            onClick={() => { setDraftName(product.name); setEditing(true) }}
          >
            수정
          </button>
        ) : null}
      </div>
    </div>
  )
}

function AddProductRow({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  async function submit() {
    if (pending || !name.trim()) return
    setPending(true)
    setError(null)
    setErrors({})
    try {
      await api('/api/v1/products', { method: 'POST', body: JSON.stringify({ name: name.trim() }) })
      setName('')
      onCreated()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '요청에 실패했습니다')
      setErrors(fieldErrors(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="row" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
      <div className="field">
        <input
          className="input"
          placeholder="새 제품 이름"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={pending}
          aria-label="새 제품 이름"
        />
        {errors.name ? <span className="hint">{errors.name}</span> : null}
        {error ? <span className="hint">{error}</span> : null}
      </div>
      <button className="btn btn--primary btn--sm" type="button" onClick={submit} disabled={pending || !name.trim()}>제품 추가</button>
    </div>
  )
}
