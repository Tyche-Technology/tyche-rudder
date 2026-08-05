import { eq } from 'drizzle-orm'
import { users, type Issue, type IssueStatus } from '@/db/schema'
import type { Db } from '@/db/client'
import { isSlackUserId } from '@/lib/slack-user-id'
import { errorType } from '@/lib/error-summary'

const STATUS_LABEL: Record<IssueStatus, string> = {
  inbox: '입항 대기', backlog: '선적 대기', in_progress: '항해 중',
  done: '배송 완료', rejected: '반송', on_hold: '정박',
}

async function post(channel: string, text: string): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN
  if (!token) return // notifications are optional wiring, never a failure path
  try {
    const endpoint = process.env.RUDDER_E2E === 'true'
      ? 'http://127.0.0.1:3299/chat.postMessage'
      : 'https://slack.com/api/chat.postMessage'
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ channel, text }),
    })
    const body = await res.json().catch(() => null)
    if (!body?.ok) console.error('slack_notify_failed', { status: res.status })
  } catch (error) {
    console.error('slack_notify_failed', { errorType: errorType(error) })
  }
}

function issueUrl(id: number): string {
  return `${process.env.APP_BASE_URL ?? ''}/issues/${id}`
}

// Fire-and-forget: called AFTER the mutation committed; a Slack outage must
// never fail the API response (annotate-don't-block). No outbox by design.
export function notifyNewIssue(issue: Issue): void {
  const channel = process.env.SLACK_CHANNEL_ID
  if (!channel) return
  void post(channel, `⚓ 새 이슈 #${issue.id} ${issue.title}\n${issueUrl(issue.id)}`)
}

export function notifyStatusChange(db: Db, issue: Issue, from: IssueStatus): void {
  void (async () => {
    const [requester] = await db.select({ slackUserId: users.slackUserId })
      .from(users).where(eq(users.id, issue.requesterId))
    if (!requester?.slackUserId) return // unmapped → silently no DM
    // Shape-checked too: `channel` accepts channel and group ids, so a
    // non-user-id value here would publish the issue into a conversation
    // instead of DMing one person (the crew screen's own check is bypassable
    // via better-auth's admin/update-user). Logged, unlike the unmapped case:
    // a mistyped id is an admin mistake to fix, not a user who opted out.
    if (!isSlackUserId(requester.slackUserId)) {
      console.error(`slack notify skipped: user ${issue.requesterId} has a slackUserId that is not a user id`)
      return
    }
    await post(requester.slackUserId,
      `#${issue.id} ${issue.title}: ${STATUS_LABEL[from]} → ${STATUS_LABEL[issue.status]}\n${issueUrl(issue.id)}`)
  })().catch((error) => console.error('slack_notify_failed', { errorType: errorType(error) }))
}
