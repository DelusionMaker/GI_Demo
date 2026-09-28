import { useFrame } from '@react-three/fiber'
import { recordFrame } from './perfStats'

/**
 * 必须在 <Canvas> 内部。每帧把渲染统计写入非响应式单例。
 *
 * priority 必须高于 PipelineDriver(1)：useFrame 按 priority 升序执行，
 * 排在自建 pass 链之后才能读到本帧真实的 draw call。
 * 另外任意 priority > 0 都会关闭 R3F 的自动渲染 —— 与 PipelineDriver 的意图一致。
 */
const PROBE_PRIORITY = 2

export function PerfProbe() {
  useFrame((state, delta) => {
    const gl = state.gl as unknown as {
      info: { render: { calls: number; triangles: number } }
    }
    recordFrame(delta * 1000, gl.info.render.calls, gl.info.render.triangles, state.viewport.dpr)
  }, PROBE_PRIORITY)

  return null
}
