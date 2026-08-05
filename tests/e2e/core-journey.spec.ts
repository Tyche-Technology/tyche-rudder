import { expect, test } from '@playwright/test'
import { z } from 'zod'
import {
  E2E_CHANNEL,
  E2E_BASE_URL,
  E2E_USERS,
  E2E_USER_SLACK_ID,
  createIssue,
  createProduct,
  login,
  logout,
  resetSlackCaptures,
  sessionHeaders,
  slackCaptures,
  transitionIssue,
  uniqueName,
} from './helpers'

test('ships a request from intake through an assigned in-progress voyage', async ({ page }) => {
  // Given: an admin-created product and an existing backlog anchor.
  await login(page, 'admin')
  const productName = uniqueName('journey-product')
  const productId = await createProduct(page, productName)
  const anchor = await createIssue(page, productId, uniqueName('journey-anchor'))
  await transitionIssue(page, anchor, { to: 'backlog', priority: 'p2' })
  await logout(page)

  // When: the Slack-mapped requester creates the journey issue through the UI.
  await login(page, 'user')
  await resetSlackCaptures(page.request)
  const issueTitle = uniqueName('실제 여정')
  await page.getByRole('button', { name: '새 이슈' }).click()
  const issueDialog = page.getByRole('dialog', { name: '새 이슈' })
  await issueDialog.getByLabel('제목').fill(issueTitle)
  await issueDialog.getByLabel('제품').selectOption({ label: productName })
  await issueDialog.getByLabel('설명').fill('실제 Postgres와 production build를 지나는 요청입니다.')
  await issueDialog.getByRole('button', { name: '등록', exact: true }).click()
  await expect(page).toHaveURL(/\/issues\/\d+$/)
  const issueId = z.coerce.number().int().positive().parse(new URL(page.url()).pathname.split('/').at(-1))

  await expect.poll(async () => {
    const captures = await slackCaptures(page.request)
    return captures.some((capture) => capture.channel === E2E_CHANNEL && capture.text.includes(`#${issueId} `))
  }).toBe(true)

  // When: an admin grooms the request into backlog with a priority.
  await logout(page)
  await login(page, 'admin')
  await page.goto('/inbox')
  const inboxRow = page.locator('.row').filter({ hasText: issueTitle })
  await inboxRow.getByRole('button', { name: '통관' }).click()
  await page.getByRole('radio', { name: 'P1' }).click()
  await page.getByRole('button', { name: 'P1으로 통관' }).click()
  await expect(inboxRow).toHaveCount(0)

  // When/Then: the real reorder endpoint moves it above the anchor with no UI error.
  await page.goto('/board')
  const backlog = page.getByRole('region', { name: '선적 대기' })
  const journeyCard = backlog.locator(`[data-issue-id="${issueId}"]`)
  const anchorCard = backlog.locator(`[data-issue-id="${anchor.id}"]`)
  await expect(journeyCard).toBeVisible()
  await journeyCard.dragTo(anchorCard, { targetPosition: { x: 12, y: 1 } })
  await expect.poll(async () => {
    const ids = await backlog.locator('[data-issue-id]').evaluateAll((cards) =>
      cards.map((card) => Number(card.getAttribute('data-issue-id'))),
    )
    return ids.indexOf(issueId) < ids.indexOf(anchor.id)
  }).toBe(true)
  await expect(page.getByText('순서를 저장하지 못했습니다')).toHaveCount(0)

  // When: the admin creates a date-only milestone through the roadmap UI.
  const milestoneName = uniqueName('2026 Q3 E2E')
  await page.goto('/roadmap')
  await page.getByRole('button', { name: '마일스톤 추가' }).click()
  const milestoneDialog = page.getByRole('dialog', { name: '마일스톤 추가' })
  await milestoneDialog.getByLabel('이름').fill(milestoneName)
  await milestoneDialog.getByLabel('시작일').fill('2026-08-03')
  await milestoneDialog.getByLabel('종료일').fill('2026-09-30')
  await milestoneDialog.getByRole('button', { name: '저장' }).click()
  await expect(page.getByRole('heading', { name: milestoneName })).toBeVisible()

  // When: issue detail assigns the milestone and owner, then starts the voyage.
  await page.goto(`/issues/${issueId}`)
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith(`/api/v1/issues/${issueId}`)
      && response.request().method() === 'PATCH' && response.ok()),
    page.getByLabel('마일스톤').selectOption({ label: milestoneName }),
  ])
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith(`/api/v1/issues/${issueId}`)
      && response.request().method() === 'PATCH' && response.ok()),
    page.getByLabel('담당자').selectOption({ label: E2E_USERS.admin.name }),
  ])
  // notifyStatusChange fires a requester DM on every transition, and the
  // 통관 step above already sent one — reset captures immediately before
  // this transition so the DM check below can only be caused by it, not by
  // 통관's. (Channel notification only fires once, on issue creation, and
  // was already proven above; it isn't re-checked here on purpose.)
  await resetSlackCaptures(page.request)
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith(`/api/v1/issues/${issueId}/transition`)
      && response.request().method() === 'POST' && response.ok()),
    page.getByRole('button', { name: '항해 시작' }).click(),
  ])

  // Then: the UI reflects the completed journey and the requester DM for
  // *this* transition landed.
  await expect(page.locator('.chip--progress').first()).toContainText('항해 중')
  await expect(page.getByRole('button', { name: '배송 완료' })).toBeVisible()
  await expect.poll(async () => {
    const captures = (await slackCaptures(page.request))
      .filter((capture) => capture.text.includes(`#${issueId} `))
    return captures.some((capture) => capture.channel === E2E_USER_SLACK_ID)
  }).toBe(true)
})

test('uploads and downloads a real PNG from issue detail', async ({ page }) => {
  await login(page, 'admin')
  const productId = await createProduct(page, uniqueName('upload-product'))
  await logout(page)
  await login(page, 'user')
  const issue = await createIssue(page, productId, uniqueName('upload-issue'))
  await page.goto(`/issues/${issue.id}`)

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nGQAAAAASUVORK5CYII=', 'base64')
  await page.getByLabel('파일 선택').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: png })
  await page.getByRole('button', { name: '업로드' }).click()
  const link = page.getByRole('link', { name: 'pixel.png' })
  const href = await link.getAttribute('href')
  if (href === null) throw new Error('attachment link is missing href')

  const response = await page.request.get(href, { headers: await sessionHeaders(page) })
  expect(response.status()).toBe(200)
  expect(response.headers()['content-disposition']).toContain('attachment')
  expect(response.headers()['x-content-type-options']).toBe('nosniff')
  expect(await response.body()).toEqual(png)
})

test('serializes concurrent attachment limits on real Postgres', async ({ page }) => {
  await login(page, 'admin')
  const productId = await createProduct(page, uniqueName('quota-product'))
  await logout(page)
  await login(page, 'user')
  const issue = await createIssue(page, productId, uniqueName('quota-issue'))
  const headers = await sessionHeaders(page)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nGQAAAAASUVORK5CYII=', 'base64')

  const responses = await Promise.all(Array.from({ length: 25 }, (_, index) => page.request.post(
    `/api/v1/issues/${issue.id}/attachments`,
    { headers, multipart: { file: { name: `${index}.png`, mimeType: 'image/png', buffer: png } } },
  )))
  const statuses = responses.map((response) => response.status())
  expect(statuses.filter((status) => status === 201)).toHaveLength(20)
  expect(statuses.filter((status) => status === 422)).toHaveLength(5)

  const detail = await page.request.get(`/api/v1/issues/${issue.id}`, { headers })
  expect(detail.status()).toBe(200)
  expect(z.object({ data: z.object({ attachments: z.array(z.unknown()) }) })
    .parse(JSON.parse(await detail.text())).data.attachments).toHaveLength(20)
})

test('serves browser hardening headers and blocks invite session swaps', async ({ page }) => {
  const pageResponse = await page.request.get('/login')
  expect(pageResponse.headers()['x-content-type-options']).toBe('nosniff')
  expect(pageResponse.headers()['x-frame-options']).toBe('DENY')
  expect(pageResponse.headers()['content-security-policy']).toContain("frame-ancestors 'none'")

  const crossOrigin = await page.request.post('/api/v1/invites/accept', {
    headers: { origin: 'https://evil.example.com' },
    data: { token: 'a'.repeat(64), password: 'fresh-anchor-99' },
  })
  expect(crossOrigin.status()).toBe(403)
  const wrongType = await page.request.post('/api/v1/invites/accept', {
    headers: { origin: E2E_BASE_URL, 'content-type': 'text/plain' },
    data: JSON.stringify({ token: 'a'.repeat(64), password: 'fresh-anchor-99' }),
  })
  expect(wrongType.status()).toBe(415)
})
