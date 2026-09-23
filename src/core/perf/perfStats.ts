export interface PerfSnapshot {
  fps: number
  /** 指数平滑后的帧时间（ms） */
  frameMs: number
  drawCalls: number
  triangles: number
  dpr: number
  /**
   * GPU 时间。
   * TODO(p0-gbuffer-hud): 用 EXT_disjoint_timer_query_webgl2（WebGPU 用 timestamp-query）
   * 按 pass 实测后填充 —— renderer.info 不提供 GPU 时间，不能用于性能归因。
   */
  gpuMs: number | null
}

/**
 * 非响应式的可变单例：由 Canvas 内的 PerfProbe 每帧写入，
 * 由 DOM 侧的 PerfPanel 用 rAF 节流读取。
 * 刻意不走 React state —— 否则 60fps 的更新会引发每帧重渲染。
 */
export const perfStats: PerfSnapshot = {
  fps: 0,
  frameMs: 0,
  drawCalls: 0,
  triangles: 0,
  dpr: 1,
  gpuMs: null,
}

/** 最近 120 帧的帧时间环形缓冲，供后续画帧时间曲线 */
export const frameHistory: number[] = new Array<number>(120).fill(0)

const EMA_ALPHA = 0.1
let smoothedFrameMs = 16.7
let cursor = 0

export function recordFrame(
  frameMs: number,
  drawCalls: number,
  triangles: number,
  dpr: number,
): void {
  smoothedFrameMs = smoothedFrameMs * (1 - EMA_ALPHA) + frameMs * EMA_ALPHA
  perfStats.frameMs = smoothedFrameMs
  perfStats.fps = smoothedFrameMs > 0 ? 1000 / smoothedFrameMs : 0
  perfStats.drawCalls = drawCalls
  perfStats.triangles = triangles
  perfStats.dpr = dpr
  frameHistory[cursor] = frameMs
  cursor = (cursor + 1) % frameHistory.length
}
