import type * as THREE from 'three'
import { capabilitiesStore } from '../capabilities'
import { Pipeline } from './Pipeline'
import { BeautyPass } from './passes/BeautyPass'
import { TonemapOutputPass } from './passes/TonemapOutputPass'
import type { PassTiming } from './Pass'

export type { PassTiming }

/**
 * HDR 后处理管线（p0-hdr 落地点）。
 *
 * 设计原则（见 TODO.md「职责边界」）：
 * - 与 React 完全无关的纯 TS class，React 侧只负责在 useFrame 里调 render()。
 * - 消费「场景」而不是「相机后缓冲」：场景先渲到自建 HDR RT，
 *   后续全部 pass 在全屏 quad 上完成，three 只管场景图与资源。
 *
 * 演进：步骤 1 时这里写死了「beauty + 全屏输出」两段；
 * 现已下沉为通用 `Pipeline` + 可插拔 `Pass`，本类只保留
 * 「选 RT 格式 / 组装链路 / 对外门面」三件事，公开 API 未变。
 *
 * p0-hdr 分步：
 *   1. 本骨架：RGBA16F 目标 + 直通输出（手写线性→sRGB），画面与接入前一致
 *   2. EV 滑杆 + ACES / AgX / Reinhard 曲线切换
 *   3. 物理 bloom：半分辨率 mip 链（先加 bloom 后 tonemap）
 *   4. 自动曝光：mip 测光 + 跨帧异步回读 + 帧率无关适应
 *
 * ⚠️ 前置约束（步骤 1 记录有误，已修正）：色调映射必须全局关闭，
 * 但**仅靠 createRenderer 里设 toneMapping = NoToneMapping 是不够的** ——
 * R3F 在 configure 阶段会执行
 * `gl.toneMapping = flat ? NoToneMapping : ACESFilmicToneMapping`，
 * 把我们的设置覆盖掉。因此 `<Canvas>` 必须显式传 `flat`，
 * 否则材质侧已经做过一次 ACES，HDR RT 里存的就不是线性 HDR 值，
 * 步骤 2 的曲线会在已映射过的数据上再映射一次。
 */

/**
 * 色调映射模式。索引要与 `passes/TonemapOutputPass.ts` 的 `tonemap()` 分支、
 * 以及 `toneCurves.ts` 的 `TONE_CURVES` 三处保持一致。
 */
export type TonemapMode = 'linear' | 'aces' | 'agx' | 'reinhard'

const TONEMAP_INDEX: Record<TonemapMode, number> = {
  linear: 0,
  aces: 1,
  agx: 2,
  reinhard: 3,
}

export interface HDRPipelineOptions {
  /**
   * HDR RT 的 MSAA 采样数，0 关闭。
   * 注意：three 只自动 resolve 颜色，DepthTexture 在 MSAA 下不保证可采样；
   * 当前阶段不读深度所以安全，到 p0-gbuffer-hud 需要读深度时要复核
   * （或届时改走 TAA，移动端直接 0）。
   */
  samples?: number
}

export class HDRPipeline {
  /** false = 无 EXT_color_buffer_float，已降级到 RGBA8（高光会截断），HUD 需显式标注 */
  readonly hdrSupported: boolean

  /** 底层通用管线：UI 侧用它切换 bypass / 调试视图，并读取逐 pass 计时 */
  readonly pipeline: Pipeline

  private readonly beauty = new BeautyPass()
  private readonly output = new TonemapOutputPass()

  private static warnedFallback = false

  constructor(width: number, height: number, options: HDRPipelineOptions = {}) {
    // 16F 可渲染依赖 EXT_color_buffer_float；16F 线性过滤不依赖
    // OES_texture_float_linear（那是 32F 才需要），正好绕开该限制。
    this.hdrSupported = capabilitiesStore.colorBufferFloat
    if (options.samples !== undefined) this.beauty.target.samples = options.samples

    this.pipeline = new Pipeline({ hdr: this.hdrSupported })
    this.pipeline.addPass(this.beauty)
    this.pipeline.addPass(this.output)
    this.pipeline.setSize(width, height)

    // 默认值：EV=0（exp2(0)=1 直通）、线性曲线
    this.setExposureEV(0)
    this.setTonemap('linear')

    if (!this.hdrSupported && !HDRPipeline.warnedFallback) {
      HDRPipeline.warnedFallback = true
      console.warn(
        '[HDRPipeline] 不支持 EXT_color_buffer_float，降级到 RGBA8：>1 的高光会被截断，HUD 应标注当前档位',
      )
    }
  }

  /** 逐 pass 计时表，顺序即链路顺序（步骤 3/4 会在中间插入 luminance / bloom 各级） */
  get passTimes(): PassTiming[] {
    return this.pipeline.stats.passes
  }

  get passNames(): string[] {
    return this.pipeline.getPassNames()
  }

  /**
   * EV 曝光偏移（手动/自动模式共用；自动模式下这是测光结果上的偏移）。
   *
   * 只写进 Pipeline：导出 pass 每帧从 `PassContext` 读曝光、不做本地缓存，
   * 这样「曝光从哪来」只有一条路径，不会出现两处状态不同步。
   */
  setExposureEV(ev: number): void {
    this.pipeline.exposureEV = ev
  }

  setTonemap(mode: TonemapMode): void {
    // URL 里的 tm 可能是任意字符串，取不到索引时退回直通，避免写入 undefined
    this.output.setTonemapIndex(TONEMAP_INDEX[mode] ?? TONEMAP_INDEX.linear)
  }

  /**
   * 物理像素尺寸（CSS 尺寸 × DPR）。
   * RT.setSize 会同步调整已挂载的 DepthTexture，无需手动处理。
   */
  setSize(width: number, height: number): void {
    this.pipeline.setSize(width, height)
  }

  /**
   * 一帧：场景 → HDR RT（beauty）→ 全屏 tonemap/output → canvas。
   * 调用方需用 R3F 的 renderPriority 接管自动渲染（useFrame(_, priority > 0)），
   * 否则 R3F 仍会自动渲染一次默认后缓冲。
   */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    this.pipeline.render(renderer, scene, camera)
  }

  dispose(): void {
    this.pipeline.dispose()
  }
}
