import { expect, test, type Page } from '@playwright/test'
import { PNG } from 'pngjs'

/**
 * p1-light-ssr S3-a 接线验收（脚手架）。
 *
 * 覆盖三件「接线正确性」，不含渲染正确性：
 * - 默认进入不产生脏参数（lightCount 默认 0 → 灯阵不挂载，现有页面零回归）；
 * - `?clustered=&lightCount=` 能回填到面板；
 * - 面板操作会写回 URL（分享链接可复现的前提）。
 *
 * 注意：断言里的默认值（clustered=true / lightCount=0）与 `clusterParams.ts` 的
 * CLUSTER_PARAM_DEFAULTS 一致；如果你改了默认值，这里要同步改，否则会误报。
 *
 * 画面 A/B 对照（S3-e）等灯阵与统计接完再启用，见文件末尾的 test.fixme。
 */

const PANEL = '.panel:has-text("多光源")'
const HIDE_HUD = '.hud{display:none!important}'
const SHOW_HUD = '.hud{display:flex!important}'

/** 画面平均亮度：用于回答「灯阵到底有没有参与照明」 */
function meanLuminance(png: PNG): number {
  let sum = 0
  for (let i = 0; i < png.data.length; i += 4) {
    sum += 0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2]
  }
  return sum / (png.data.length / 4)
}

/** 逐像素 A/B：平均绝对差（三通道求和）与差异 > 8 的像素占比（%） */
function diffStats(a: PNG, b: PNG): { meanAbs: number; overRatio: number } {
  const n = Math.min(a.data.length, b.data.length)
  let sum = 0
  let over = 0
  for (let i = 0; i < n; i += 4) {
    const d =
      Math.abs(a.data[i] - b.data[i]) +
      Math.abs(a.data[i + 1] - b.data[i + 1]) +
      Math.abs(a.data[i + 2] - b.data[i + 2])
    sum += d
    if (d > 8) over += 1
  }
  const px = n / 4
  return { meanAbs: sum / px, overRatio: (over / px) * 100 }
}

async function shootCanvas(page: Page): Promise<PNG> {
  await page.addStyleTag({ content: HIDE_HUD })
  await page.waitForTimeout(400)
  const buffer = await page.locator('canvas').first().screenshot()
  await page.addStyleTag({ content: SHOW_HUD })
  return PNG.sync.read(buffer)
}

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(String(error)))
  return errors
}

test('多光源面板存在且参数可回填', async ({ page }) => {
  const errors = collectErrors(page)

  await page.goto('/d/hello-cube?presentation=0&speed=0&clustered=0&lightCount=8')
  await expect(page.locator('canvas').first()).toBeVisible()

  const panel = page.locator(PANEL)
  await expect(panel).toBeVisible({ timeout: 20_000 })

  // 点光档位是离散 Select（不是滑杆）：URL 值必须能精确回填
  await expect(panel.locator('select')).toHaveValue('8')
  // 第一个 checkbox = Clustered 开关，clustered=0 应为未勾选
  await expect(panel.locator('input[type="checkbox"]').first()).not.toBeChecked()

  expect(errors, `控制台错误：\n${errors.join('\n')}`).toEqual([])
})

test('默认进入不写 cluster 参数（零回归）', async ({ page }) => {
  await page.goto('/d/hello-cube?presentation=0&speed=0')
  await expect(page.locator('canvas').first()).toBeVisible()

  // 两个 store 异步写 URL，这里只断言「没有多出来的键」
  await expect
    .poll(() => new URL(page.url()).searchParams.get('clustered'), { timeout: 10_000 })
    .toBeNull()
  await expect
    .poll(() => new URL(page.url()).searchParams.get('lightCount'), { timeout: 10_000 })
    .toBeNull()
})

test('切换点光档位会写回 URL', async ({ page }) => {
  await page.goto('/d/hello-cube?presentation=0&speed=0&lightCount=8')
  const panel = page.locator(PANEL)
  await expect(panel).toBeVisible({ timeout: 20_000 })

  await panel.locator('select').selectOption('32')
  await expect
    .poll(() => new URL(page.url()).searchParams.get('lightCount'), { timeout: 10_000 })
    .toBe('32')
})

test('灯阵真的参与照明（0 → 8 盏点光画面明显变化）', async ({ page }) => {
  // 两侧都固定 clustered=0：本用例只验证「灯有没有进 uniform 数组」，
  // 不把「切换着色路径」混进来（那是下一个用例的事）。
  await page.goto('/d/hello-cube?presentation=0&speed=0&scene=cornell&clustered=0&lightCount=0')
  const withoutRig = meanLuminance(await shootCanvas(page))

  await page.goto('/d/hello-cube?presentation=0&speed=0&scene=cornell&clustered=0&lightCount=8')
  const withRig = meanLuminance(await shootCanvas(page))

  // 只断言「肉眼可见的变化」：灯阵没接进 uniform 数组时两张图会几乎一致
  expect(withRig, `无灯阵 ${withoutRig.toFixed(2)} / 有灯阵 ${withRig.toFixed(2)}`).toBeGreaterThan(
    withoutRig + 3,
  )
})

test('归因面板显示剔除统计（灯数 / 平均每 cluster / 剔除 CPU）', async ({ page }) => {
  await page.goto('/d/hello-cube?presentation=0&speed=0&scene=cornell&clustered=1&lightCount=8')

  const perf = page.locator('.perf-panel')
  await expect(perf).toBeVisible({ timeout: 20_000 })
  await expect(perf).toContainText('Clustered 剔除 · 已启用', { timeout: 10_000 })
  // 2 平行光 + 8 点光 + 2 聚光，全部应写进 uniform（未达上限）
  await expect(perf).toContainText('12 / 12 盏')

  // 平均每 cluster 灯数必须严格小于总灯数 —— 这是「剔除真的生效」的结构性证据
  const avgText = await perf
    .locator('.perf-pass-row:has-text("平均每 cluster") .perf-val-sm')
    .innerText()
  const avg = Number.parseFloat(avgText)
  expect(Number.isFinite(avg), `解析失败：${avgText}`).toBe(true)
  expect(avg).toBeGreaterThan(0)
  expect(avg).toBeLessThan(12)

  // 剔除自身的开销必须可见（这正是性能故事的「另一面」）
  await expect(perf.locator('.perf-pass-row:has-text("剔除 CPU")')).toContainText('ms')
})

/**
 * A/B 一致性：同场景、同灯数下，clustered 与暴力前向必须逐像素一致。
 *
 * 必须**在一次页面加载内切换**，不能两次 `goto` 比对：
 * 相机有飞入插值，两次加载的收敛进度不同，会把相机差异当成着色差异（实测偏差可达 8）。
 *
 * 本用例同时是两个已修 bug 的回归守护（见 DEVLOG 2026-11-03）：
 * - 切片深度误用 NDC 的 z（点光/聚光一盏都进不了 cluster）；
 * - 切片上下界写反（tz0 > tz1 → 范围恒空）。
 * 任一复发都会让 clustered 只剩平行光，亮度明显低于 brute。
 */
test('clustered 与暴力前向画面一致（同一次加载内切换）', async ({ page }) => {
  await page.goto('/d/hello-cube?presentation=0&speed=0&scene=cornell&clustered=1&lightCount=8')
  const panel = page.locator(PANEL)
  await expect(panel).toBeVisible({ timeout: 20_000 })

  // 等相机飞入收敛，两次截图要落在同一机位
  await page.waitForTimeout(1800)

  const clustered = await shootCanvas(page)
  await panel.locator('input[type="checkbox"]').first().uncheck()
  await page.waitForTimeout(600)
  const brute = await shootCanvas(page)

  const diff = diffStats(clustered, brute)
  expect(diff.meanAbs, `平均差 ${diff.meanAbs.toFixed(3)}`).toBeLessThan(1)
  expect(diff.overRatio, `差异像素 ${diff.overRatio.toFixed(2)}%`).toBeLessThan(1)
})
