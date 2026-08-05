import { expect, test } from '@playwright/test'
import { login, uniqueName } from './helpers'

test('admin invites a crew member and the invitee sets a password through the link', async ({ page, browser }) => {
  await login(page, 'admin')
  await page.goto('/crew')

  const email = `${uniqueName('invite-flow')}@example.com`
  const name = 'E2E 초대 신입'

  await page.getByRole('button', { name: '초대' }).click()
  const createDialog = page.getByRole('dialog', { name: '선원 초대' })
  await createDialog.getByLabel('이메일').fill(email)
  await createDialog.getByLabel('이름').fill(name)
  await createDialog.getByRole('button', { name: '초대 생성' }).click()

  // The one-time link is only ever rendered here — read it directly from the
  // readOnly input rather than exercising the OS clipboard, which is flaky
  // under headless automation and isn't what this spec is proving.
  const resultDialog = page.getByRole('dialog', { name: '초대 결과' })
  const inviteUrl = await resultDialog.getByLabel('초대 링크').inputValue()
  await resultDialog.getByRole('button', { name: '닫기' }).click()

  // A fresh, cookie-less context — the invitee has never been to this app
  // and must not inherit the admin's session from `page`.
  const inviteeContext = await browser.newContext()
  const inviteePage = await inviteeContext.newPage()
  try {
    await inviteePage.goto(inviteUrl)
    await expect(inviteePage.getByRole('heading')).toContainText(name)
    await inviteePage.getByLabel('비밀번호').fill('invite-flow-new-password')
    await inviteePage.getByRole('button', { name: '비밀번호 설정' }).click()
    await expect(inviteePage).toHaveURL(/\/inbox$/)
  } finally {
    await inviteeContext.close()
  }
})
