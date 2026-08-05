import { expect, test } from '@playwright/test'
import {
  createIssue,
  createProduct,
  login,
  logout,
  transitionIssue,
  uniqueName,
} from './helpers'

test('keeps the terminal rejection expansion separated by a hairline border', async ({ page }) => {
  // Given: a request from the plain user that an admin has rejected.
  await login(page, 'admin')
  const productId = await createProduct(page, uniqueName('border-product'))
  await logout(page)

  await login(page, 'user')
  const issue = await createIssue(page, productId, uniqueName('terminal-row'))
  await logout(page)

  await login(page, 'admin')
  await transitionIssue(page, issue, { to: 'rejected', reason: 'E2E terminal row border' })
  await logout(page)

  // When: the requester opens My Requests and sees the terminal reason block.
  await login(page, 'user')
  await page.goto('/requests')
  const expansion = page.locator('.row-expand').filter({ hasText: `#${issue.id} 반송 사유` })

  // Then: design/rudder.css's row contract remains pinned at one pixel.
  await expect(expansion).toBeVisible()
  await expect(expansion).toHaveCSS('border-bottom-width', '1px')
})

test('shows the product rail entry only to admins', async ({ page }) => {
  // Given/When: a plain user opens the authenticated shell.
  await login(page, 'user')
  const productLink = page.getByRole('link', { name: '제품 관리' })

  // Then: the admin surface is absent for the plain user.
  await expect(productLink).toHaveCount(0)
  await logout(page)

  // When/Then: the same shell renders the product entry for an admin.
  await login(page, 'admin')
  await expect(productLink).toHaveCount(1)
})
