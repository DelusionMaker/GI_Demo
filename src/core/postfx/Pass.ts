import type * as THREE from 'three'

export type TargetFormat = 'RGBA16F' | 'RGBA8'

/** 单帧渲染时传给各 pass 的运行时状态（不含任何 UI / 状态库概念） */
export interface PassContext {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.Camera
  /** 本环目标的物理像素尺寸（已乘 scale） */
  width: number
  height: number
  /** 帧序号：供时域抖动 / 蓝噪声 / 隔帧异步回读使用 */
  frame: number
  /** 上一环的输出；链首为 null。source === 'prev' 的 pass 必须读它 */
  input: THREE.Texture | null
  /** 链首（beauty）产生的深度纹理，供后续 SSR / SSGI 复用；无则为 null */
  inputDepth: THREE.DepthTexture | null
  /**
   * 链首（beauty）产出的 G-buffer MRT（本帧已渲好；未启用 MRT / 尚未渲染时为 null）。
   * 供 S3 调试视图与后续 SSR / SSGI 读取；textures[0..2] = gAlbedo / gNormal / gMRAO。
   */
  gBuffer: THREE.WebGLRenderTarget | null
  /** 曝光偏移（EV 语义）。着色器内 multiplier = exp2(exposureEV) */
  exposureEV: number
}

export interface GBufferAttachment {
  /** 附件名（用于调试视图与后续 SSR / SSGI 读取） */
  name: 'gAlbedo' | 'gNormal' | 'gMRAO'
  format: TargetFormat
  filter: 'linear' | 'nearest'
}

export interface PassTargetSpec {
  format: TargetFormat
  filter: 'linear' | 'nearest'
  /**
   * MSAA 采样数，0 = 关闭。
   * 渲染器的 antialias 只对默认后缓冲有效；渲到自建 RT 后必须自带 multisample，
   * 否则边缘锯齿会与「直接渲到屏幕」的老路径产生可见差异。
   */
  samples?: number
  /**
   * 是否附带可采样的 DepthTexture（p0-gbuffer-hud / SSR / SSGI 都要复用深度，故在 RT 创建时即挂好）。
   *
   * ⚠️ 沿用 p0-hdr 步骤 1 记录的风险：three 只自动 resolve **颜色**，
   * MSAA 下 DepthTexture 不保证可采样。当前阶段不读深度所以安全，
   * 到 p0-gbuffer-hud 真正读深度时必须复核（或届时改走 TAA）。
   */
  depthTexture?: boolean
  /**
   * G-buffer MRT 附件（p0-gbuffer-hud）。存在且长度 > 1 时创建多渲染目标；
   * 下游以 `target.textures[0]`（gAlbedo）作为 beauty 颜色继续后续链路。
   * 不设置或长度为 1 时退化为普通单目标。
   */
  mrt?: GBufferAttachment[]
}

export interface Pass {
  readonly name: string
  /** 由控制面板 / URL 参数驱动 */
  enabled: boolean
  /** 分辨率缩放：1 = 全分辨率，0.5 = 半分辨率 */
  scale: number
  /** 'scene' = 把场景直接渲进本环（由 Pipeline 执行 renderer.render）；'prev' = 全屏处理上一环输出 */
  source: 'scene' | 'prev'
  /** 对 RenderTarget 的格式需求；toScreen 为 true 时该字段被忽略 */
  target: PassTargetSpec
  /** 链尾 pass：直接输出到屏幕，Pipeline 不为它分配 RenderTarget */
  toScreen?: boolean
  /**
   * Pass 自己管理渲染目标（如阴影深度图集）。
   * 为 true 时 Pipeline 不分配 target、传入 null；`render()` 返回什么就作为
   * 下一环的 input（辅助 pass 通常原样返回 `ctx.input`）。
   */
  selfManaged?: boolean
  /**
   * source === 'prev' 时实现。
   * target 为 null 表示输出到屏幕；返回 null 表示「已出屏，链路到此结束」。
   */
  render?(ctx: PassContext, target: THREE.WebGLRenderTarget | null): THREE.Texture | null
  /** 单 pass GPU 耗时；p0-gbuffer-hud 接 EXT_disjoint_timer_query_webgl2 后由各 pass 填入 */
  lastGpuMs?: number
  dispose(): void
}

/** 与 DEVLOG 中记录的 PassTiming 结构保持一致 */
export interface PassTiming {
  name: string
  /** CPU 侧耗时（performance.now），仅反映提交成本 */
  cpuMs: number
  /** 单 pass GPU 耗时；p0-gbuffer-hud 接 EXT_disjoint_timer_query_webgl2 后填充 */
  gpuMs: number | null
}

export interface PipelineStats {
  passes: PassTiming[]
  totalMs: number
}
