import { useThree } from '@react-three/fiber'
import { useEffect, useState } from 'react'
import type * as THREE from 'three'
import { Pipeline } from './Pipeline'
import { PipelineDriver } from './PipelineDriver'
import { renderStore } from './renderStore'
import { DisplayPass } from './passes/DisplayPass'
import { ScenePass } from './passes/ScenePass'

/** 默认链路：场景 → HDR 目标 → 呈现。色调映射 / bloom 在 S2、S4 插入中间。 */
function createDefaultPipeline(renderer: THREE.WebGLRenderer): Pipeline {
  const pipeline = new Pipeline(renderer)
  pipeline.addPass(new ScenePass())
  pipeline.addPass(new DisplayPass())
  return pipeline
}

/**
 * 自建 pass 链的宿主，必须放在 `<Canvas>` 内部（需要拿到 R3F 的 renderer）。
 *
 * 生命周期刻意用「effect 内创建 + state 持有」而不是 useMemo：
 * StrictMode 下 effect 会执行 mount → cleanup → mount，
 * 若把实例 memo 住，第一次 cleanup 里的 dispose 会让它永久失效（画面全黑）。
 * 每次 effect 重建实例可彻底避开这个坑。
 */
export function PostFX() {
  const gl = useThree((state) => state.gl)
  const [pipeline, setPipeline] = useState<Pipeline | null>(null)

  useEffect(() => {
    const renderer = gl as unknown as THREE.WebGLRenderer
    const instance = createDefaultPipeline(renderer)
    setPipeline(instance)
    renderStore.registerPipeline(instance)

    return () => {
      renderStore.unregisterPipeline()
      instance.dispose()
    }
  }, [gl])

  if (!pipeline) return null
  return <PipelineDriver pipeline={pipeline} />
}
