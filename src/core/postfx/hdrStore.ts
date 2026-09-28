import { actionBound, makeObservable, observable } from 'mobx'
import type { PassTiming, TargetFormat } from './Pass'
import type { Pipeline } from './Pipeline'

/**
 * HDR 链路的 UI 侧状态（MobX）。
 *
 * 分工与 perfStore 一致：
 * - `Pipeline` 是纯类，每帧写普通字段，不感知 React / MobX
 * - 本 store 由 HDRDriver 按 5Hz 采样后持有 observable，供 HUD 消费
 *
 * 渲染路径本身不读本 store 做决策（RT 格式由 HDRPipeline 依据能力位判定），
 * 这里只承载「展示」与「用户开关」。
 */
export class HdrStore {
  /** HDR 链是否已挂载 */
  pipelineActive = false
  /** 浮点目标是否真正生效（false = 已回落 RGBA8，高光会被截断） */
  hdrActive = false
  hdrFormat: TargetFormat = 'RGBA8'
  /** 旁路整条链（走场景直出），用于 A/B 对比 */
  bypass = false
  /** 中间量可视化：仅呈现某个 pass 的输出 */
  debugPass: string | null = null
  /** 链上 pass 名，供调试视图下拉使用 */
  passNames: string[] = []
  /** 逐 pass 计时（CPU 侧，5Hz 采样；GPU 时间待 p0-gbuffer-hud） */
  passTimes: PassTiming[] = []
  totalMs = 0

  /** 当前存活的管线；刻意非 observable（只是转发目标，不参与渲染订阅） */
  private active: Pipeline | null = null

  constructor() {
    makeObservable(this, {
      pipelineActive: observable,
      hdrActive: observable,
      hdrFormat: observable,
      bypass: observable,
      debugPass: observable,
      passNames: observable,
      passTimes: observable,
      totalMs: observable,
      setBypass: actionBound,
      setDebugPass: actionBound,
      register: actionBound,
      unregister: actionBound,
      pushStats: actionBound,
    })
  }

  setBypass(value: boolean): void {
    this.bypass = value
  }

  setDebugPass(value: string | null): void {
    this.debugPass = value
  }

  register(pipeline: Pipeline): void {
    this.active = pipeline
    this.pipelineActive = true
    this.hdrActive = pipeline.hdrActive
    this.hdrFormat = pipeline.hdrFormat
    this.passNames = pipeline.getPassNames()
    this.bypass = pipeline.bypass
    this.debugPass = pipeline.debugPass
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
}

export const hdrStore = new HdrStore()
