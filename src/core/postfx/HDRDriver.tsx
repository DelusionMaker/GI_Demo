import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { HDRPipeline } from './HDRPipeline'

/**
 * HDR 管线在 R3F 内的驱动组件（必须位于 <Canvas> 内）。
 *
 * 职责：
 * - 按物理像素尺寸（CSS size × DPR）创建 / 调整 HDRPipeline；
 * - 用 renderPriority = 1 接管 R3F 的自动渲染：一旦存在 priority > 0 的
 *   useFrame，R3F 不再自动渲染默认后缓冲，改由管线每帧
 *   「场景 → HDR RT → 全屏 pass → canvas」；
 * - 卸载时释放 RT / 材质 / quad 几何。
 *
 * 不持有任何 demo 参数：曝光 EV、曲线模式等后续由控制面板经 store
 * 驱动，这里只保证管线存活与每帧提交。
 */
export function HDRDriver() {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)
  const dpr = useThree((state) => state.viewport.dpr)

  const pipeline = useMemo(
    () => new HDRPipeline(Math.round(size.width * dpr), Math.round(size.height * dpr)),
    // 只在挂载时创建一次；resize 走下面的 effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  useEffect(() => {
    pipeline.setSize(Math.round(size.width * dpr), Math.round(size.height * dpr))
  }, [pipeline, size.width, size.height, dpr])

  useEffect(() => () => pipeline.dispose(), [pipeline])

  useFrame(() => {
    pipeline.render(gl, scene, camera)
  }, 1)

  return null
}
