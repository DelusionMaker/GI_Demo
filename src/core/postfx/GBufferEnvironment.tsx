import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { capabilitiesStore } from '../capabilities'
import { gbufferShared } from './materials/gbufferShared'

/**
 * G-buffer 材质的环境贴图（p1-pbr-ibl 的 IBL 原料）。
 *
 * 用 three 的 `RoomEnvironment`（程序化房间，**不需要外部 HDR 资产**）渲进一张
 * 带 mipmap 的立方体贴图：shader 里按 roughness 选 LOD 采样，作为 split-sum 的
 * 「预滤波环境」近似。
 *
 * 已知近似（写进 demo limitations）：
 * - CubeCamera 的 mip 链是 box filter，不是 GGX 重要性采样预滤波；
 * - split-sum 的 DFG 项交给 `gbuffer.frag` 的自写算法段（TODO(p1)）。
 *
 * 挂载在 Canvas 内即可，生命周期跟随画布（StrictMode 双挂载会重建一次）。
 */
export function GBufferEnvironment() {
  const gl = useThree((state) => state.gl)

  useEffect(() => {
    const envScene = new RoomEnvironment()
    // HDR 环境：有浮点颜色缓冲时用半精度，否则退回 8bit（高光会截断）
    const rt = new THREE.WebGLCubeRenderTarget(256, {
      type: capabilitiesStore.colorBufferFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
    })
    const cubeCamera = new THREE.CubeCamera(0.1, 1000, rt)
    cubeCamera.update(gl, envScene)

    gbufferShared.uEnvMap.value = rt.texture

    return () => {
      gbufferShared.uEnvMap.value = null
      gbufferShared.uHasEnv.value = 0
      rt.dispose()
      envScene.dispose()
    }
  }, [gl])

  return null
}
