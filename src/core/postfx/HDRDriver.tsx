import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { HDRPipeline } from './HDRPipeline'
import { hdrParams, resolveDebugPass } from './hdrParams'
import { hdrStore } from './hdrStore'

/** 统计推送节流：与 perfStore 的 5Hz 采样一致，避免每帧触发重渲染 */
const STATS_INTERVAL_MS = 200

/**
 * HDR 管线在 R3F 内的驱动组件（必须位于 <Canvas> 内）。
 *
 * 职责：
 * - 按物理像素尺寸（CSS size × DPR）创建 / 调整 HDRPipeline；
 * - 用 renderPriority = 1 接管 R3F 的自动渲染：一旦存在 priority > 0 的
 *   useFrame，R3F 不再自动渲染默认后缓冲，改由管线每帧
 *   「场景 → HDR RT → 全屏 pass → canvas」；
 * - 每帧把 UI 旋钮（曝光 / 曲线 / 旁路 / 调试视图）推进管线；
 * - 卸载时释放 RT / 材质 / quad 几何。
 *
 * 数据流是单向的：`hdrParams`（带 URL 序列化的旋钮）→ 管线；
 * 逐 pass 计时按 5Hz 反向回传给 `hdrStore` 供面板展示。
 * 渲染核心本身不感知 MobX。
 */
export function HDRDriver() {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)
  const dpr = useThree((state) => state.viewport.dpr)
  const lastStatsPush = useRef(0)
  /** 隔帧回读开关：避免每帧 readPixels 把 GPU 管线 stall（TODO 3.6 的性能故事） */
  const readbackToggle = useRef(false)

  const pipeline = useMemo(
    () => new HDRPipeline(Math.round(size.width * dpr), Math.round(size.height * dpr)),
    // 只在挂载时创建一次；resize 走下面的 effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  useEffect(() => {
    pipeline.setSize(Math.round(size.width * dpr), Math.round(size.height * dpr))
  }, [pipeline, size.width, size.height, dpr])

  useEffect(() => {
    hdrStore.register(pipeline.pipeline)
    return () => {
      hdrStore.unregister()
      pipeline.dispose()
    }
  }, [pipeline])

  useFrame(() => {
    const core = pipeline.pipeline
    const knobs = hdrParams.params

    // UI 旋钮 → 渲染核心（渲染核心不认识 MobX）
    core.bypass = knobs.bypass
    core.debugPass = resolveDebugPass(knobs.hdrDebug)
    pipeline.setTonemap(knobs.tm)
    pipeline.setClipView(knobs.clipView)

    // 自动曝光：手动 EV 在自动模式下作为补偿量叠加；关闭时直接用手动 EV。
    // autoEV 来自上一帧的回读结果（自动曝光有 1 帧延迟，这是有意为之）。
    const displayEV = knobs.autoexposure
      ? pipeline.luminance.autoEV + knobs.ev
      : knobs.ev
    pipeline.setExposureEV(displayEV)

    // Bloom 开关与强度（算法段由用户实现，这里只同步旋钮）
    pipeline.bloom.enabled = knobs.bloom
    pipeline.bloom.intensity = knobs.bloomIntensity

    // 先渲染：luminance pass 会把本帧的测光小图写进自己的 RT
    pipeline.render(gl, scene, camera)

    // 再隔帧回读（读的是本帧刚渲好的测光 RT）→ 更新 autoEV + 直方图，供下一帧使用
    readbackToggle.current = !readbackToggle.current
    if (readbackToggle.current) {
      pipeline.luminance.readback(gl, knobs.autoexposure, displayEV)
    }

    const now = performance.now()
    if (now - lastStatsPush.current >= STATS_INTERVAL_MS) {
      lastStatsPush.current = now
      hdrStore.pushStats()
      hdrStore.pushHistogram(
        pipeline.luminance.histogram,
        pipeline.luminance.autoEV,
        pipeline.luminance.autoExposureActive,
      )
    }
  }, 1)

  return null
}
