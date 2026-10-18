import * as THREE from 'three'
import { FULLSCREEN_VERTEX_SHADER, FullscreenQuad } from '../FullscreenQuad'
import gbufferDebugFrag from '../shaders/gbuffer-debug.frag'
import type { Pass, PassContext } from '../Pass'

/**
 * G-buffer 调试视图 pass（p0-gbuffer-hud S3「中间量可视化」）。
 *
 * 把链首产出的 MRT 附件（gAlbedo / gNormal / gMRAO）直接呈现在屏幕上：
 * - 数据来自 `ctx.gBuffer`（Pipeline 在 beauty 渲完后暂存的本帧 MRT）；
 * - 输出**原始数据**：不乘曝光、不做 tonemap、不做 sRGB 编码
 *   （normal / mrao 是数据通道，按字节显示才是标准调试观感）。
 *
 * 与 `TonemapOutputPass` 互斥：由 `HDRPipeline.setGBufferDebug()` 保证同一帧只有一个
 * `toScreen` pass 生效，避免两者抢着写后缓冲。
 *
 * 注意：MRT 不可用（如无 EXT_color_buffer_float 的降级环境）时 `ctx.gBuffer` 为 null，
 * 本 pass 输出黑屏——面板端据此不提供这三个选项。
 */
export class GBufferDebugPass implements Pass {
  readonly name = 'gbuffer-debug'
  /** 由 HDRPipeline.setGBufferDebug() 控制；与 tonemap-output 互斥 */
  enabled = false
  scale = 1
  source = 'prev' as const
  toScreen = true

  /** toScreen 为 true，此字段不参与分配，仅为满足接口 */
  target = { format: 'RGBA8' as const, filter: 'linear' as const, samples: 0 }

  /** 0 = gAlbedo / 1 = gNormal / 2 = gMRAO */
  attachment = 1

  private readonly quad: FullscreenQuad

  constructor() {
    this.quad = new FullscreenQuad(
      new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: FULLSCREEN_VERTEX_SHADER,
        fragmentShader: gbufferDebugFrag,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          tAlbedo: { value: null },
          tNormal: { value: null },
          tMRAO: { value: null },
          uAttachment: { value: 1 },
        },
      }),
    )
  }

  render(ctx: PassContext, target: THREE.WebGLRenderTarget | null): null {
    const gb = ctx.gBuffer
    const uniforms = this.quad.material.uniforms
    // 附件缺失时传 null：three 会绑定内置空纹理，输出黑色，不会产生 GL 错误
    uniforms.tAlbedo.value = gb?.textures[0] ?? null
    uniforms.tNormal.value = gb?.textures[1] ?? null
    uniforms.tMRAO.value = gb?.textures[2] ?? null
    uniforms.uAttachment.value = this.attachment
    this.quad.render(ctx.renderer, target)
    return null
  }

  dispose(): void {
    this.quad.dispose()
  }
}
