import { randomUUID } from 'node:crypto'
import { expect, type APIRequestContext, type APIResponse, type Page } from '@playwright/test'
import { z } from 'zod'

export const E2E_BASE_URL = 'http://127.0.0.1:3200'
export const E2E_SLACK_URL = 'http://127.0.0.1:3299'
export const E2E_CHANNEL = 'C_E2E_CHANNEL'
// Must be a real Slack user-id shape (U/W + uppercase alnum) — src/lib/slack.ts
// refuses to DM anything else, so an underscore here silently kills the
// notification this suite asserts on.
export const E2E_USER_SLACK_ID = 'U0E2EUSER01'

export const E2E_USERS = {
  admin: { email: 'e2e-admin@example.com', name: 'E2E 관리자', password: 'rudder-e2e-admin' },
  user: { email: 'e2e-user@example.com', name: 'E2E 사용자', password: 'rudder-e2e-user' },
} as const

export const E2E_ENV = {
  DATABASE_URL: 'postgres://rudder:rudder@127.0.0.1:5435/rudder',
  BETTER_AUTH_SECRET: 'rudder-e2e-session-secret-at-least-32-characters',
  // Must equal E2E_BASE_URL exactly: actorFromRequest's trusted-origin guard
  // trusts BETTER_AUTH_URL (falling back to the request's own derived origin
  // only when unset) — leaving it unset here would make every state-changing
  // /api/v1/* request in this suite 401, the same production trap this var
  // exists to close.
  BETTER_AUTH_URL: E2E_BASE_URL,
  // better-auth's built-in sign-in rate limit (3 requests/10s, enabled by
  // default in production — see src/lib/better-auth.ts) is a real
  // anti-brute-force control, not a bug, but this suite logs in/out several
  // times per spec as different roles, easily bursting past it. This is the
  // one explicit, e2e-only opt-out; unset everywhere else, including a real
  // deploy.
  DISABLE_AUTH_RATE_LIMIT: 'true',
  SLACK_BOT_TOKEN: 'e2e',
  SLACK_CHANNEL_ID: E2E_CHANNEL,
  APP_BASE_URL: E2E_BASE_URL,
  OBJECT_STORE_BACKEND: 'fs',
  NEXT_TELEMETRY_DISABLED: '1',
} as const

const productSchema = z.object({ id: z.number().int().positive(), name: z.string() })
const issueSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  status: z.enum(['inbox', 'backlog', 'in_progress', 'done', 'rejected', 'on_hold']),
  version: z.number().int().nonnegative(),
})
const slackCaptureSchema = z.object({ channel: z.string(), text: z.string() })

export type E2EIssue = Readonly<z.infer<typeof issueSchema>>
export type SlackCapture = Readonly<z.infer<typeof slackCaptureSchema>>

type TransitionInput =
  | { readonly to: 'backlog'; readonly priority: 'p0' | 'p1' | 'p2' }
  | { readonly to: 'rejected'; readonly reason: string }

async function responseData<T>(response: APIResponse, schema: z.ZodType<T>): Promise<T> {
  await expect(response).toBeOK()
  const envelope = z.object({ ok: z.literal(true), data: schema })
    .parse(JSON.parse(await response.text()))
  return envelope.data
}

export function uniqueName(prefix: string): string {
  return `${prefix}-${randomUUID()}`
}

export async function login(page: Page, account: keyof typeof E2E_USERS): Promise<void> {
  const user = E2E_USERS[account]
  await page.goto('/login')
  await page.getByLabel('이메일').fill(user.email)
  await page.getByLabel('비밀번호').fill(user.password)
  await page.getByRole('button', { name: '로그인', exact: true }).click()
  await expect(page).toHaveURL(/\/inbox$/)
}

export async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: '로그아웃' }).click()
  await expect(page).toHaveURL(/\/login$/)
}

export async function sessionHeaders(page: Page): Promise<{ readonly cookie: string; readonly origin: string }> {
  const session = (await page.context().cookies()).find((cookie) => cookie.name === 'better-auth.session_token')
  if (!session) throw new Error('authenticated browser session cookie is missing')
  // `page.request` is an out-of-process HTTP client, not the real browser
  // network stack — it never sends an Origin header on its own. Without one,
  // actorFromRequest's trusted-origin guard fail-closes every cookie-bearing
  // call this helper makes (GETs don't strictly need it — SAFE_METHODS
  // short-circuit the guard — but sending it unconditionally keeps this one
  // helper the single source of truth for "how to call the API as this
  // session" instead of splitting that by method).
  return { cookie: `${session.name}=${session.value}`, origin: E2E_BASE_URL }
}

export async function createProduct(page: Page, name: string): Promise<number> {
  const response = await page.request.post('/api/v1/products', {
    headers: await sessionHeaders(page),
    data: { name },
  })
  return (await responseData(response, productSchema)).id
}

export async function createIssue(
  page: Page,
  productId: number,
  title: string,
): Promise<E2EIssue> {
  const response = await page.request.post('/api/v1/issues', {
    headers: await sessionHeaders(page),
    data: { title, description: 'Playwright production journey', type: 'bug', productId },
  })
  return responseData(response, issueSchema)
}

export async function transitionIssue(
  page: Page,
  issue: E2EIssue,
  input: TransitionInput,
): Promise<E2EIssue> {
  const response = await page.request.post(`/api/v1/issues/${issue.id}/transition`, {
    headers: await sessionHeaders(page),
    data: { ...input, expectedVersion: issue.version },
  })
  return responseData(response, issueSchema)
}

export async function seedBacklogIssues(
  page: Page,
  productId: number,
  count: number,
): Promise<readonly E2EIssue[]> {
  const seeded: E2EIssue[] = []
  for (let index = 0; index < count; index += 1) {
    const issue = await createIssue(page, productId, uniqueName(`drag-${index + 1}`))
    seeded.push(await transitionIssue(page, issue, { to: 'backlog', priority: 'p1' }))
  }
  return seeded
}

export async function resetSlackCaptures(request: APIRequestContext): Promise<void> {
  await expect(await request.delete(`${E2E_SLACK_URL}/__captures`)).toBeOK()
}

export async function slackCaptures(request: APIRequestContext): Promise<readonly SlackCapture[]> {
  const response = await request.get(`${E2E_SLACK_URL}/__captures`)
  await expect(response).toBeOK()
  return z.array(slackCaptureSchema).parse(JSON.parse(await response.text()))
}
