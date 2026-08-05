import { describe, it, expect } from 'vitest'
import {
  STATUS_LABEL,
  STATUS_CHIP,
  STATUS_FLAG,
  TYPE_LABEL,
  RELATION_LABEL,
  EVENT_FIELD_LABEL,
  eventFieldLabel,
  statusValueLabel,
} from '@/ui/labels'
import type { IssueStatus, IssueType } from '@/ui/types'

// Iterate the enum's literal values (not Object.keys of the record under
// test) so a status/type/field added to the type but never given a label
// fails here instead of silently rendering undefined in the UI.
const STATUSES: IssueStatus[] = ['inbox', 'backlog', 'in_progress', 'done', 'rejected', 'on_hold']
const TYPES: IssueType[] = ['bug', 'feature', 'improvement']
const RELATION_KINDS = ['duplicate', 'relates', 'blocks'] as const
const EVENT_FIELDS = [
  'created', 'status', 'priority', 'reason', 'title', 'description', 'type',
  'product_id', 'assignee_id', 'milestone_id', 'sort_order',
  'relation_added', 'relation_removed',
] as const

describe('STATUS_LABEL', () => {
  it('has a ko/en pair for every status, matching the design copy deck', () => {
    for (const status of STATUSES) expect(STATUS_LABEL[status]).toBeDefined()
    expect(STATUS_LABEL).toEqual({
      inbox: { ko: '입항 대기', en: 'Inbox' },
      backlog: { ko: '선적 대기', en: 'Backlog' },
      in_progress: { ko: '항해 중', en: 'In Progress' },
      done: { ko: '배송 완료', en: 'Done' },
      rejected: { ko: '반송', en: 'Rejected' },
      on_hold: { ko: '정박', en: 'On Hold' },
    })
  })
})

describe('STATUS_CHIP / STATUS_FLAG', () => {
  it('maps every status to its rudder.css chip and flag class', () => {
    for (const status of STATUSES) {
      expect(STATUS_CHIP[status]).toEqual(expect.any(String))
      expect(STATUS_FLAG[status]).toEqual(expect.any(String))
    }
    expect(STATUS_CHIP).toEqual({
      inbox: 'chip--inbox',
      backlog: 'chip--backlog',
      in_progress: 'chip--progress',
      done: 'chip--done',
      rejected: 'chip--rejected',
      on_hold: 'chip--hold',
    })
    expect(STATUS_FLAG).toEqual({
      inbox: 'flag--inbox',
      backlog: 'flag--backlog',
      in_progress: 'flag--progress',
      done: 'flag--done',
      rejected: 'flag--rejected',
      on_hold: 'flag--hold',
    })
  })
})

describe('TYPE_LABEL', () => {
  it('has a glyph/ko pair for every issue type', () => {
    for (const type of TYPES) expect(TYPE_LABEL[type]).toBeDefined()
    expect(TYPE_LABEL).toEqual({
      bug: { glyph: '▲', ko: '버그' },
      feature: { glyph: '＋', ko: '기능' },
      improvement: { glyph: '↑', ko: '개선' },
    })
  })
})

describe('RELATION_LABEL', () => {
  it('has an entry for every relation kind, left untranslated per the mockup', () => {
    for (const kind of RELATION_KINDS) expect(RELATION_LABEL[kind]).toBe(kind)
  })
})

describe('EVENT_FIELD_LABEL / eventFieldLabel', () => {
  it('has a Korean label for every frozen issue_events.field value, and no extras', () => {
    for (const field of EVENT_FIELDS) expect(EVENT_FIELD_LABEL[field]).toEqual(expect.any(String))
    expect(Object.keys(EVENT_FIELD_LABEL).sort()).toEqual([...EVENT_FIELDS].sort())
  })

  it('eventFieldLabel returns the mapped label on a hit', () => {
    expect(eventFieldLabel('status')).toBe('상태')
    expect(eventFieldLabel('sort_order')).toBe('백로그 순서')
  })

  it('eventFieldLabel passes an unknown field through unchanged', () => {
    expect(eventFieldLabel('unknown_x')).toBe('unknown_x')
  })
})

describe('statusValueLabel', () => {
  it('maps a status enum value to its Korean label', () => {
    expect(statusValueLabel('in_progress')).toBe('항해 중')
    expect(statusValueLabel('backlog')).toBe('선적 대기')
  })

  it('passes non-status values through unchanged', () => {
    expect(statusValueLabel('p0')).toBe('p0')
    expect(statusValueLabel('some free text')).toBe('some free text')
  })
})
