import * as THREE from 'three'
import gbufferVert from '../shaders/gbuffer.vert'
import skyFrag from '../shaders/sky.frag'
import { gbufferShared } from './gbufferShared'

/**
 * 户外天空球材质。
 *
 * 为什么不用 three 的 `scene.background`：
 * BeautyPass 是 3 附件 MRT，内建 background pass 只写 1 个 output，
 * 在 MRT 下会被丢弃（甚至触发 GL_INVALID_OPERATION）。这里用天空球 +
 * 自定义材质显式写 gAlbedo / gNormal / gMRAO，和场景物体共用同一条 MRT。
 *
 * 采样源是 `GBufferEnvironment` 保留的 equirect HDR（不是 cube）：
 * 1K 原图直接当背景，比 256² 的 IBL cube 更清晰；IBL 仍走 cube + mip。
 */
export function createSkyMaterial(): THREE.RawShaderMaterial {
  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: gbufferVert,
    fragmentShader: skyFrag,
    uniforms: {
      uSkyMap: gbufferShared.uSkyMap,
      uHasSkyMap: gbufferShared.uHasSkyMap,
      uEnvIntensity: gbufferShared.uEnvIntensity,
      uFurnace: gbufferShared.uFurnace,
    },
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
  })
  material.name = 'SkyMaterial'
  return material
}
