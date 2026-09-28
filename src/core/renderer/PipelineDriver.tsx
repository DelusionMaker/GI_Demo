import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import type { Pipeline } from './Pipeline'
import { renderStore } from './renderStore'

/**
 * useFrame 的 priority > 0 会让 R3F 跳过它自己的 render 调用
 * （R3F 内部判据：`if (!state.internal.priority && state.gl.render) ...`）。
 * 这正是「自建 pass 接管渲染」所需的开关 —— 渲染只发生一次，不会与 R3F 重复。
 */
const RENDER_PRIORITY = 1

/** 统计信息的推送节流：与 perfStore 的 5Hz 采样保持一致，避免每帧触发重渲染 */
const STATS_INTERVAL_MS = 200

/**
 * Pipeline 与 R3F 的唯一接触点：驱动帧、同步尺寸、回传统计。
 * 自身不产出任何 DOM。
 */
export function PipelineDriver({ pipeline }: { pipeline: Pipeline }) {
  const size = useThree((state) => state.size)
  const viewport = useThree((state) => state.viewport)
  const lastStatsPush = useRef(0)

  // 尺寸 / DPR 变化时重建 RenderTarget（render() 内还会用 drawingBufferSize 复核）
  useEffect(() => {
    pipeline.resize(size.width, size.height, viewport.dpr)
  }, [pipeline, size.width, size.height, viewport.dpr])

  useFrame((state) => {
    // UI 开关 → 渲染核心（渲染核心不感知 MobX，方向始终是单向同步）
    pipeline.bypass = renderStore.bypass
    pipeline.debugPass = renderStore.debugPass

    pipeline.render(state.scene, state.camera)

    const now = performance.now()
    if (now - lastStatsPush.current >= STATS_INTERVAL_MS) {
      lastStatsPush.current = now
      renderStore.pushStats(pipeline.stats, pipeline.hdrActive, pipeline.hdrFormat)
    }
  }, RENDER_PRIORITY)

  return null
}
