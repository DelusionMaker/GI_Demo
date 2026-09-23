import { actionBound, makeObservable, observable } from 'mobx'
import { perfStats } from './perfStats'

/** 采样间隔：刻意远低于帧率，面板不需要每帧刷新 */
const SAMPLE_INTERVAL_MS = 200

/**
 * 性能面板的数据源（MobX）。
 *
 * 分工：
 * - `perfStats`（非响应式）由画布内的 PerfProbe 每帧写入 —— 那里绝不能触发 React 更新
 * - 本 store 以 5Hz 把它采样成 observable，供 PerfPanel 作为普通 observer 组件消费
 *
 * 这样既保留了「每帧采集不引发重渲染」的性能保证，面板代码也不必再手写 DOM 写入。
 */
export class PerfStore {
  fps = 0
  frameMs = 0
  drawCalls = 0
  triangles = 0
  dpr = 1
  gpuMs: number | null = null

  private timer: ReturnType<typeof setInterval> | null = null

  constructor() {
    makeObservable(this, {
      fps: observable,
      frameMs: observable,
      drawCalls: observable,
      triangles: observable,
      dpr: observable,
      gpuMs: observable,
      sample: actionBound,
    })
  }

  startSampling(): void {
    if (this.timer !== null) return
    this.timer = setInterval(this.sample, SAMPLE_INTERVAL_MS)
  }

  stopSampling(): void {
    if (this.timer === null) return
    clearInterval(this.timer)
    this.timer = null
  }

  sample(): void {
    this.fps = perfStats.fps
    this.frameMs = perfStats.frameMs
    this.drawCalls = perfStats.drawCalls
    this.triangles = perfStats.triangles
    this.dpr = perfStats.dpr
    this.gpuMs = perfStats.gpuMs
  }
}

export const perfStore = new PerfStore()
