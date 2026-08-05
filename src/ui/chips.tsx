// Status/priority/type/pilot markup, lifted from design/index.html §2-3 —
// wrap each in a component once so the enum→(label, flag, colour) mapping
// exists in exactly one place (design doc §10).
import { STATUS_LABEL, STATUS_CHIP, STATUS_FLAG, TYPE_LABEL } from './labels'
import type { IssueStatus, IssueType, Priority } from './types'

// Three signals per status: flag colour, flag pattern (via STATUS_FLAG's
// CSS), and the paired Korean/English label — never colour alone (design §7).
export function StatusChip({ status }: { status: IssueStatus }) {
  const label = STATUS_LABEL[status]
  return (
    <span className={`chip ${STATUS_CHIP[status]}`}>
      <span className={`flag ${STATUS_FLAG[status]}`} aria-hidden="true" />
      {label.ko}
      <span className="chip__en">{label.en}</span>
    </span>
  )
}

// Priority is text-first; only P0 is chromatic. No priority yet (Inbox, pre-
// grooming) renders as ptag--p2 styling with '미정' instead of a P-code
// (design/04-my-requests.html).
export function PriorityTag({ priority }: { priority: Priority | null }) {
  if (priority === null) return <span className="ptag ptag--p2">미정</span>
  return <span className={`ptag ptag--${priority}`}>{priority.toUpperCase()}</span>
}

// Type carries no colour of its own — glyph + neutral pill (design §3).
export function TypeTag({ type }: { type: IssueType }) {
  const { glyph, ko } = TYPE_LABEL[type]
  return (
    <span className="ttag">
      <span className="ttag__g">{glyph}</span>{ko}
    </span>
  )
}

// ICS "H", pilot aboard — marks the 도선사 agent as the acting party next to
// a requester name or on a created history row. Reserved for that actor;
// not a status.
export function PilotFlag() {
  return <span className="flag flag--pilot" aria-hidden="true" title="도선사(슬랙 봇)가 대신 등록" />
}
