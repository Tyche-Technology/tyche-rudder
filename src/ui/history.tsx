// Event-log rendering for the issue detail view (design doc §8). formatEvent
// is the pure translation from a frozen snake_case issue_events row into
// Korean display text, kept separate from the .log markup below so it's
// unit-testable without mounting anything.
import { PilotFlag } from './chips'
import { formatDateTime } from './format'
import { eventFieldLabel, statusValueLabel } from './labels'
import type { ApiEvent, ApiUser } from './types'

// Shared by history rows and the comment thread: an agent actor has no
// actorUserId at all, and `users` still loading (null) must render blank —
// never a false '사용자 #id' miss — same three-way rule as catalog-data.ts's
// nameOf.
export function actorDisplayName(
  actorType: 'user' | 'agent', actorUserId: number | null, users: ApiUser[] | null,
): string {
  if (actorType === 'agent') return '도선사'
  if (actorUserId === null || users === null) return ''
  return users.find((u) => u.id === actorUserId)?.name ?? `사용자 #${actorUserId}`
}

const priorityLabel = (v: string | null): string => (v === null ? '없음' : v.toUpperCase())

export function formatEvent(
  e: ApiEvent, users: ApiUser[] | null,
): { who: string; text: string; field: string } {
  return { who: actorDisplayName(e.actorType, e.actorUserId, users), text: eventText(e), field: e.field }
}

// Every field-name word below comes from eventFieldLabel (labels.ts §8's
// single owner of issue_events.field -> Korean) — never re-typed here, so a
// future vocabulary change can't drift between the two files.
function eventText(e: ApiEvent): string {
  switch (e.field) {
    case 'created': return eventFieldLabel('created')
    case 'status': return `${eventFieldLabel('status')} ${statusValueLabel(e.oldValue)} → ${statusValueLabel(e.newValue)}`
    case 'priority': return `${eventFieldLabel('priority')} ${priorityLabel(e.oldValue)} → ${priorityLabel(e.newValue)}`
    // Raw sortOrder is an internal float (domain/ordering.ts) — never shown.
    case 'sort_order': return `${eventFieldLabel('sort_order')} 변경`
    case 'reason': return `${eventFieldLabel('reason')} ${e.newValue === null ? '삭제' : '기록'}`
    case 'relation_added': return eventFieldLabel('relation_added')
    case 'relation_removed': return eventFieldLabel('relation_removed')
    default: return `${eventFieldLabel(e.field)} 변경`
  }
}

export function HistoryPanel({ events, users }: { events: ApiEvent[]; users: ApiUser[] | null }) {
  return (
    <div className="log">
      {events.map((e) => {
        const { who, text, field } = formatEvent(e, users)
        return (
          <div className="log__item" key={e.id}>
            <span className="log__rail"><span className="log__pip" /></span>
            <span>
              <span className="log__who">{who}</span> {text}
              {e.actorType === 'agent' ? <PilotFlag /> : null}{' '}
              <span className="log__field">{field}</span>
            </span>
            <span className="mono faint">{formatDateTime(e.createdAt)}</span>
          </div>
        )
      })}
    </div>
  )
}
