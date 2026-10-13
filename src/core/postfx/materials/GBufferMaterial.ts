import * as THREE from 'three'
import gbufferVert from '../shaders/gbuffer.vert'
import gbufferFrag from '../shaders/gbuffer.frag'

export interface GBufferMaterialOptions {
  /** 反照率基色（与 meshStandardMaterial 的 color 等价，默认浅灰） */
  color?: THREE.ColorRepresentation
  roughness?: number
  metalness?: number
}

/**
 * G-buffer MRT 材质（S2 脚手架）。
 *
 * - 用 RawShaderMaterial + GLSL3，3 个 `layout(location=…) out` 对应 BeautyPass 的
 *   gAlbedo / gNormal / gMRAO 三附件；单目标（无 MRT）环境下多余输出被驱动丢弃，仍可渲。
 * - 着色主体（真实 BRDF、法线编码、金属度/粗糙度/AO/emissive 来源）留作 TODO，见
 *   `gbuffer.frag` 内 `TODO(S2 · 你来写)`。
 */
export function createGBufferMaterial(options: GBufferMaterialOptions = {}): THREE.RawShaderMaterial {
  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uBaseColor: { value: new THREE.Color(options.color ?? '#cbd5e4') },
      uRoughness: { value: options.roughness ?? 0.35 },
      uMetalness: { value: options.metalness ?? 0.1 },
    },
    vertexShader: gbufferVert,
    fragmentShader: gbufferFrag,
  })
  material.name = 'GBufferMaterial'
  return material
}
