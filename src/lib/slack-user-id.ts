// Slack user ids: `U…` for regular members, `W…` for Enterprise Grid members.
// Uppercase alphanumeric; Slack publishes no fixed length, so the bound is
// deliberately loose on shape and merely sane on size (M2 — a `text` column
// otherwise happily stores 10 KB).
//
// This lives on its own so both writer and consumer share one definition:
// src/app/(app)/crew/page.tsx validates admin input against it, and
// src/lib/slack.ts refuses to DM anything that fails it. It must not import
// db/domain — the crew screen is a UI module and cannot pull those in.
//
// ponytail: Slack tells apps to treat ids as opaque and publishes no character
// or length guarantee, so this charset is an assumption about ids as issued
// today (9-11 uppercase alnum), not a spec. The trade is deliberate — the
// alternative is leaking issue activity into a channel — but the ceiling is
// real: if Slack ever issues an id outside this shape, DMs to those users stop
// silently. Upgrade path if that happens: drop the charset check and keep only
// the `U`/`W` prefix, which is what actually separates a user from a channel.
const SLACK_USER_ID_RE = /^[UW][A-Z0-9]{6,64}$/

// Guards the `channel` argument of chat.postMessage. Slack accepts channel
// ids (C…), group ids (G…) and `#name` there just as readily as a user id, so
// a wrong-shaped value posts a user's issue activity into a conversation
// rather than failing — which is why the consumer checks, not just the form.
export function isSlackUserId(value: string | null | undefined): value is string {
  return typeof value === 'string' && SLACK_USER_ID_RE.test(value)
}
