// The fetch seam — every request the UI makes to /api/v1/* goes through
// here, and nothing else in src/ui/** touches fetch directly. Keeps the
// envelope-unwrapping and 401 redirect logic in exactly one place.
import { useEffect, useState } from 'react'

export class ApiError extends Error {
  constructor(public status: number, message: string, public issues?: Array<{ path: string; message: string }>) {
    super(message)
    this.name = 'ApiError'
  }
}

type Envelope<T> = { ok: true; data: T } | { ok: false; error: string; issues?: Array<{ path: string; message: string }> }

// The 'data' in body check matters even though the ok:true branch of
// Envelope<T> declares it required: that's a compile-time promise only.
// A malformed 2xx (proxy, misbehaving upstream) can hand back `{ok:true}`
// with no data at all, and without this check body.data below is `undefined`
// wearing a type of T.
function isOkEnvelope<T>(body: Envelope<T> | null): body is { ok: true; data: T } {
  return body !== null && body.ok === true && 'data' in body
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      // A hung request must eventually settle, or every control gated on
      // `pending` stays disabled forever — worst in the three dialogs, where
      // 취소 is disabled and Esc is prevented while pending, so a fetch that
      // never resolves is a modal with no keyboard escape. 30s is far past
      // any legitimate request here (small CRUD against one database) and a
      // caller-supplied signal still wins.
      signal: AbortSignal.timeout(30_000),
      ...init,
      // A FormData body (attachment upload) must NOT get this header — the
      // browser sets its own multipart boundary, which a forced json
      // content-type would corrupt.
      headers: {
        ...(init?.body instanceof FormData ? {} : { 'content-type': 'application/json' }),
        ...init?.headers,
      },
    })
  } catch {
    // Never reached the server at all (offline, DNS failure, timeout,
    // aborted connection) — status 0 so callers can tell this apart from any
    // real HTTP status.
    throw new ApiError(0, '서버에 연결할 수 없습니다')
  }

  // A non-JSON body (proxy error page, empty 204, etc) must still resolve
  // to the fallback ApiError below rather than throwing SyntaxError past
  // this function's callers.
  const body: Envelope<T> | null = await res.json().catch(() => null)

  if (!res.ok || !isOkEnvelope(body)) {
    // A 5xx body is never shown to the user: our own withErrorEnvelope
    // already sends this exact generic string, so we lose nothing — and a
    // proxy or upstream 5xx carrying a stack trace/hostname/SQL fragment
    // must not render verbatim in a form.
    const message = res.status >= 500
      ? '서버 오류가 발생했습니다'
      : (body && !body.ok ? body.error : null) ?? '요청에 실패했습니다'
    // Skip when already on /login so an expired session doesn't loop the
    // login page through its own auth check.
    if (res.status === 401 && typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.assign('/login')
    }
    throw new ApiError(res.status, message, body && !body.ok ? body.issues : undefined)
  }

  return body.data
}

// Dependent queries pass path=null to skip the fetch entirely (e.g. an
// issue detail hook that waits for a route param to resolve).
export function useApi<T>(path: string | null): { data: T | null; error: ApiError | null; loading: boolean; refetch: () => void } {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(path !== null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    // Settle, don't abandon: a path that goes non-null -> null mid-flight
    // must still clear the loading flag the previous effect set, or it's
    // stuck true forever (the in-flight fetch's own .finally is skipped by
    // that effect's cancelled flag, so nothing else will ever clear it).
    if (path === null) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    api<T>(path)
      .then((result) => { if (!cancelled) setData(result) })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof ApiError ? err : new ApiError(0, '요청에 실패했습니다')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [path, tick])

  return { data, error, loading, refetch: () => setTick((t) => t + 1) }
}
