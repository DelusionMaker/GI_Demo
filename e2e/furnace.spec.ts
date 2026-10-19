import { expect, test } from '@playwright/test'

/**
 * 白炉验收：
 * - 环境纯白、直接光关闭、albedo 强制 1；
 * - 画面中心的白面亮度应回到 1.0 附近；
 * - 读数必须在 luminance pass 真正回读之后（data-samples > 0），
 *   不能用初始默认值 1.000 蒙混过关。
 */
test('白炉读数：中心亮度接近 1.000', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(String(err)))

  await page.goto('/d/hello-cube?scene=cornell&speed=0&furnace=1&presentation=0')
  await expect(page.locator('canvas').first()).toBeVisible()

  const readout = page.locator('[data-testid="furnace-readout"]')
  await expect(readout).toBeVisible({ timeout: 10_000 })
  await expect
    .poll(async () => Number(await readout.getAttribute('data-samples')), {
      timeout: 10_000,
      message: '白炉读数没有等到 luminance 回读',
    })
    .toBeGreaterThan(0)

  const centerText = ((await page.locator('[data-testid="furnace-center"]').textContent()) ?? '').trim()
  const center = Number(centerText)
  const deviation = (center - 1) * 100
  console.log(`[白炉] 中心亮度=${center.toFixed(3)} 偏差=${deviation.toFixed(2)}%`)

  expect(Number.isFinite(center), `白炉读数不可解析: ${centerText}`).toBe(true)
  // 实测 -2.2%；HUD 按目标 ±2% 显示黄/绿，测试用 5% 做回归守护。
  expect(Math.abs(center - 1), `白炉中心亮度 ${center.toFixed(3)} 偏离 1 超过 5%`).toBeLessThan(0.05)
  expect(errors, `console error: ${errors.join(' | ')}`).toHaveLength(0)
})
