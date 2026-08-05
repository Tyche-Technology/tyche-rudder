// Single source for design-doc §8 vocabulary. issue_events.field is frozen
// snake_case (Phase 1 obligation) — this file is the one place the Korean
// translation lives; do not spell out status/type/field copy anywhere else.
import type { IssueStatus, IssueType } from './types'

export const STATUS_LABEL: Record<IssueStatus, { ko: string; en: string }> = {
  inbox: { ko: '입항 대기', en: 'Inbox' },
  backlog: { ko: '선적 대기', en: 'Backlog' },
  in_progress: { ko: '항해 중', en: 'In Progress' },
  done: { ko: '배송 완료', en: 'Done' },
  rejected: { ko: '반송', en: 'Rejected' },
  on_hold: { ko: '정박', en: 'On Hold' },
}

export const STATUS_CHIP: Record<IssueStatus, string> = {
  inbox: 'chip--inbox',
  backlog: 'chip--backlog',
  in_progress: 'chip--progress',
  done: 'chip--done',
  rejected: 'chip--rejected',
  on_hold: 'chip--hold',
}

export const STATUS_FLAG: Record<IssueStatus, string> = {
  inbox: 'flag--inbox',
  backlog: 'flag--backlog',
  in_progress: 'flag--progress',
  done: 'flag--done',
  rejected: 'flag--rejected',
  on_hold: 'flag--hold',
}

export const TYPE_LABEL: Record<IssueType, { glyph: string; ko: string }> = {
  bug: { glyph: '▲', ko: '버그' },
  feature: { glyph: '＋', ko: '기능' },
  improvement: { glyph: '↑', ko: '개선' },
}

// Mono, untranslated per the mockup (design/05-issue.html .rel__kind).
export const RELATION_LABEL: Record<'duplicate' | 'relates' | 'blocks', string> = {
  duplicate: 'duplicate',
  relates: 'relates',
  blocks: 'blocks',
}

export const EVENT_FIELD_LABEL: Record<string, string> = {
  created: '등록',
  status: '상태',
  priority: '우선순위',
  reason: '사유',
  title: '제목',
  description: '설명',
  type: '유형',
  product_id: '제품',
  assignee_id: '담당자',
  milestone_id: '마일스톤',
  sort_order: '백로그 순서',
  relation_added: '관계 추가',
  relation_removed: '관계 해제',
}

// Miss = the raw field, not a placeholder: the frozen vocabulary may still
// grow in later phases, and an unmapped field should stay greppable rather
// than disappear behind "undefined".
export function eventFieldLabel(field: string): string {
  return EVENT_FIELD_LABEL[field] ?? field
}

// For history old→new rendering: translate a status enum value, pass any
// other field's raw value (title text, a product id, a priority code)
// through unchanged. null (e.g. the "created" event's oldValue) renders as
// nothing rather than the literal string "null".
export function statusValueLabel(v: string | null): string {
  if (v === null) return ''
  return STATUS_LABEL[v as IssueStatus]?.ko ?? v
}
