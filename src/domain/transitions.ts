import type { IssueStatus, Priority } from '@/db/schema'
import { ruleViolation, type DomainError } from './result'

export const TRANSITIONS: Record<IssueStatus, readonly IssueStatus[]> = {
  inbox: ['backlog', 'rejected', 'on_hold'],
  backlog: ['in_progress', 'rejected', 'on_hold'],
  in_progress: ['done', 'backlog', 'on_hold'],
  on_hold: ['backlog', 'rejected'],
  done: ['backlog'], // reopen
  rejected: [],      // terminal
}

export type TransitionInput = { to: IssueStatus; priority?: Priority; reason?: string }
export type TransitionCheck =
  | { ok: true; priority: Priority | null }
  | DomainError

export function validateTransition(
  issue: { status: IssueStatus; priority: Priority | null },
  input: TransitionInput,
): TransitionCheck {
  if (!TRANSITIONS[issue.status].includes(input.to)) {
    return ruleViolation(`${issue.status} → ${input.to} 전이는 허용되지 않습니다`)
  }
  if (input.to === 'backlog') {
    const priority = input.priority ?? issue.priority
    if (!priority) return ruleViolation('백로그 진입에는 우선순위(P0/P1/P2)가 필요합니다')
    return { ok: true, priority }
  }
  if ((input.to === 'rejected' || input.to === 'on_hold') && !input.reason?.trim()) {
    return ruleViolation('반송/정박에는 사유가 필요합니다')
  }
  return { ok: true, priority: input.priority ?? issue.priority }
}
