import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import { capabilitiesStore } from '../capabilities'
import { ENV_SIZE, gbufferShared } from './materials/gbufferShared'

/**
 * G-buffer 材质的环境贴图（p1-pbr-ibl 的 IBL 原料）。
 *
 * 两种来源：
 * - `url` 为空：three 的 `RoomEnvironment` 程序化房间（Cornell / 室内占位用）；
 * - `url` 有值：Poly Haven 等来源的 equirectangular HDR，经
 *   `WebGLCubeRenderTarget.fromEquirectangularTexture` 转成带 mip 的立方体贴图；
 *   同时把原始 equirect HDR 留给 `SkyMaterial` 当可见天空背景。
 *
 * 为什么必须带 mip：gbuffer.frag 的 `iblSpecular` 用 roughness → LOD 采样预滤波环境；
 * 没有 mip 链时粗糙表面会退回 L0（镜面），观感会明显错误。
 *
 * 已知近似（写进 demo limitations）：
 * - CubeCamera / box-filter mip 链不是 GGX 重要性采样预滤波；
 * - split-sum 的 DFG 项在 `gbuffer.frag` 的 `iblSpecular` 内（Karis EnvBRDFApprox）；
 * - 无浮点渲染目标时 IBL cube 回退 RoomEnvironment，但天空仍保留 equirect HDR
 *   （2D 采样不需要浮点 RT）。
 *
 * 挂载在 Canvas 内即可，生命周期跟随画布（StrictMode 双挂载会重建一次）。
 */
export function GBufferEnvironment({ url }: { url?: string | null }) {
  const gl = useThree((state) => state.gl)

  useEffect(() => {
    let cancelled = false
    let rt: THREE.WebGLCubeRenderTarget | null = null
    let room: RoomEnvironment | null = null
    let hdr: THREE.Texture | null = null

    /** 程序化房间兜底：不依赖外部 HDR，也不需要浮点渲染目标 */
    const captureRoom = () => {
      const envScene = new RoomEnvironment()
      room = envScene
      rt = new THREE.WebGLCubeRenderTarget(ENV_SIZE, {
        type: capabilitiesStore.colorBufferFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
        generateMipmaps: true,
        minFilter: THREE.LinearMipmapLinearFilter,
        magFilter: THREE.LinearFilter,
      })
      const cubeCamera = new THREE.CubeCamera(0.1, 1000, rt)
      cubeCamera.update(gl, envScene)
      gbufferShared.uEnvMap.value = rt.texture
    }

    const loadHdr = async (hdrUrl: string) => {
      try {
        const texture = await new RGBELoader().loadAsync(hdrUrl)
        hdr = texture
        // 组件已卸载 / 场景已切换：异步加载完成的结果直接释放，不能写共享 uniform
        if (cancelled) {
          texture.dispose()
          hdr = null
          return
        }

        texture.mapping = THREE.EquirectangularReflectionMapping
        // 天空采样 equirect 时，u=0/1 是同一个 -x 方向；Repeat 消除接缝。
        texture.wrapS = THREE.RepeatWrapping
        texture.wrapT = THREE.ClampToEdgeWrapping
        // fromEquirectangularTexture 会把源纹理的 type / colorSpace / mipmap 设置
        // 复制到 cube RT。RGBELoader 默认 minFilter=LinearFilter、generateMipmaps=false，
        // 必须先改成 mip 链，否则 roughness→LOD 的预滤波会退化到 L0。
        texture.generateMipmaps = true
        texture.minFilter = THREE.LinearMipmapLinearFilter
        texture.magFilter = THREE.LinearFilter

        // 保留 1K equirect 给天空球（比 256² cube 清晰）；
        // hdr 由 cleanup 负责释放，不能像之前那样在 cube 捕获后立刻 dispose。
        gbufferShared.uSkyMap.value = texture
        gbufferShared.uHasSkyMap.value = 1
        hdr = texture

        if (!capabilitiesStore.colorBufferFloat) {
          // IBL 仍回退 RoomEnvironment；但天空不需要浮点 RT，保留 HDR。
          captureRoom()
          return
        }

        rt = new THREE.WebGLCubeRenderTarget(ENV_SIZE, {
          type: THREE.HalfFloatType,
          generateMipmaps: true,
          minFilter: THREE.LinearMipmapLinearFilter,
          magFilter: THREE.LinearFilter,
        })
        rt.fromEquirectangularTexture(gl, texture)
        gbufferShared.uEnvMap.value = rt.texture
      } catch (error) {
        if (cancelled) return
        // 失败时清理半成品，回退程序化房间，保证 demo 仍可交互
        gbufferShared.uSkyMap.value = null
        gbufferShared.uHasSkyMap.value = 0
        hdr?.dispose()
        hdr = null
        rt?.dispose()
        rt = null
        console.warn('[GBufferEnvironment] HDRI 加载失败，回退 RoomEnvironment', error)
        captureRoom()
      }
    }

    if (url) {
      void loadHdr(url)
    } else {
      captureRoom()
    }

    return () => {
      cancelled = true
      gbufferShared.uEnvMap.value = null
      gbufferShared.uHasEnv.value = 0
      gbufferShared.uSkyMap.value = null
      gbufferShared.uHasSkyMap.value = 0
      rt?.dispose()
      room?.dispose()
      hdr?.dispose()
    }
  }, [gl, url])

  return null
}
