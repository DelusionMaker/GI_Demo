import { actionBound, makeObservable, observable } from 'mobx'
import type { Pipeline, PipelineStats } from './Pipeline'
import type { TargetFormat } from './Pass'

/**
 * 渲染链路的 UI 侧状态（MobX）。
 *
 * 分工与 perfStore 一致：
 * - `Pipeline` 是纯类，每帧写入普通字段，不感知 React / MobX
 * - 本 store 由 PipelineDriver 按 5Hz 采样后持有 observable，供 HUD 消费
 *
 * 渲染路径本身不读本 store 做决策（HDR 能力由 Pipeline 自己判定），
 * 这里只承载「展示」与「用户开关」。
 */
export class RenderStore {
  /** 自建 pass 链是否已挂载 */
  pipelineActive = false
  /** 场景 pass 实际可用的目标格式 */
  hdrFormat: TargetFormat = 'RGBA8'
  /** 是否真的用上了浮点目标；false 表示已回落 RGBA8，高光会在写入时截断 */
  hdrActive = false
  /** 旁路整条链（走场景直出），用于 A/B 对比 */
  bypass = false
  /** 中间量可视化：直接呈现某个 pass 的输出 */
  debugPass: string | null = null
  /** 链上 pass 名，供调试视图下拉使用 */
  passNames: string[] = []
  /** 各环耗时（CPU 侧，5Hz 采样） */
  passStats: PipelineStats = { passes: [], totalMs: 0 }

  constructor() {
    makeObservable(this, {
      pipelineActive: observable,
      hdrFormat: observable,
      hdrActive: observable,
      bypass: observable,
      debugPass: observable,
      passNames: observable,
      passStats: observable,
      setBypass: actionBound,
      setDebugPass: actionBound,
      registerPipeline: actionBound,
      unregisterPipeline: actionBound,
      pushStats: actionBound,
    })
  }

  setBypass(value: boolean): void {
    this.bypass = value
  }

  setDebugPass(value: string | null): void {
    this.debugPass = value
  }

  registerPipeline(pipeline: Pipeline): void {
    this.pipelineActive = true
    this.hdrFormat = pipeline.hdrFormat
    this.hdrActive = pipeline.hdrActive
    this.passNames = pipeline.getPassNames()
  }

  unregisterPipeline(): void {
    this.pipelineActive = false
    this.passNames = []
    this.passStats = { passes: [], totalMs: 0 }
  }

  pushStats(stats: PipelineStats, hdrActive: boolean, hdrFormat: TargetFormat): void {
    this.passStats = stats
    this.hdrActive = hdrActive
    this.hdrFormat = hdrFormat
  }
}

export const renderStore = new RenderStore()
