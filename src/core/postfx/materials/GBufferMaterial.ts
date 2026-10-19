import * as THREE from 'three'
import gbufferVert from '../shaders/gbuffer.vert'
import gbufferFrag from '../shaders/gbuffer.frag'
import { gbufferShared } from './gbufferShared'

export interface GBufferMaterialOptions {
  /** 反照率基色（与 meshStandardMaterial 的 color 等价，默认浅灰） */
  color?: THREE.ColorRepresentation
  roughness?: number
  metalness?: number
  /**
   * 反照率贴图（glTF baseColorTexture）。
   * 颜色空间由调用方负责：glTFLoader 会把它标成 SRGBColorSpace，
   * 采样时 GPU 自动解码到线性，shader 不再做二次转换。
   */
  map?: THREE.Texture | null
  /** 0 = 不裁切；glTF MASK 材质通常为 0.5 */
  alphaTest?: number
  /** 单/双面；glTF 的 doubleSided 会映射到这里 */
  side?: THREE.Side
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
 * G-buffer MRT 材质。
 *
 * - 用 RawShaderMaterial + GLSL3，3 个 `layout(location=…) out` 对应 BeautyPass 的
 *   gAlbedo / gNormal / gMRAO 三附件；单目标（无 MRT）环境下多余输出被驱动丢弃，仍可渲。
 * - 支持 baseColor 贴图（glTF 资产必需）、alphaTest、单/双面；roughness/metalness/normal
 *   map 暂未接入（LittlestTokyo 只有 baseColor texture，Sponza 阶段再补）。
 */
export function createGBufferMaterial(options: GBufferMaterialOptions = {}): THREE.RawShaderMaterial {
  const map = options.map ?? null
  const mapTransform = new THREE.Vector4(
    map?.repeat.x ?? 1,
    map?.repeat.y ?? 1,
    map?.offset.x ?? 0,
    map?.offset.y ?? 0,
  )

  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uBaseColor: { value: new THREE.Color(options.color ?? '#cbd5e4') },
      uRoughness: { value: options.roughness ?? 0.35 },
      uMetalness: { value: options.metalness ?? 0.1 },
      uBaseColorMap: { value: map },
      uHasBaseColorMap: { value: map ? 1 : 0 },
      /** xy = repeat，zw = offset；glTF 的 KHR_texture_transform 也走这里 */
      uMapTransform: { value: mapTransform },
      uAlphaTest: { value: options.alphaTest ?? 0 },
      uDebugNormals: { value: options.debugNormals ? 1 : 0 },
      // 灯光 / 环境 / 白炉：挂同一批共享引用（见 gbufferShared.ts），
      // 外部只更新一份状态，所有材质同时生效
      ...gbufferShared,
    },
    vertexShader: gbufferVert,
    fragmentShader: gbufferFrag,
  })
  material.name = map ? 'GBufferMaterial (mapped)' : 'GBufferMaterial'
  material.side = options.side ?? THREE.FrontSide
  return material
}
