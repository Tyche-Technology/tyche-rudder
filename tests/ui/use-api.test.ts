// @vitest-environment jsdom
// useApi renders a real hook via @testing-library/react, so this file (only
// this file) needs a DOM. api.test.ts and every other ui/domain/lib test
// stays on vitest.config.ts's default node environment.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useApi, ApiError } from '@/ui/api'

describe('useApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('settles data and loading on a successful fetch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data: { id: 1 } }),
    }))
    const { result } = renderHook(() => useApi<{ id: number }>('/api/v1/issues/1'))
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual({ id: 1 })
    expect(result.current.error).toBeNull()
  })

  it('settles an ApiError on a failed fetch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ ok: false, error: '규칙 위반' }),
    }))
    const { result } = renderHook(() => useApi('/api/v1/issues/1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeInstanceOf(ApiError)
    expect(result.current.error?.message).toBe('규칙 위반')
    expect(result.current.data).toBeNull()
  })

  it('does not fetch and is not loading when path is null', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useApi(null))
    expect(result.current.loading).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // Regression for the stuck-loading bug: path starts non-null (fetch in
  // flight, loading=true), then flips to null before that fetch resolves.
  // The old code's `if (path === null) return` abandoned loading=true
  // forever instead of settling it — this hangs (times out) against that code.
  it('settles loading when path transitions from non-null to null mid-flight', async () => {
    let resolveFetch!: (value: unknown) => void
    const pending = new Promise((resolve) => { resolveFetch = resolve })
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(pending))

    const { result, rerender } = renderHook(
      ({ path }: { path: string | null }) => useApi(path),
      { initialProps: { path: '/api/v1/issues/1' as string | null } },
    )
    expect(result.current.loading).toBe(true)

    rerender({ path: null })
    await waitFor(() => expect(result.current.loading).toBe(false))

    // The abandoned fetch resolving afterward must not resurrect state.
    resolveFetch({ ok: true, status: 200, json: async () => ({ ok: true, data: 'late' }) })
    await new Promise((r) => setTimeout(r, 0))
    expect(result.current.data).toBeNull()
  })

  it('refetch() re-runs the fetch', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, data: 1 }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, data: 2 }) })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useApi<number>('/api/v1/count'))
    await waitFor(() => expect(result.current.data).toBe(1))

    act(() => result.current.refetch())
    await waitFor(() => expect(result.current.data).toBe(2))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
