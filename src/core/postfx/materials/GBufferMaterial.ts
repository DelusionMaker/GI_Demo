import * as THREE from 'three'
import gbufferVert from '../shaders/gbuffer.vert'
import gbufferFrag from '../shaders/gbuffer.frag'

export interface GBufferMaterialOptions {
  /** 反照率基色（与 meshStandardMaterial 的 color 等价，默认浅灰） */
  color?: THREE.ColorRepresentation
  roughness?: number
  metalness?: number
  /**
   * 调试视图：gAlbedo 直接输出编码法线（demo 的「法线」档位）。
   * 注意：MRT 帧缓冲有 3 个活动 draw buffer，**所有**渲进 beauty 的材质都必须
   * 写满 3 个 fragment output——three 内建材质（meshStandardMaterial 等）只写 1 个，
   * 在 MRT 下会触发 GL_INVALID_OPERATION 且该 draw 被丢弃，因此场景物体
   * （含调试视图）都必须用本材质，靠 uniform 切变体，不能换内建材质。
   */
  debugNormals?: boolean
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
      uDebugNormals: { value: options.debugNormals ? 1 : 0 },
    },
    vertexShader: gbufferVert,
    fragmentShader: gbufferFrag,
  })
  material.name = 'GBufferMaterial'
  return material
}
