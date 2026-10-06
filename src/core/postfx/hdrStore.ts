import { actionBound, makeObservable, observable } from 'mobx'
import type { PassTiming, TargetFormat } from './Pass'
import type { Pipeline } from './Pipeline'

/**
 * HDR 链路的**运行时**状态（MobX），供 HUD 展示。
 *
 * 与 `hdrParams` 的分工：
 * - `hdrParams`（createDemoStore）= 用户旋钮（ev / tm / bypass / 调试视图），带 URL 序列化
 * - `hdrStore`（本文件）      = 管线回报的运行结果（档位 / 计时 / pass 名），5Hz 采样
 *
 * 渲染路径不读本 store 做决策（RT 格式由 HDRPipeline 依据能力位判定），
 * 这里只承载展示，方向是「管线 → store → HUD」。
 */
export class HdrStore {
  /** HDR 链是否已挂载 */
  pipelineActive = false
  /** 浮点目标是否真正生效（false = 已回落 RGBA8，高光会被截断） */
  hdrActive = false
  hdrFormat: TargetFormat = 'RGBA8'
  /** 链上 pass 名，供调试视图下拉使用 */
  passNames: string[] = []
  /** 逐 pass 计时（CPU 侧，5Hz 采样；GPU 时间待 p0-gbuffer-hud） */
  passTimes: PassTiming[] = []
  totalMs = 0
  /** 亮度直方图（归一化 log 亮度分桶计数），5Hz 采样供 HUD 绘制 */
  histogram: number[] = []
  /** 自动曝光算出的 EV，0 表示未启用自动曝光 */
  autoEV = 0
  /** 当前是否处于自动曝光模式 */
  autoExposureActive = false

  /** 当前存活的管线；刻意非 observable（只是转发目标，不参与渲染订阅） */
  private active: Pipeline | null = null

  constructor() {
    makeObservable(this, {
      pipelineActive: observable,
      hdrActive: observable,
      hdrFormat: observable,
      passNames: observable,
      passTimes: observable,
      totalMs: observable,
      histogram: observable,
      autoEV: observable,
      autoExposureActive: observable,
      register: actionBound,
      unregister: actionBound,
      pushStats: actionBound,
      pushHistogram: actionBound,
    })
  }

  register(pipeline: Pipeline): void {
    this.active = pipeline
    this.pipelineActive = true
    this.hdrActive = pipeline.hdrActive
    this.hdrFormat = pipeline.hdrFormat
    this.passNames = pipeline.getPassNames()
  }

  unregister(): void {
    this.active = null
    this.pipelineActive = false
    this.passNames = []
    this.passTimes = []
    this.totalMs = 0
  }

  pushStats(): void {
    const pipeline = this.active
    if (!pipeline) return
    this.passTimes = pipeline.stats.passes
    this.totalMs = pipeline.stats.totalMs
  }

  /** 把 luminance 测光 pass 的直方图与自动曝光状态回传到 HUD（5Hz） */
  pushHistogram(histogram: number[], autoEV: number, active: boolean): void {
    this.histogram = histogram
    this.autoEV = autoEV
    this.autoExposureActive = active
  }
}

export const hdrStore = new HdrStore()
