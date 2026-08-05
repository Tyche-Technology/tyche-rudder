// Client-side per-product counts for the Inbox filter chips — there's no
// count endpoint, so this just reduces over whatever the page already fetched.
import type { ApiIssue } from './types'

export function countByProduct(issues: ApiIssue[]): Map<number, number> {
  const counts = new Map<number, number>()
  for (const issue of issues) {
    counts.set(issue.productId, (counts.get(issue.productId) ?? 0) + 1)
  }
  return counts
}
