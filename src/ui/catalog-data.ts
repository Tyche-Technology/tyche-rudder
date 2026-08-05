// The id -> name maps every view needs, plumbed straight through useApi —
// no caching beyond what useApi already does per mount. Boring on purpose:
// Tasks 7-10 all import this file.
import { useApi, type ApiError } from './api'
import type { ApiProduct, ApiUser, ApiMilestone } from './types'

// `error` must reach the caller: a swallowed catalog failure leaves `data`
// null forever, which reads as "still loading" — every name rendered off it
// silently stays blank with no way for the user to know or retry.
export function useProducts(): { products: ApiProduct[] | null; error: ApiError | null; refetch: () => void } {
  const { data, error, refetch } = useApi<ApiProduct[]>('/api/v1/products')
  return { products: data, error, refetch }
}

export function useUsers(): { users: ApiUser[] | null; error: ApiError | null; refetch: () => void } {
  const { data, error, refetch } = useApi<ApiUser[]>('/api/v1/users')
  return { users: data, error, refetch }
}

export function useMilestones(): { milestones: ApiMilestone[] | null; error: ApiError | null; refetch: () => void } {
  const { data, error, refetch } = useApi<ApiMilestone[]>('/api/v1/milestones')
  return { milestones: data, error, refetch }
}

// null id is unambiguous — nothing to look up regardless of whether the
// catalog has loaded, so it's always '미배정'. A real id while `rows` is
// still loading is NOT the same thing: it's an in-flight unknown, not a
// miss, so it returns `null` rather than the '미배정' fallback. Collapsing
// those two into one value used to make every row briefly claim a real
// product/requester was unassigned whenever the issues fetch resolved
// before the catalog fetch did — a normal-latency race, not an edge case.
// Callers must render the `null` case as nothing/a neutral placeholder,
// never as '미배정'.
export function nameOf<T extends { id: number; name: string }>(rows: T[] | null, id: number | null): string | null {
  if (id === null) return '미배정'
  if (rows === null) return null
  return rows.find((row) => row.id === id)?.name ?? '미배정'
}

// Options for an assignee picker. Suspended crew are dropped — updateIssue
// refuses them anyway, so offering one only produces a rejection — except the
// person currently assigned, who must stay so the <select> value still matches
// an option (an issue whose assignee was banned after assignment).
//
// This filter is the real control: only admins can set assigneeId at all, and
// only admins are sent `banned`, so the list can and does filter itself. The
// `!== true` (rather than `!u.banned`) is for the non-admin shape, where the
// field is absent — those screens render no picker, so it never matters.
export function assignableUsers(users: ApiUser[] | null, currentId: number | null): ApiUser[] {
  return (users ?? []).filter((u) => u.banned !== true || u.id === currentId)
}
