import { expect, test, type Page } from '@playwright/test'
import { PNG } from 'pngjs'

/**
 * p1-light-ssr S3-a 接线验收。
 *
 * 覆盖：
 * - 默认进入不产生脏参数，且默认画面与「显式 0 盏」逐像素一致
 *   （lightCount 默认 0 → 灯阵不挂载、不构建 cluster，现有页面零回归）；
 * - `?clustered=&lightCount=` 能回填到面板、面板操作会写回 URL；
 * - 灯阵参与照明、剔除归因有读数、clustered 与暴力前向画面一致。
 *
 * 注意：断言里的默认值（clustered=true / lightCount=0）与 `clusterParams.ts` 的
 * CLUSTER_PARAM_DEFAULTS 一致；改默认值会破坏分享链接语义，必须同步改这里。
 *
 * 未覆盖：32 / 56 盏的 A/B 一致性与满档 cluster 热力视图（S3-e 剩余项）。
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

  // 只断言 URL 无脏键抓不到「默认值漂移回 8」：此前 21 个用例全绿，
  // 但所有页面一进来就挂 12 盏灯。这里把语义也钉死。
  const panel = page.locator(PANEL)
  await expect(panel.locator('select')).toHaveValue('0')
  await expect(page.locator('.perf-panel')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.perf-cluster')).not.toContainText('已启用')
  // enabled=false 时归因面板不渲染「平均每 cluster」等统计行
  await expect(page.locator('.perf-pass-row:has-text("平均每 cluster")')).toHaveCount(0)
})

test('默认画面与显式零灯阵一致（默认值语义守护）', async ({ page }) => {
  await page.goto('/d/hello-cube?presentation=0&speed=0&scene=cornell')
  const panel = page.locator(PANEL)
  await expect(panel).toBeVisible({ timeout: 20_000 })
  await expect(panel.locator('select')).toHaveValue('0')

  // 同一次加载内切换，等相机飞入收敛；两次 goto 会把插值差异误读成着色差异
  await page.waitForTimeout(1800)
  const before = await shootCanvas(page)

  // 显式挂 8 盏再回到 0：若默认值又变成非 0，首帧已带灯，首尾两帧不会一致
  await panel.locator('select').selectOption('8')
  await page.waitForTimeout(600)
  await panel.locator('select').selectOption('0')
  await page.waitForTimeout(600)
  const after = await shootCanvas(page)

  const diff = diffStats(before, after)
  expect(diff.meanAbs, `平均差 ${diff.meanAbs.toFixed(3)}`).toBeLessThan(1)
  expect(diff.overRatio, `差异像素 ${diff.overRatio.toFixed(2)}%`).toBeLessThan(1)
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
 *
 * 灯数覆盖 8 / 32 / 56 三档（56 + 场景固定 4 盏 = 60，MAX_LIGHTS=64 留余量），
 * 这是 S3-e 的剩余验收项：高档位下截断 / 数据纹理行数都可能出问题。
 */
for (const lightCount of [8, 32, 56]) {
  test(`clustered 与暴力前向画面一致（${lightCount} 盏点光，同一次加载内切换）`, async ({ page }) => {
    await page.goto(
      `/d/hello-cube?presentation=0&speed=0&scene=cornell&clustered=1&lightCount=${lightCount}`,
    )
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
}

/** 站点入口：/d/light-ssr 必须真的渲染，且默认带灯阵与剔除归因（不能落到「规划中」占位）。 */
test('light-ssr 站点入口默认展示多光源与剔除归因', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto('/d/light-ssr')
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.demo-title')).toHaveText('多光源与 Clustered 剔除')
  await expect(page.locator('.stage-planned')).toHaveCount(0)

  const panel = page.locator(PANEL)
  await expect(panel).toBeVisible({ timeout: 30_000 })
  await expect(panel.locator('select')).toHaveValue('32')
  await expect(page.locator('.perf-cluster')).toContainText('已启用', { timeout: 20_000 })
  await expect(page.locator('.perf-pass-row:has-text("平均每 cluster")')).toContainText('盏')
  expect(errors, `控制台错误：\n${errors.join('\n')}`).toEqual([])
})

/**
 * 跨页复位：clusterParams 是全站单例，离开 light-ssr 必须回到默认 0，
 * 否则其他 demo 会带着 32 盏灯 + 每帧 cluster 构建运行，破坏「默认零回归」。
 * 必须走站内 Link（SPA 路由），两次 goto 会重载模块、测不出单例残留。
 */
test('站内切页后不残留灯阵（clusterParams 单例复位）', async ({ page }) => {
  await page.goto('/d/light-ssr')
  await expect(page.locator(PANEL).locator('select')).toHaveValue('32')

  await page.locator('.backlink').click()
  await page.locator('.card:has-text("HDR 管线与色调映射")').click()
  await expect(page).toHaveURL(/\/d\/hdr/)

  // store 单例下 light-ssr 设的 presentation=false 会残留，技术模式面板仍可见，
  // 可直接读 select 判断 lightCount 是否复位。
  await expect(page.locator(PANEL).locator('select')).toHaveValue('0')
  await expect(page.locator('.perf-cluster')).not.toContainText('已启用')
})
