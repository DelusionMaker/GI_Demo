import * as THREE from 'three'
import { FULLSCREEN_VERTEX_SHADER, FullscreenQuad } from '../FullscreenQuad'
import luminanceFrag from '../shaders/luminance.frag'
import type { Pass, PassContext } from '../Pass'

/**
 * 自动曝光测光 pass（p0-hdr 步骤 3/4 落地点）。
 *
 * 设计要点：
 * - **旁路分析 pass**：它读 beauty 的 HDR 输出，把降采样后的 log 亮度写进
 *   自己的内部小 RT（64×64，RGBA8），但 `render()` 返回的是**原 beauty 纹理**，
 *   所以主色彩流（beauty → … → tonemap-output）不被打断。这是把「分析」插进
 *   线性 `Pipeline` 链的最小代价做法，无需改调度核心。
 * - **隔帧回读**：`readback()` 由驱动组件每隔一帧调用一次，避免每帧
 *   `readRenderTargetPixels` 把 GPU 管线 stall 住（这是 TODO 3.6 想讲的性能故事）。
 * - **单一测光出口**：算出的 `autoEV` 由驱动合并进 `pipeline.exposureEV`，
 *   渲染核心只有「曝光从哪来」一条路径（见 HDRPipeline 注释）。
 *
 * 与 React / MobX 完全无关（硬约束）。
 */

const LUM_W = 64
const LUM_H = 64
/** log 亮度归一化区间（EV）。±8 覆盖从极暗到极亮的全部常见场景 */
export const LOG_MIN = -8
export const LOG_MAX = 8
/** 直方图分桶数（沿 log2 亮度轴） */
export const HIST_BINS = 64
/** 中灰关键值（曝光补偿的目标亮度） */
const KEY_VALUE = 0.18
/** 自动曝光平滑系数：越大收敛越快，但太大会振荡。约几帧收敛 */
const ADAPT_SPEED = 0.15
/** autoEV 钳制范围，与 EV 滑杆域对齐，避免首帧/极端场景下 EV 爆掉 */
const EV_CLAMP = 4

export class LuminancePass implements Pass {
  readonly name = 'luminance'
  enabled = true
  /** source === 'prev'：读上一环（beauty）的 HDR 输出 */
  source = 'prev' as const
  /**
   * scale = 1：让 `PassContext.width/height` 等于全分辨率，
   * 从而 `uTexel = 1/全分辨率` 正确。Pipeline 为此会分配一个全分辨率 RGBA8 RT，
   * 但本 pass 实际写入自己的 64×64 内部 RT，那个外部 RT 仅闲置在池里（已知小代价）。
   */
  scale = 1
  target = { format: 'RGBA8' as const, filter: 'linear' as const, samples: 0 }
  toScreen = false

  /** 自动曝光算出的 EV；手动曝光模式下恒为 0，由驱动读取合并进曝光 */
  autoEV = 0
  /** 最近一次直方图（归一化 log 亮度分桶计数），供 HUD 绘制 */
  histogram: number[] = new Array(HIST_BINS).fill(0)
  /** 当前是否处于自动曝光模式（仅供展示） */
  autoExposureActive = false

  private readonly quad: FullscreenQuad
  private readonly rt: THREE.WebGLRenderTarget
  private readonly pixels = new Uint8Array(LUM_W * LUM_H * 4)

  private smoothedEV = 0
  private inited = false

  constructor() {
    this.rt = new THREE.WebGLRenderTarget(LUM_W, LUM_H, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    })
    this.rt.texture.colorSpace = THREE.NoColorSpace

    this.quad = new FullscreenQuad(
      new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: FULLSCREEN_VERTEX_SHADER,
        fragmentShader: luminanceFrag,
        uniforms: {
          tColor: { value: null },
          uTexel: { value: new THREE.Vector2(1, 1) },
          uLogMin: { value: LOG_MIN },
          uLogMax: { value: LOG_MAX },
        },
        depthTest: false,
        depthWrite: false,
      }),
    )
  }

  render(ctx: PassContext, _target: THREE.WebGLRenderTarget | null): THREE.Texture | null {
    const uniforms = this.quad.material.uniforms
    uniforms.tColor.value = ctx.input
    uniforms.uTexel.value.set(1 / ctx.width, 1 / ctx.height)
    // 写进自己的 64×64 内部 RT，不碰 Pipeline 分配的 target
    this.quad.render(ctx.renderer, this.rt)
    // 旁路：把原 HDR 图透传下去，主色彩流不受影响
    return ctx.input
  }

  /**
   * 隔帧回读：解码平均 log 亮度 → 自动 EV；同时分桶出直方图。
   *
   * @param autoExposure 是否参与自动曝光（false 时仅更新直方图，autoEV 归零）
   * @param displayEV    当前生效曝光（手动 EV + 自动 EV），直方图按它平移，
   *                     从而「直方图随 EV 平移」可被肉眼验证
   */
  readback(renderer: THREE.WebGLRenderer, autoExposure: boolean, displayEV: number): void {
    renderer.readRenderTargetPixels(this.rt, 0, 0, LUM_W, LUM_H, this.pixels)

    const span = LOG_MAX - LOG_MIN
    const bins = this.histogram
    bins.fill(0)

    let sumLog = 0
    const count = LUM_W * LUM_H

    // ======================================================================
    // 算法段（自写 · 自动曝光 + 直方图）：解码回读字节 → 几何平均亮度 + 分桶
    //
    // 1) 每个纹素存的是「归一化 log 亮度」n∈[0,1]，反归一化得 log2 亮度。
    // 2) 自动曝光目标：middle-gray 曝光补偿。几何平均亮度 L = 2^avgLog，
    //    目标 EV = log2(KEY / L)（KEY=0.18 ≈ 18% 灰）。
    // 3) 帧率无关平滑：smoothedEV += (targetEV - smoothedEV) * ADAPT_SPEED，
    //    指数逼近，约几帧收敛、无明显振荡。
    // 4) 直方图按 (logL + displayEV) 平移：displayEV 是当前生效曝光，
    //    这样拖动 EV 滑杆 / 自动收敛时，直方图整体左右平移，肉眼可验证。
    // 这部分数学必须由你本人讲清楚。
    // ======================================================================
    for (let i = 0; i < count; i++) {
      const n = this.pixels[i * 4] / 255
      const logL = LOG_MIN + n * span
      sumLog += logL

      // 直方图：以当前生效曝光（displayEV）为基准平移后分桶
      let bin = Math.floor(((logL + displayEV - LOG_MIN) / span) * HIST_BINS)
      if (bin < 0) bin = 0
      else if (bin >= HIST_BINS) bin = HIST_BINS - 1
      bins[bin]++
    }

    const avgLog = sumLog / count
    const avgLum = Math.pow(2, avgLog)
    const targetEV = Math.max(-EV_CLAMP, Math.min(EV_CLAMP, Math.log2(KEY_VALUE / avgLum)))

    if (autoExposure) {
      if (!this.inited) {
        // 首帧用目标值直接落位，避免从 0 起步的整屏过曝闪烁
        this.smoothedEV = targetEV
        this.inited = true
      } else {
        this.smoothedEV += (targetEV - this.smoothedEV) * ADAPT_SPEED
      }
      this.autoEV = this.smoothedEV
      this.autoExposureActive = true
    } else {
      this.autoEV = 0
      this.autoExposureActive = false
      this.inited = false
    }
  }

  dispose(): void {
    this.rt.dispose()
    this.quad.dispose()
  }
}
