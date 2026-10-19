import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'

/**
 * 户外 IBL 验收：
 * - Poly Haven HDR 与 LittlestTokyo（Draco）都真的加载成功（HTTP 200）；
 * - HDR 不走 RoomEnvironment 兜底；
 * - IBL 开关能产生可见画面变化；
 * - 全程无 console error / pageerror。
 */

const SHOT_DIR = join(process.cwd(), 'e2e', 'screenshots')
const HIDE_HUD = '.hud{display:none!important}'
const SHOW_HUD = '.hud{display:flex!important}'
const PARAM_PANEL = '.panel:has-text("旋转速度")'
const ENV_TOGGLE = `${PARAM_PANEL} .ctl-row:has-text("环境光（IBL）") input[type="checkbox"]`

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

function diffPng(a: PNG, b: PNG): { meanAbs: number; maxAbs: number; overRatio: number } {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`尺寸不一致：${a.width}x${a.height} vs ${b.width}x${b.height}`)
  }
  const pixels = a.width * a.height
  let sum = 0
  let max = 0
  let over = 0
  for (let i = 0; i < a.data.length; i += 4) {
    let worst = 0
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a.data[i + c] - b.data[i + c])
      sum += d
      if (d > worst) worst = d
    }
    if (worst > max) max = worst
    if (worst > 8) over += 1
  }
  return { meanAbs: sum / (pixels * 3), maxAbs: max, overRatio: over / pixels }
}

async function shootClean(page: Page, name: string): Promise<PNG> {
  await page.addStyleTag({ content: HIDE_HUD })
  await page.waitForTimeout(300)
  const buffer = await page.locator('canvas').first().screenshot()
  mkdirSync(SHOT_DIR, { recursive: true })
  const png = PNG.sync.read(buffer)
  writeFileSync(join(SHOT_DIR, `${name}.png`), buffer)
  await page.addStyleTag({ content: SHOW_HUD })
  return png
}

test('户外 HDRI + LittlestTokyo：资源加载、IBL 开关与画面', async ({ page }) => {
  const errors: string[] = []
  const warnings: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
    if (msg.type() === 'warning') warnings.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(String(err)))

  const hdrResponse = page.waitForResponse(
    (res) => res.url().includes('kloppenheim_06_puresky_1k.hdr') && res.status() === 200,
    { timeout: 30_000 },
  )
  const modelResponse = page.waitForResponse(
    (res) => res.url().includes('littlest-tokyo.glb') && res.status() === 200,
    { timeout: 30_000 },
  )
  const dracoResponse = page.waitForResponse(
    (res) => res.url().includes('/draco/draco_') && res.status() === 200,
    { timeout: 30_000 },
  )

  await page.goto('/d/hello-cube?speed=0&scene=outdoor&presentation=0')
  await expect(page.locator('canvas').first()).toBeVisible()

  expect((await hdrResponse).status()).toBe(200)
  expect((await modelResponse).status()).toBe(200)
  expect((await dracoResponse).status()).toBe(200)

  // 等相机飞入 + GLB 解析 / 贴图上传完成
  await page.waitForTimeout(7000)

  const off = await shootClean(page, '10-outdoor-env-off')
  const offStats = luminanceStats(off)
  console.log(`[户外] IBL 关 亮度均值=${offStats.mean.toFixed(2)} 标准差=${offStats.stddev.toFixed(2)}`)
  expect(offStats.stddev, '户外场景疑似空白 / 黑屏').toBeGreaterThan(5)

  const envToggle = page.locator(ENV_TOGGLE)
  await expect(envToggle, '环境光开关未渲染').toBeVisible()
  await envToggle.check()
  await expect.poll(() => page.url(), { timeout: 4000, message: 'env 未写入 URL' }).toContain('env=1')
  await page.waitForTimeout(1500)

  const on = await shootClean(page, '11-outdoor-env-on')
  const onStats = luminanceStats(on)
  console.log(`[户外] IBL 开 亮度均值=${onStats.mean.toFixed(2)} 标准差=${onStats.stddev.toFixed(2)}`)
  expect(onStats.stddev, '开启 IBL 后画面异常').toBeGreaterThan(5)

  const diff = diffPng(off, on)
  console.log(
    `[户外] IBL A/B 平均差=${diff.meanAbs.toFixed(3)} 最大差=${diff.maxAbs} 差异>8 像素占比=${(diff.overRatio * 100).toFixed(3)}%`,
  )
  expect(diff.meanAbs, 'IBL 开关未产生可见变化').toBeGreaterThan(1)

  // 如果 HDR 加载失败，GBufferEnvironment 会回退 RoomEnvironment 并打 warning
  expect(warnings.join(' | '), 'HDR 加载失败，已回退 RoomEnvironment').not.toContain('HDRI 加载失败')
  expect(errors, `console error: ${errors.join(' | ')}`).toHaveLength(0)
})
