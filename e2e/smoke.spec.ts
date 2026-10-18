import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'

/**
 * p0-hdr 冒烟与像素级验证。
 *
 * 验收对应关系：
 * - 无 console error / pageerror → 「接入后无报错」
 * - 画面非空白（亮度标准差）    → 「无黑屏」
 * - HUD 标注 RT 档位            → 「降级路径必须显式标注」
 * - 自建链 vs 直出 的像素对比     → 「视觉一致（bypass A/B）」
 * - ev / tm 进入 URL            → 「状态序列化进 URL query，可直接分享复现」
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
/** 面板里现在有两个 select，必须按标签定位 */
const TM_SELECT = '.ctl-row:has-text("曲线") select'
const DEBUG_SELECT = '.ctl-row:has-text("调试视图") select'
const EV_SLIDER = '.ctl-row:has-text("曝光") input[type="range"]'
const BYPASS_CHECKBOX = '.ctl-row:has-text("旁路整条链") input[type="checkbox"]'

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

/** sRGB → 线性（与 tonemap-output.frag 的 linearToSrgb 严格互逆） */
function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

/**
 * 线性域像素差：`chain` 是自建链输出（末端做了 sRGB 编码的 8bit 图），
 * `bypass` 是场景直出（raw shader 输出未经编码，字节值≈线性×255）。
 *
 * 为什么不能直接比字节：场景与探针已全部改用自写 raw shader 材质（MRT 要求材质
 * 写满 3 个 fragment output，three 内建材质只写 1 个，MRT 下会触发
 * GL_INVALID_OPERATION 且 draw 被丢弃）。three 的直出路径不对 raw 材质做 sRGB
 * 编码，而 HDR 链在最终 pass 编码 → 两条路径字节差异被一条编码曲线放大
 * （实测均值差 ~52），但解码回线性后数值应几乎重合。
 *
 * 差分尺度仍是 0..255（线性值 ×255），与原 A/B 断言的数值口径一致。
 */
function diffLinear(chain: PNG, bypass: PNG): ImageDiff {
  if (chain.width !== bypass.width || chain.height !== bypass.height) {
    throw new Error(`尺寸不一致：${chain.width}x${chain.height} vs ${bypass.width}x${bypass.height}`)
  }
  const pixels = chain.width * chain.height
  let sum = 0
  let max = 0
  let over = 0
  for (let i = 0; i < chain.data.length; i += 4) {
    let worst = 0
    for (let c = 0; c < 3; c += 1) {
      const a = srgbToLinear(chain.data[i + c] / 255) * 255
      const b = bypass.data[i + c]
      const d = Math.abs(a - b)
      sum += d
      if (d > worst) worst = d
    }
    if (worst > max) max = worst
    if (worst > 8) over += 1
  }
  return { meanAbs: sum / (pixels * 3), maxAbs: max, overRatio: over / pixels }
}

async function shootCanvas(page: Page, name: string): Promise<Buffer> {
  const buffer = await page.locator('canvas').first().screenshot()
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

/** React 受控的 range 输入：必须走原生 setter + 派发 input 事件才生效 */
async function setRangeValue(locator: Locator, value: number): Promise<void> {
  await locator.evaluate((el, v) => {
    const input = el as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, String(v))
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

test.describe('p0-hdr · HDR 链路冒烟', () => {
  test.beforeEach(async ({ page }) => {
    // speed=0 关闭探针自转，保证两次截图可确定性对比
    await page.goto('/d/hello-cube?speed=0')
    await expect(page.locator('canvas').first()).toBeVisible()
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

    // RT 档位必须在 HUD 显式标注
    const tierBadge = page.locator(`${HDR_PANEL} .badge`).first()
    await expect(tierBadge).toHaveText(/RGBA16F|RGBA8/)
    console.log(`[档位] RT = ${(await tierBadge.textContent())?.trim() ?? ''}`)

    // 逐 pass 计时表存在 → 证明自建链在本帧确实提交了 pass
    await expect(page.locator('.perf-passes')).toBeVisible()
    // 曲线图存在
    await expect(page.locator('.curve-graph canvas')).toBeVisible()

    const shot = await shootClean(page, '01-pipeline')
    const { mean, stddev } = luminanceStats(shot)
    console.log(`[画面] 亮度均值=${mean.toFixed(2)} 标准差=${stddev.toFixed(2)}`)
    expect(stddev, '画面疑似空白或全黑').toBeGreaterThan(5)

    // HUD 不得溢出画布：面板越加越多时最容易踩的布局问题
    const slotEdges = await page.evaluate(() => {
      const stage = document.querySelector('.stage')?.getBoundingClientRect()
      if (!stage) return { viewportH: window.innerHeight, stageH: 0, slots: [] }
      const slots = Array.from(document.querySelectorAll('.hud-slot')).map((el) => {
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        const parent = el.parentElement
        return {
          top: Math.round(r.top - stage.top),
          bottom: Math.round(stage.bottom - r.bottom),
          h: Math.round(r.height),
          maxH: cs.maxHeight,
          overflowY: cs.overflowY,
          rowH: parent ? Math.round(parent.getBoundingClientRect().height) : 0,
        }
      })
      return { viewportH: window.innerHeight, stageH: Math.round(stage.height), slots }
    })
    console.log(
      `[布局] viewport=${slotEdges.viewportH} stage=${slotEdges.stageH} ${JSON.stringify(slotEdges.slots)}`,
    )
    for (const edge of slotEdges.slots) {
      expect(edge.top, 'HUD 上边溢出画布').toBeGreaterThanOrEqual(-1)
      expect(edge.bottom, 'HUD 下边溢出画布').toBeGreaterThanOrEqual(-1)
    }

    // 再留一张带 HUD 的截图，便于人工核对面板状态（曲线图 / 档位 / 计时）
    mkdirSync(SHOT_DIR, { recursive: true })
    const stage = page.locator('.stage')
    await stage.scrollIntoViewIfNeeded()
    await page.waitForTimeout(150)
    writeFileSync(join(SHOT_DIR, '00-panel.png'), await stage.screenshot())

    expect(pageErrors, `pageerror: ${pageErrors.join(' | ')}`).toHaveLength(0)
    expect(errors, `console error: ${errors.join(' | ')}`).toHaveLength(0)
  })

  test('自建链与场景直出路径画面一致（含分路证据）', async ({ page }) => {
    const onPipeline = await shootClean(page, '02-pipeline-ab')
    await expect(page.locator('.perf-passes')).toBeVisible()

    const bypass = page.locator(BYPASS_CHECKBOX)
    await bypass.check()
    await expect(bypass, 'bypass 开关未生效').toBeChecked()
    await page.waitForTimeout(400)

    // 分路证据：旁路时不提交任何 pass，计时表区域应消失
    await expect(page.locator('.perf-passes'), '计时表仍在 → 旁路分支未执行').toBeHidden()

    const onBypass = await shootClean(page, '03-bypass-ab')

    // 注意：两条路径的输出编码不同——自建链在末端做 sRGB 编码，直出路径对 raw 材质
    // 不做编码（S2 起场景材质全部是自写 RawShaderMaterial）。必须先按 sRGB 解码回
    // 线性再比，否则比的是两条编码曲线（字节域实测均值差 ~52，线性域仅个位数）。
    const diff = diffLinear(onPipeline, onBypass)
    console.log(
      `[A/B] 线性域平均差=${diff.meanAbs.toFixed(3)} 最大差=${diff.maxAbs} 差异>8 的像素占比=${(diff.overRatio * 100).toFixed(3)}%`,
    )
    // 线性域下两条路径应几乎重合；残差来自 MSAA 采样差异（直出路径有 4x MSAA，
    // 自建链 beauty samples:0）与 16F/8bit 量化。
    expect(diff.meanAbs, '线性域平均像素差过大：自建链与直出不一致').toBeLessThan(4)
    expect(diff.overRatio, '差异像素占比过大（疑似链路级回归）').toBeLessThan(0.08)

    await bypass.uncheck()
  })

  test('调试视图切换不破坏渲染', async ({ page }) => {
    const select = page.locator(`${HDR_PANEL} ${DEBUG_SELECT}`)

    await select.selectOption('beauty')
    await expect(select).toHaveValue('beauty')
    await page.waitForTimeout(300)
    const truncated = await shootClean(page, '04-debug-beauty')
    console.log(`[调试视图] 截断到 beauty：标准差=${luminanceStats(truncated).stddev.toFixed(2)}`)
    expect(luminanceStats(truncated).stddev, '截断到 beauty 后画面异常').toBeGreaterThan(5)

    await select.selectOption('none')
    await expect(select).toHaveValue('none')
    await page.waitForTimeout(300)
    const full = await shootClean(page, '05-debug-none')
    expect(luminanceStats(full).stddev).toBeGreaterThan(5)

    // 截断到 beauty 后链路等价（beauty 之后只有 luminance 旁路 + bloom 关闭 + tonemap 直通）
    const diff = diffPng(truncated, full)
    console.log(`[调试视图] 两种视图平均差=${diff.meanAbs.toFixed(3)}`)
    expect(diff.meanAbs).toBeLessThan(3)

    // ---- S3：G-buffer 三层原始数据视图 ----
    // 前提：MRT 可用（headless 的 SwiftShader 也支持；不可用时下拉不含这些选项）
    const gbufferValues = await select
      .locator('option')
      .evaluateAll((options) =>
        options.map((option) => (option as HTMLOptionElement).value).filter((v) => v.startsWith('gbuffer:')),
      )
    expect(gbufferValues, 'MRT 可用但下拉缺少 G-buffer 三个视图').toHaveLength(3)

    for (const view of ['gbuffer:albedo', 'gbuffer:normal', 'gbuffer:mrao']) {
      await select.selectOption(view)
      await expect(select).toHaveValue(view)
      await page.waitForTimeout(300)
      const shot = await shootClean(page, `06-${view.replace(':', '-')}`)
      const stats = luminanceStats(shot)
      console.log(`[G-buffer] ${view} 亮度均值=${stats.mean.toFixed(2)} 标准差=${stats.stddev.toFixed(2)}`)
      expect(stats.stddev, `${view} 画面异常（疑似黑屏 / 附件未绑定）`).toBeGreaterThan(3)
      // 原始数据视图必须与完整链路明显不同，排除「下拉没生效但画面恰好一样」的假阳性
      const gbufferDiff = diffPng(full, shot)
      expect(gbufferDiff.maxAbs, `${view} 与完整链路无差异：调试视图可能未生效`).toBeGreaterThan(20)
    }

    // 恢复完整链路，避免影响后续用例
    await select.selectOption('none')
    await expect(select).toHaveValue('none')
  })

  test('S2 曝光与曲线参数进入 URL（可分享复现）', async ({ page }) => {
    // 曲线下拉
    await page.locator(`${HDR_PANEL} ${TM_SELECT}`).selectOption('aces')
    await expect
      .poll(() => page.url(), { timeout: 4000, message: 'tm 未写入 URL' })
      .toContain('tm=aces')

    // 留一张"曲线未实现"状态的截图：曲线图会标出未实现，方便对照待填位置
    mkdirSync(SHOT_DIR, { recursive: true })
    const stage = page.locator('.stage')
    await stage.scrollIntoViewIfNeeded()
    await page.waitForTimeout(150)
    writeFileSync(join(SHOT_DIR, '06-curve-todo.png'), await stage.screenshot())

    // 曝光滑杆（React 受控 input 需要原生 setter + input 事件）
    await setRangeValue(page.locator(`${HDR_PANEL} ${EV_SLIDER}`), -2)
    await expect
      .poll(() => page.url(), { timeout: 4000, message: 'ev 未写入 URL' })
      .toContain('ev=-2')

    const url = new URL(page.url())
    console.log(`[URL] ${url.search}`)

    // 用生成的 URL 重新打开，参数必须回填到控件
    await page.goto(`${url.pathname}${url.search}&speed=0`)
    await page.waitForTimeout(1200)
    await expect(page.locator(`${HDR_PANEL} ${TM_SELECT}`)).toHaveValue('aces')
    await expect(page.locator(`${HDR_PANEL} ${EV_SLIDER}`)).toHaveValue('-2')
    console.log('[URL] 重新打开后参数已回填到控件')
  })

  test('Bloom 开启后编译运行无报错且画面有可见高光光晕', async ({ page }) => {
    const errors: string[] = []
    const pageErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })
    page.on('pageerror', (err) => pageErrors.push(String(err)))

    // 强制开启 bloom 并压低阈值 / 提高强度，确保场景里有足够亮像素被提取，
    // 从而 bloom 必然产生可见变化（否则 A/B 无法证明 pass 真的跑了）。
    await page.goto('/d/hello-cube?speed=0&bloom=1&bloomThreshold=0.3&bloomIntensity=2')
    await expect(page.locator('canvas').first()).toBeVisible()
    await page.waitForTimeout(1500)

    const bloomOn = await shootClean(page, '07-bloom-on')
    const statsOn = luminanceStats(bloomOn)
    console.log(`[Bloom] 开启 亮度均值=${statsOn.mean.toFixed(2)} 标准差=${statsOn.stddev.toFixed(2)}`)
    expect(statsOn.stddev, 'bloom 开启后画面异常（疑似空白/黑屏）').toBeGreaterThan(5)

    // 关掉 bloom（同阈值，排除阈值本身影响），做像素级 A/B
    await page.goto('/d/hello-cube?speed=0&bloom=0&bloomThreshold=0.3')
    await page.waitForTimeout(1200)
    const bloomOff = await shootClean(page, '08-bloom-off')

    const diff = diffPng(bloomOff, bloomOn)
    console.log(
      `[Bloom] A/B 平均差=${diff.meanAbs.toFixed(3)} 最大差=${diff.maxAbs} 差异>8 像素占比=${(diff.overRatio * 100).toFixed(3)}%`,
    )
    // bloom 必须让部分像素发生变化（高光光晕），否则等于 pass 没生效
    expect(diff.maxAbs, 'bloom 开启后画面与关闭无差异：pass 可能未生效 / 阈值过高').toBeGreaterThan(1)
    expect(diff.overRatio, 'bloom 影响像素占比过低：pass 可能未生效').toBeGreaterThan(0.001)

    // GLSL 编译失败会以 console error / pageerror 形式暴露
    expect(pageErrors, `pageerror: ${pageErrors.join(' | ')}`).toHaveLength(0)
    expect(errors, `console error: ${errors.join(' | ')}`).toHaveLength(0)
  })

  test('探针调试视图（法线 / 线框）在 MRT 下无 GL 错误', async ({ page }) => {
    // 回归守护：MRT 帧缓冲有多个活动 draw buffer，材质必须写满对应数量的
    // fragment output。若调试视图误用 three 内建材质（只写 1 个 out），
    // Chrome 会报「Active draw buffers with missing fragment shader outputs」
    // 且整个 draw 被丢弃（视图直接消失）。两档视图都必须零 console error。
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    for (const view of ['normals', 'wireframe']) {
      await page.goto(`/d/hello-cube?speed=0&debug=${view}`)
      await expect(page.locator('canvas').first()).toBeVisible()
      await page.waitForTimeout(800)
    }

    expect(errors, `console error: ${errors.join(' | ')}`).toHaveLength(0)
  })
})
