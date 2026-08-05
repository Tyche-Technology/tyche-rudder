'use client'

// Issue detail's attachments panel (Task 8). No delete affordance —
// attachments/route.ts (Task 7) exposes upload + download only, so
// offering one here would promise a capability the API can't serve. No
// inline preview either: the download route always sends
// content-disposition: attachment (a deliberate anti-XSS property, not an
// oversight), so a link to it downloads rather than renders in-page.
import { useRef, useState, type FormEvent } from 'react'
import { api, ApiError } from '@/ui/api'
import { formatBytes, shortDate } from '@/ui/format'
import type { ApiAttachment } from '@/ui/types'

export function AttachmentsPanel({
  issueId, attachments, onChanged,
}: {
  issueId: number
  attachments: ApiAttachment[]
  onChanged: () => void
}) {
  const inputId = `att-file-${issueId}`
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!file || pending) return
    setPending(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      await api(`/api/v1/issues/${issueId}/attachments`, { method: 'POST', body: form })
      setFile(null)
      if (inputRef.current) inputRef.current.value = ''
      onChanged()
    } catch (err) {
      // 413/422 copy comes straight from the server (attachments/route.ts) —
      // it's already written for a non-developer, so it's shown verbatim.
      setError(err instanceof ApiError ? err.message : '요청에 실패했습니다')
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="panel">
      <div className="panel__head">
        <h2 className="h-card">첨부</h2>
        <span className="mono muted push">{attachments.length}</span>
      </div>
      <div className="panel__body">
        {attachments.length === 0 ? (
          <p className="hint">첨부된 화물이 없습니다</p>
        ) : (
          attachments.map((a) => (
            <div className="att-row" key={a.id}>
              <a className="att-row__name" href={`/api/v1/attachments/${a.id}`}>{a.filename}</a>
              <span className="mono faint push">{formatBytes(a.sizeBytes)} · {shortDate(a.createdAt)}</span>
            </div>
          ))
        )}

        <form className="inline" style={{ marginTop: 'var(--s-3)', alignItems: 'flex-end' }} onSubmit={submit}>
          <div className="field" style={{ flex: 1 }}>
            <label className="label" htmlFor={inputId}>파일 선택</label>
            <input
              id={inputId}
              ref={inputRef}
              className="input"
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain"
              disabled={pending}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <button type="submit" className="btn btn--primary btn--sm" disabled={!file || pending}>업로드</button>
        </form>
        {pending ? <p className="hint" role="status">업로드 중입니다</p> : null}
        {error ? <p className="hint">{error}</p> : null}
      </div>
    </section>
  )
}
