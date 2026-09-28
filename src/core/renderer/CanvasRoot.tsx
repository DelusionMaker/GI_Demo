import { Canvas } from '@react-three/fiber'
import type { ReactNode } from 'react'
import { PerfProbe } from '../perf/PerfProbe'
import { createRenderer } from './createRenderer'
import { PostFX } from './PostFX'

export interface CanvasRootProps {
  children: ReactNode
  /** 初始相机位姿；预设视角交给 CameraRig 管理 */
  cameraPosition?: [number, number, number]
  fov?: number
  shadows?: boolean
  /** 是否允许用户交互（降级到视频/截图片时置 false） */
  interactive?: boolean
}

/**
 * 全站统一的 R3F Canvas 封装。
 * 负责：DPR 上限（移动端带宽红线）、渲染器工厂接线、HDR 链路与性能探针挂载。
 */
export function CanvasRoot({
  children,
  cameraPosition = [3, 2, 4],
  fov = 45,
  shadows = false,
  interactive = true,
}: CanvasRootProps) {
  return (
    <Canvas
      className="canvas-root"
      dpr={[1, 2]}
      shadows={shadows}
      /**
       * flat = 关闭 R3F 默认的 ACESFilmic 色调映射
       * （R3F 内部：`gl.toneMapping = flat ? NoToneMapping : ACESFilmicToneMapping`）。
       * 色调映射归自建 pass 负责；不关掉会与后处理链重复映射，画面发灰。
       */
      flat
      frameloop={interactive ? 'always' : 'demand'}
      camera={{ position: cameraPosition, fov, near: 0.05, far: 500 }}
      gl={createRenderer}
    >
      <PostFX>
        <PerfProbe />
        {children}
      </PostFX>
    </Canvas>
  )
}
