// Domain errors carry an explicit routing kind so the HTTP layer (respond.ts
// KIND_STATUS) never has to infer status from Korean user-facing prose.
export type ErrorKind = 'not_found' | 'conflict' | 'rule'
export type DomainError = { ok: false; kind: ErrorKind; error: string }

export const notFound = (error: string): DomainError => ({ ok: false, kind: 'not_found', error })
export const conflict = (error: string): DomainError => ({ ok: false, kind: 'conflict', error })
export const ruleViolation = (error: string): DomainError => ({ ok: false, kind: 'rule', error })

// Lives here (not issues.ts) so ordering.ts can use it without importing
// from issues.ts — issues.ts already imports ordering.ts's
// backlogEntrySortOrder, and the reverse edge just to reach one string was
// an avoidable cycle. Re-exported from issues.ts below for existing callers.
export const CONFLICT_ERROR = '다른 사용자가 먼저 이 이슈를 변경했습니다. 새로 고침 후 다시 시도해주세요'
