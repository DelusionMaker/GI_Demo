import type * as THREE from 'three'

export type TargetFormat = 'RGBA16F' | 'RGBA8'

/** 单帧渲染时传给各 pass 的运行时状态（不含任何 UI / 状态库概念） */
export interface PassContext {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.Camera
  /** 本环目标的像素尺寸（已乘 scale） */
  width: number
  height: number
  /** 帧序号：供时域抖动 / 蓝噪声 / 隔帧异步回读使用 */
  frame: number
  /** 上一环的输出；链首为 null。source === 'prev' 的 pass 必须读它 */
  input: THREE.Texture | null
  /** 当前曝光值（EV 语义的线性倍数）。自动曝光在 S3 接入，会有 1 帧延迟 */
  exposure: number
}

export interface PassTargetSpec {
  format: TargetFormat
  filter: 'linear' | 'nearest'
  /**
   * MSAA 采样数；0 = 关闭。
   * 注意：渲到 RenderTarget 会丢失默认后缓冲的 MSAA，
   * 不显式补回的话，边缘锯齿会与「直接渲到屏幕」的老路径产生可见差异。
   */
  samples?: number
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
   * source === 'prev' 时实现。
   * target 为 null 表示输出到屏幕；返回 null 表示「已出屏，链路到此结束」。
   */
  render?(ctx: PassContext, target: THREE.WebGLRenderTarget | null): THREE.Texture | null
  /** GPU 计时归因，由 p0-gbuffer-hud 接入后填充 */
  lastGpuMs?: number
  dispose(): void
}

export interface PassStat {
  name: string
  /** CPU 侧耗时（ms）。GPU 时间需要 timer query，见 p0-gbuffer-hud */
  ms: number
}
