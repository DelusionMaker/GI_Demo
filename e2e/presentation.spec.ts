import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** 演示模式：默认只留场景 / IBL / 白炉；技术模式恢复完整 HDR / 性能面板。 */
test('演示模式与技术模式可互相切换', async ({ page }) => {
  await page.goto('/d/hello-cube?scene=outdoor&speed=0&presentation=1')
  await expect(page.locator('canvas').first()).toBeVisible()

  const presentation = page.locator('[data-testid="presentation-controls"]')
  await expect(presentation).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('.panel:has-text("HDR 链路")')).toHaveCount(0)
  await expect(page.locator('.panel:has-text("逐 pass")')).toHaveCount(0)

  mkdirSync(join(process.cwd(), 'e2e', 'screenshots'), { recursive: true })
  await page.screenshot({ path: join(process.cwd(), 'e2e', 'screenshots', '12-presentation.png') })

  await page.locator('[data-testid="presentation-exit"]').click()
  await expect(page.locator('.panel:has-text("HDR 链路")')).toBeVisible({ timeout: 10_000 })
  await expect(presentation).toHaveCount(0)
})

test('pbr-ibl 页面默认户外 IBL + ACES', async ({ page }) => {
  await page.goto('/d/pbr-ibl')
  await expect(page.locator('canvas').first()).toBeVisible()
  await expect(page.locator('[data-testid="presentation-controls"]')).toBeVisible({ timeout: 10_000 })

  // 这两个 store 各自异步写 URL；轮询等它们都落盘。
  await expect
    .poll(() => new URL(page.url()).searchParams.get('scene'), { timeout: 10_000 })
    .toBe('outdoor')
  await expect.poll(() => new URL(page.url()).searchParams.get('env'), { timeout: 10_000 }).toBe('1')
  await expect.poll(() => new URL(page.url()).searchParams.get('tm'), { timeout: 10_000 }).toBe('aces')
})
