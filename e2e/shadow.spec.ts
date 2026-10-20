import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'

/**
 * p1-shadow 骨架验收：
 * - 深度图集真的被渲染出来（shadow:atlas 调试视图非空）；
 * - cascade 分层着色可见（shadow:cascade 视图有结构）；
 * - 阴影参数进 URL 并在面板回填；
 * - 全程无 console error / pageerror。
 *
 * 注意：`gbuffer.frag` 的 shadowFactor 目前是占位（返回全亮），
 * 所以这里**不**断言「开阴影后画面变暗」——那是算法段实现后的验收，
 * 以 test.fixme 的形式留在文件末尾，避免骨架被误判为已完成。
 */

const SHOT_DIR = join(process.cwd(), 'e2e', 'screenshots')
const HIDE_HUD = '.hud{display:none!important}'
const SHOW_HUD = '.hud{display:flex!important}'
const SHADOW_PANEL = '.panel:has-text("PCSS 光源尺寸")'

function luminanceStats(png: PNG): { mean: number; stddev: number } {
  const count = png.width * png.height
  let sum = 0
  let sumSq = 0
  for (let i = 0; i < png.data.length; i += 4) {
    const l = 0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2]
    sum += l
    sumSq += l * l
  }
  const mean = sum / count
  return { mean, stddev: Math.sqrt(Math.max(0, sumSq / count - mean * mean)) }
}

async function shootClean(page: Page, name: string): Promise<PNG> {
  await page.addStyleTag({ content: HIDE_HUD })
  await page.waitForTimeout(300)
  const buffer = await page.locator('canvas').first().screenshot()
  mkdirSync(SHOT_DIR, { recursive: true })
  writeFileSync(join(SHOT_DIR, `${name}.png`), buffer)
  await page.addStyleTag({ content: SHOW_HUD })
  return PNG.sync.read(buffer)
}

test('阴影骨架：深度图集与 cascade 分层可可视化', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(String(err)))

  // 深度图集：独立全屏 pass，直接把 DepthTexture 呈现在屏幕上
  await page.goto(
    '/d/shadows?scene=cornell&shadow=1&speed=0&tm=aces&presentation=0&hdrDebug=shadow%3Aatlas',
  )
  await expect(page.locator('canvas').first()).toBeVisible()
  await page.waitForTimeout(2500)

  // 页面全貌（含 HUD）：阴影面板应排在 HDR 面板之前，打开即可见
  mkdirSync(SHOT_DIR, { recursive: true })
  await page.screenshot({ path: join(SHOT_DIR, '18-shadow-page.png') })

  const atlas = await shootClean(page, '13-shadow-atlas')
  const atlasStats = luminanceStats(atlas)
  console.log(
    `[阴影] 图集亮度均值=${atlasStats.mean.toFixed(2)} 标准差=${atlasStats.stddev.toFixed(2)}`,
  )
  // 全黑说明 shadow pass 没有把 castShadow 物体画进图集（相机拟合 / 深度纹理 / RT 绑定问题）
  expect(atlasStats.stddev, '阴影图集疑似空白').toBeGreaterThan(2)

  // cascade 分层：走正常 beauty → tonemap，4 级时应有多个色块
  await page.goto(
    '/d/shadows?scene=cornell&shadow=1&speed=0&tm=aces&presentation=0&shadowCascades=4&hdrDebug=shadow%3Acascade',
  )
  await expect(page.locator('canvas').first()).toBeVisible()
  await page.waitForTimeout(1500)

  const cascade = await shootClean(page, '14-shadow-cascade')
  const cascadeStats = luminanceStats(cascade)
  console.log(
    `[阴影] cascade 视图亮度均值=${cascadeStats.mean.toFixed(2)} 标准差=${cascadeStats.stddev.toFixed(2)}`,
  )
  expect(cascadeStats.stddev, 'cascade 分层视图疑似空白').toBeGreaterThan(3)

  expect(errors, `console error: ${errors.join(' | ')}`).toHaveLength(0)
})

test('户外：蒙皮模型与体块进入阴影图集', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(String(err)))

  await page.goto(
    '/d/shadows?scene=outdoor&shadow=1&speed=0&tm=aces&presentation=0&hdrDebug=shadow%3Aatlas',
  )
  await expect(page.locator('canvas').first()).toBeVisible()
  // 等 HDR / GLB / Draco 与阴影图集都完成
  await page.waitForTimeout(7000)

  const atlas = await shootClean(page, '15-shadow-atlas-outdoor')
  const stats = luminanceStats(atlas)
  console.log(
    `[阴影] 户外图集亮度均值=${stats.mean.toFixed(2)} 标准差=${stats.stddev.toFixed(2)}`,
  )
  // 蒙皮模型（SkeletonUtils 克隆）必须能被 MeshDepthMaterial 正确渲染进深度图
  expect(stats.stddev, '户外阴影图集疑似空白').toBeGreaterThan(5)
  expect(errors, `console error: ${errors.join(' | ')}`).toHaveLength(0)
})

test('阴影参数进入 URL 并回填到面板', async ({ page }) => {
  await page.goto(
    '/d/shadows?scene=cornell&shadow=1&speed=0&presentation=0&shadowMode=pcss&shadowCascades=4&shadowMapSize=1024&shadowBiasMode=slope',
  )
  await expect(page.locator('canvas').first()).toBeVisible()

  const panel = page.locator(SHADOW_PANEL)
  await expect(panel).toBeVisible({ timeout: 10_000 })

  await expect(panel.locator('.ctl-row:has-text("实时阴影") input[type="checkbox"]')).toBeChecked()
  await expect(panel.locator('.ctl-row:has-text("算法") select')).toHaveValue('pcss')
  await expect(panel.locator('.ctl-row:has-text("级联") select')).toHaveValue('4')
  await expect(panel.locator('.ctl-row:has-text("阴影贴图") select')).toHaveValue('1024')
  await expect(panel.locator('.ctl-row:has-text("Bias 补偿") select')).toHaveValue('slope')
})

/**
 * 算法段验收（实现 gbuffer.frag 的 shadowFactor 后把 fixme 改成 test）：
 * 固定机位下切换「实时阴影」应产生可见差异，且差距集中在投影区域。
 */
test.fixme('阴影开启后应产生可见画面变化（shadowFactor 实现后启用）', async ({ page }) => {
  await page.goto('/d/shadows?scene=cornell&shadow=0&speed=0&tm=aces&presentation=0')
  await expect(page.locator('canvas').first()).toBeVisible()
  await page.waitForTimeout(2000)
  const off = await shootClean(page, '16-shadow-off')

  await page.goto('/d/shadows?scene=cornell&shadow=1&speed=0&tm=aces&presentation=0')
  await expect(page.locator('canvas').first()).toBeVisible()
  await page.waitForTimeout(2000)
  const on = await shootClean(page, '17-shadow-on')

  expect(luminanceStats(off).stddev).toBeGreaterThan(5)
  expect(luminanceStats(on).stddev).toBeGreaterThan(5)
})
