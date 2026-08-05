import { expect, test } from '@playwright/test'
import { createProduct, login, seedBacklogIssues, uniqueName } from './helpers'

test('clears the drop indicator when a drag leaves the backlog column', async ({ page }) => {
  // Given: three real backlog issues rendered by a production server.
  await login(page, 'admin')
  const productName = uniqueName('drag-product')
  const productId = await createProduct(page, productName)
  await seedBacklogIssues(page, productId, 3)
  await page.goto('/board')
  await page.locator('.filters .fchip').filter({ hasText: productName }).click()

  const backlog = page.getByRole('region', { name: '선적 대기' })
  const body = backlog.locator('.col__body')
  const cards = body.locator('[data-issue-id]')
  await expect(cards).toHaveCount(3)

  // When: Playwright first proves native HTML5 reorder works end to end.
  const initialIds = await cards.evaluateAll((elements) =>
    elements.map((element) => Number(element.getAttribute('data-issue-id'))),
  )
  const sourceId = initialIds[0]
  const targetId = initialIds.at(-1)
  if (sourceId === undefined || targetId === undefined) throw new Error('backlog card ids are unavailable')
  const reorderSource = body.locator(`[data-issue-id="${sourceId}"]`)
  const reorderTarget = body.locator(`[data-issue-id="${targetId}"]`)
  const lastBox = await reorderTarget.boundingBox()
  if (!lastBox) throw new Error('backlog reorder target geometry is unavailable')
  const reorderResponse = page.waitForResponse(
    (response) => response.request().method() === 'POST' && /\/api\/v1\/issues\/\d+\/reorder$/.test(response.url()),
  )
  await reorderSource.dragTo(reorderTarget, {
    targetPosition: { x: lastBox.width / 2, y: lastBox.height - 2 },
  })
  expect((await reorderResponse).ok()).toBe(true)
  await expect.poll(async () => {
    const currentIds = await cards.evaluateAll((elements) =>
      elements.map((element) => Number(element.getAttribute('data-issue-id'))),
    )
    return currentIds.join(',')
  }).not.toBe(initialIds.join(','))

  // When: a second drag enters the column, then leaves it without dropping.
  const sourceBox = await cards.first().boundingBox()
  const bodyBox = await body.boundingBox()
  if (!sourceBox || !bodyBox) throw new Error('backlog drag geometry is unavailable')

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  try {
    await page.mouse.move(sourceBox.x + sourceBox.width / 2 + 20, sourceBox.y + sourceBox.height / 2 + 20, { steps: 5 })
    await page.mouse.move(bodyBox.x + bodyBox.width / 2, bodyBox.y + bodyBox.height - 8, { steps: 10 })
    await expect(body.locator('.drop')).toBeVisible()

    await page.mouse.move(1, 1, { steps: 10 })

    // Then: no stale drop affordance remains outside the column.
    await expect(page.locator('.drop')).toHaveCount(0)
  } finally {
    await page.mouse.up()
  }
})
