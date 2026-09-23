import { useFrame } from '@react-three/fiber'
import { recordFrame } from './perfStats'

/** 必须在 <Canvas> 内部。每帧把渲染统计写入非响应式单例。 */
export function PerfProbe() {
  useFrame((state, delta) => {
    const gl = state.gl as unknown as {
      info: { render: { calls: number; triangles: number } }
    }
    recordFrame(delta * 1000, gl.info.render.calls, gl.info.render.triangles, state.viewport.dpr)
  })
  return null
}
