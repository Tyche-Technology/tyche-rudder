// Everything the user reads is in **KST**, regardless of where the browser
// thinks it is. This is a Korean team's internal tool: "언제 들어온 요청인가"
// only means something if everyone reads the same clock, so a laptop left on
// UTC while travelling must not shift every timestamp by nine hours.
//
// Scope: full timestamps (createdAt / updatedAt), which the API sends as UTC
// ISO strings. Milestone startsOn / endsOn are a different kind of value: a
// Postgres `date` column with no time or timezone component at all. The wire
// carries the bare "YYYY-MM-DD" the admin typed — see dateLabel below, and
// never run those through a timezone conversion (there is nothing to convert).
//
// The locale is load-bearing, not decoration: it fixes the numbering system
// to latn. A user-locale formatter would render ٠٧-٣١ under ar-EG and switch
// calendars entirely under fa-IR. hourCycle h23 is likewise deliberate — the
// ECMA-402 0–23 cycle, where hour12:false has historically produced "24:00"
// for midnight.
const KST = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

// ponytail: throws RangeError on an invalid Date, where the old string-slicing
// returned "NaN-NaN". Unreachable today — every call site passes a notNull
// `timestamp` column typed string. Add a guard only if a nullable timestamp
// ever reaches here; a throw inside render is a blank page, not a cosmetic bug.
function kstParts(instant: Date): Record<string, string> {
  return Object.fromEntries(KST.formatToParts(instant).map((p) => [p.type, p.value]))
}

export function shortDate(iso: string): string {
  const p = kstParts(new Date(iso))
  return `${p.month}-${p.day}`
}

export function formatDateTime(iso: string): string {
  const p = kstParts(new Date(iso))
  return `${p.month}-${p.day} ${p.hour}:${p.minute}`
}

// The KST calendar day an instant falls on, as UTC-midnight millis — the same
// shape dayMillis() gives a wire date, so the two are directly comparable.
// timeline.ts's "today" goes through here so the roadmap's ship position and
// D-day counts are computed on the day the viewer is reading about, not the
// day their browser's timezone happens to be in.
export function kstDayMillis(instant: Date): number {
  const p = kstParts(instant)
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day))
}

// A milestone date arrives as the calendar-day string the admin typed
// ("2026-07-25"). Display trims to MM-DD; there is nothing to convert.
export function dateLabel(date: string): string {
  return date.slice(5)
}

// Attachment sizes (ApiAttachment.sizeBytes) as a human-readable label.
// Everything under 10MB (attachments/route.ts's own cap) reads comfortably
// as bytes/KB/MB, so there is no GB tier to get right.
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}
