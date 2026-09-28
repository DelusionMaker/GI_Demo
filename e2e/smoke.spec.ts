import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'

/**
 * p0-hdr 步骤 1 的冒烟与像素级验证。
 *
 * 验收对应关系：
 * - 无 console error / pageerror → 「接入后无报错」
 * - 画面非空白（亮度标准差）    → 「无黑屏」
 * - HUD 标注 RT 档位            → 「降级路径必须显式标注」
 * - 自建链 vs 直出 的像素对比     → 「视觉一致（bypass A/B）」
 *
 * 关键：A/B 对比必须证明 bypass 分支**真的被执行了**，
 * 否则两张截图相同可能只是因为开关没生效。
 * 这里用「pass 计时表消失」作为分路证据 —— 旁路时 Pipeline 不提交任何 pass，
 * 性能面板的 pass 分解区因此不渲染。光看像素无法区分这两种情况。
 */

const SHOT_DIR = join(process.cwd(), 'e2e', 'screenshots')

/** 隐去 HUD，只留 WebGL 内容，避免面板文字干扰像素对比 */
const HIDE_HUD = '.hud{display:none!important}'
/** 恢复 HUD（后注入的 !important 规则胜出），用于操作开关 */
const SHOW_HUD = '.hud{display:flex!important}'

const HDR_PANEL = '.panel:has-text("HDR 链路")'

interface ImageDiff {
  meanAbs: number
  maxAbs: number
  /** 差异 > 8 的像素占比 */
  overRatio: number
}

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

function diffPng(a: PNG, b: PNG): ImageDiff {
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

async function shootCanvas(page: Page, name: string): Promise<Buffer> {
  const buffer = await page.locator('canvas').screenshot()
  mkdirSync(SHOT_DIR, { recursive: true })
  writeFileSync(join(SHOT_DIR, `${name}.png`), buffer)
  return buffer
}

/** HUD 隐去 → 截图 → 恢复 HUD，供下一次交互 */
async function shootClean(page: Page, name: string): Promise<PNG> {
  await page.addStyleTag({ content: HIDE_HUD })
  await page.waitForTimeout(300)
  const png = PNG.sync.read(await shootCanvas(page, name))
  await page.addStyleTag({ content: SHOW_HUD })
  return png
}

test.describe('p0-hdr 步骤 1 · HDR 链路冒烟', () => {
  test.beforeEach(async ({ page }) => {
    // speed=0 关闭探针自转，保证两次截图可确定性对比
    await page.goto('/d/hello-cube?speed=0')
    await expect(page.locator('canvas')).toBeVisible()
    // 等相机飞向预设视角收敛 + 若干帧稳定
    await page.waitForTimeout(1500)
  })

  test('无 console error、画面非空白、档位已标注', async ({ page }) => {
    const errors: string[] = []
    const pageErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })
    page.on('pageerror', (err) => pageErrors.push(String(err)))

    await page.waitForTimeout(400)

    const hud = page.locator('.hud')
    await expect(hud).toBeVisible()

    // RT 档位必须在 HUD 显式标注（取 HDR 链路面板内的徽标，别取到 PerfPanel 的 backend 徽标）
    const tierBadge = page.locator(`${HDR_PANEL} .badge`).first()
    await expect(tierBadge).toHaveText(/RGBA16F|RGBA8/)
    const tier = (await tierBadge.textContent())?.trim() ?? ''
    console.log(`[档位] RT = ${tier}`)

    // 逐 pass 计时表存在 → 证明自建链在本帧确实提交了 pass
    await expect(page.locator('.perf-passes')).toBeVisible()

    const shot = await shootClean(page, '01-pipeline')
    const { mean, stddev } = luminanceStats(shot)
    console.log(`[画面] 亮度均值=${mean.toFixed(2)} 标准差=${stddev.toFixed(2)}`)
    // 空白/全黑画面标准差趋近 0
    expect(stddev, '画面疑似空白或全黑').toBeGreaterThan(5)

    expect(pageErrors, `pageerror: ${pageErrors.join(' | ')}`).toHaveLength(0)
    expect(errors, `console error: ${errors.join(' | ')}`).toHaveLength(0)
  })

  test('自建链与场景直出路径画面一致（含分路证据）', async ({ page }) => {
    // A：自建链
    const onPipeline = await shootClean(page, '02-pipeline-ab')
    await expect(page.locator('.perf-passes')).toBeVisible()

    // B：旁路整条链（场景直出）。bypass 默认 false，必须用 check 打开
    const bypass = page.locator(`${HDR_PANEL} input[type="checkbox"]`)
    await bypass.check()
    await expect(bypass, 'bypass 开关未生效').toBeChecked()
    await page.waitForTimeout(400)

    // 分路证据：旁路时不提交任何 pass，计时表区域应消失
    await expect(page.locator('.perf-passes'), '计时表仍在 → 旁路分支未执行').toBeHidden()

    const onBypass = await shootClean(page, '03-bypass-ab')

    const diff = diffPng(onPipeline, onBypass)
    console.log(
      `[A/B] 平均差=${diff.meanAbs.toFixed(3)} 最大差=${diff.maxAbs} 差异>8 的像素占比=${(diff.overRatio * 100).toFixed(3)}%`,
    )

    // 两条路径除 16F 量化与 MSAA 来源差异外应基本重合
    expect(diff.meanAbs, '平均像素差过大：两条路径不一致').toBeLessThan(3)
    expect(diff.overRatio, '差异像素占比过大').toBeLessThan(0.05)

    // 复原，避免影响后续断言
    await bypass.uncheck()
  })

  test('调试视图切换不破坏渲染', async ({ page }) => {
    const select = page.locator(`${HDR_PANEL} select`)

    await select.selectOption('beauty')
    await expect(select).toHaveValue('beauty')
    await page.waitForTimeout(300)
    const truncated = await shootClean(page, '04-debug-beauty')
    const truncatedStats = luminanceStats(truncated)
    console.log(`[调试视图] 截断到 beauty：亮度标准差=${truncatedStats.stddev.toFixed(2)}`)
    expect(truncatedStats.stddev, '截断到 beauty 后画面异常').toBeGreaterThan(5)

    await select.selectOption('none')
    await expect(select).toHaveValue('none')
    await page.waitForTimeout(300)
    const full = await shootClean(page, '05-debug-none')
    const fullStats = luminanceStats(full)
    console.log(`[调试视图] 完整链路：亮度标准差=${fullStats.stddev.toFixed(2)}`)
    expect(fullStats.stddev).toBeGreaterThan(5)

    // 当前链路只有 beauty + tonemap-output 两段，截断到 beauty 后链路等价，
    // 因此两者应一致；pass 数 ≥ 3 后（bloom / luminance 接入）才具备视觉可区分性。
    const diff = diffPng(truncated, full)
    console.log(`[调试视图] 两种视图平均差=${diff.meanAbs.toFixed(3)}`)
    expect(diff.meanAbs).toBeLessThan(3)
  })
})
