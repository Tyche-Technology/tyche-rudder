'use client'

// The '새 이슈' dialog — native <dialog> (design doc: no custom modal
// system). Mounted once via useTopbarActions so every page gets the button
// without threading a prop through the shared (app) layout.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { api, ApiError } from './api'
import { useProducts } from './catalog-data'
import { fieldErrors } from './field-errors'
import { TYPE_LABEL } from './labels'
import type { ApiIssue, IssueType } from './types'

// Order is fixed here (버그 → 기능 → 개선, per the mockup); the words come
// from labels.ts, the single owner of the type vocabulary.
const TYPE_OPTIONS: IssueType[] = ['bug', 'feature', 'improvement']

export function NewIssueButton() {
  const router = useRouter()
  const { products, error: productsError, refetch: refetchProducts } = useProducts()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [title, setTitle] = useState('')
  const [productId, setProductId] = useState<number | ''>('')
  const [type, setType] = useState<IssueType>('bug')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)

  // POST /issues creates in inbox with no priority regardless of what's
  // picked here — 제품 only needs to be one still taking new requests.
  const activeProducts = (products ?? []).filter((p) => p.active)

  // Opening the dialog before useProducts() resolves seeds productId as ''
  // (open() below has nothing to default to yet); once the list arrives,
  // pick the first option instead of leaving 등록 disabled with no visible
  // reason. Only fires while still unset — never overrides a real choice.
  useEffect(() => {
    if (productId === '' && activeProducts.length > 0) {
      setProductId(activeProducts[0].id)
    }
    // activeProducts is derived from `products` each render; keying off
    // `products` itself avoids re-running this effect every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, productId])

  function open() {
    setTitle('')
    setProductId(activeProducts[0]?.id ?? '')
    setType('bug')
    setDescription('')
    setError(null)
    setErrors({})
    dialogRef.current?.showModal()
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim() || productId === '' || pending) return
    setPending(true)
    setError(null)
    setErrors({})
    try {
      const issue = await api<ApiIssue>('/api/v1/issues', {
        method: 'POST',
        body: JSON.stringify({ title, type, productId, description: description.trim() || undefined }),
      })
      dialogRef.current?.close()
      router.push(`/issues/${issue.id}`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '요청에 실패했습니다')
      setErrors(fieldErrors(err))
      setPending(false)
    }
  }

  return (
    <>
      <button className="btn btn--primary" type="button" onClick={open}>새 이슈</button>
      <dialog
        ref={dialogRef}
        aria-label="새 이슈"
        // Esc fires the dialog's cancel event, which closes it natively —
        // without this the modal vanishes while the request keeps running
        // and still commits, the same "취소 that commits" the buttons guard.
        onCancel={(e) => { if (pending) e.preventDefault() }}
      >
        <form className="stack" onSubmit={submit}>
          <h2 className="h-panel">새 이슈</h2>
          <div className="field">
            <label className="label" htmlFor="ni-title">제목</label>
            <input
              id="ni-title"
              className="input"
              required
              disabled={pending}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            {errors.title ? <span className="hint">{errors.title}</span> : null}
          </div>
          <div className="inline" style={{ gap: 'var(--s-3)', alignItems: 'flex-start' }}>
            <div className="field" style={{ flex: 1 }}>
              <label className="label" htmlFor="ni-product">제품</label>
              <div className="select-wrap">
                <select
                  id="ni-product"
                  className="select"
                  disabled={pending}
                  value={productId}
                  onChange={(e) => setProductId(Number(e.target.value))}
                >
                  {activeProducts.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              {errors.productId ? <span className="hint">{errors.productId}</span> : null}
            </div>
            <div className="field">
              <span className="label">유형</span>
              <div className="seg" role="radiogroup" aria-label="유형">
                {TYPE_OPTIONS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="seg__b"
                    role="radio"
                    aria-checked={type === t}
                    disabled={pending}
                    onClick={() => setType(t)}
                  >
                    {TYPE_LABEL[t].ko}
                  </button>
                ))}
              </div>
              {errors.type ? <span className="hint">{errors.type}</span> : null}
            </div>
          </div>
          <div className="field">
            <label className="label" htmlFor="ni-desc">설명</label>
            <textarea
              id="ni-desc"
              className="textarea"
              disabled={pending}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="무엇이 어떻게 안 되는지, 재현 방법이 있으면 함께 적어주세요."
            />
            <span className="hint">설명은 선택 사항입니다.</span>
            {errors.description ? <span className="hint">{errors.description}</span> : null}
          </div>
          {/* An empty 제품 select with 등록 disabled and nothing explaining
              why is the same dead end whether the fetch failed or simply
              returned no active product (fresh install, everything
              deactivated) — so this is gated on the select being unusable,
              not on there being an error. `products !== null` keeps it quiet
              while the first load is still in flight; the length check keeps
              it quiet when a refetch fails but stale options remain usable. */}
          {activeProducts.length === 0 && (productsError || products !== null) ? (
            <div className="inline">
              <p className="hint">
                {productsError
                  ? '제품 목록을 불러오지 못해 이슈를 등록할 수 없습니다.'
                  : '등록 가능한 제품이 없습니다.'}
              </p>
              {productsError ? (
                <button type="button" className="btn btn--sm" onClick={refetchProducts}>다시 시도</button>
              ) : null}
            </div>
          ) : null}
          {error ? <p className="hint">{error}</p> : null}
          <div className="divider" />
          <div className="inline">
            {/* Gated while the POST is in flight: closing mid-request doesn't
                stop submit(), which still router.push()es to the issue the
                user just cancelled — a 취소 that commits. */}
            <button type="button" className="btn btn--ghost" disabled={pending} onClick={() => dialogRef.current?.close()}>취소</button>
            <button type="submit" className="btn btn--primary push" disabled={!title.trim() || productId === '' || pending}>
              {pending ? '등록 중…' : '등록'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  )
}
