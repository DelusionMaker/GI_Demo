import { useFrame } from '@react-three/fiber'
import { recordFrame } from './perfStats'

/**
 * 必须在 <Canvas> 内部。每帧把渲染统计写入非响应式单例。
 *
 * renderPriority = 2：必须晚于 HDRDriver（priority 1）执行。
 * 管线在帧首手动 renderer.info.reset() 后连续提交 beauty 与全屏 pass，
 * 只有在管线之后读到的 calls / triangles 才是整帧累计值。
 */
export function PerfProbe() {
  useFrame((state, delta) => {
    const gl = state.gl as unknown as {
      info: { render: { calls: number; triangles: number } }
    }
    recordFrame(delta * 1000, gl.info.render.calls, gl.info.render.triangles, state.viewport.dpr)
  }, 2)
  return null
}
