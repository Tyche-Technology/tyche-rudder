// @vitest-environment jsdom
// The three hooks render via @testing-library/react, same pattern as
// use-api.test.ts — only this file needs a DOM.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useProducts, useUsers, useMilestones, nameOf } from '@/ui/catalog-data'

describe('nameOf', () => {
  const rows = [{ id: 1, name: 'lpa-collected' }, { id: 2, name: 'partslink' }]

  it('returns the matching row name', () => {
    expect(nameOf(rows, 1)).toBe('lpa-collected')
  })

  it('returns 미배정 for a null id', () => {
    expect(nameOf(rows, null)).toBe('미배정')
  })

  it('returns null (not 미배정) for a real id while rows have not loaded yet', () => {
    expect(nameOf(null, 1)).toBeNull()
  })

  it('returns 미배정 for an id with no matching row once rows have loaded', () => {
    expect(nameOf(rows, 999)).toBe('미배정')
  })

  it('a null id wins over an unloaded catalog — always 미배정, never null', () => {
    expect(nameOf(null, null)).toBe('미배정')
  })
})

describe('useProducts / useUsers / useMilestones', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('useProducts fetches /api/v1/products and exposes refetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ ok: true, data: [{ id: 1, name: 'a' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useProducts())
    await waitFor(() => expect(result.current.products).toEqual([{ id: 1, name: 'a' }]))
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/products', expect.anything())
    expect(typeof result.current.refetch).toBe('function')
  })

  it('useUsers fetches /api/v1/users', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, data: [] }) })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useUsers())
    await waitFor(() => expect(result.current.users).toEqual([]))
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/users', expect.anything())
  })

  it('useMilestones fetches /api/v1/milestones and exposes refetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, data: [] }) })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useMilestones())
    await waitFor(() => expect(result.current.milestones).toEqual([]))
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/milestones', expect.anything())
    expect(typeof result.current.refetch).toBe('function')
  })

  // Each hook is asserted separately: they are three independent two-line
  // wrappers, and any one of them can individually regress back to
  // swallowing `error` without the others noticing.
  it('useProducts exposes the fetch error instead of swallowing it', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ ok: false, error: 'boom' }) })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useProducts())
    await waitFor(() => expect(result.current.error?.status).toBe(500))
    expect(result.current.products).toBeNull()
  })

  it('useUsers exposes the fetch error and a refetch to recover with', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ ok: false, error: 'boom' }) })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useUsers())
    await waitFor(() => expect(result.current.error?.status).toBe(500))
    expect(result.current.users).toBeNull()
    expect(typeof result.current.refetch).toBe('function')
  })

  it('useMilestones exposes the fetch error instead of swallowing it', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ ok: false, error: 'boom' }) })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useMilestones())
    await waitFor(() => expect(result.current.error?.status).toBe(500))
    expect(result.current.milestones).toBeNull()
  })
})
