import * as THREE from 'three'
import { FULLSCREEN_VERTEX_SHADER, FullscreenQuad } from '../FullscreenQuad'
import shadowDebugFrag from '../shaders/shadow-debug.frag'
import type { Pass, PassContext } from '../Pass'
import type { ShadowMapPass } from './ShadowMapPass'

/**
 * 阴影深度图集调试视图（p1-shadow）。
 *
 * 直接把 `ShadowMapPass` 的 DepthTexture 呈现在屏幕上：
 * - z = 1（远平面 / 无遮挡）显示为黑，越近的投射物越亮；
 * - 图集分块画橙色边框，未使用的 tile 压暗；
 * - 不做 tonemap / sRGB 编码（数据通道）。
 *
 * 与 `TonemapOutputPass` / `GBufferDebugPass` 互斥，由
 * `HDRPipeline.setShadowAtlasDebug()` 保证同一帧只有一个 toScreen pass。
 */
export class ShadowDebugPass implements Pass {
  readonly name = 'shadow-debug'
  enabled = false
  scale = 1
  source = 'prev' as const
  toScreen = true

  /** toScreen 为 true，此字段不参与分配，仅为满足接口 */
  target = { format: 'RGBA8' as const, filter: 'linear' as const, samples: 0 }

  private readonly quad: FullscreenQuad

  constructor(private readonly shadow: ShadowMapPass) {
    this.quad = new FullscreenQuad(
      new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: FULLSCREEN_VERTEX_SHADER,
        fragmentShader: shadowDebugFrag,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          uShadowAtlas: { value: null },
          uAtlasGrid: { value: new THREE.Vector2(1, 1) },
          uCascadeCount: { value: 0 },
        },
      }),
    )
  }

  render(ctx: PassContext, target: THREE.WebGLRenderTarget | null): null {
    const uniforms = this.quad.material.uniforms
    // 尚未渲染过阴影图集时为 null：three 绑空纹理，输出黑屏但不会报 GL 错误
    uniforms.uShadowAtlas.value = this.shadow.atlasTexture
    const layout = this.shadow.layoutInfo
    uniforms.uAtlasGrid.value.set(layout.cols, layout.rows)
    uniforms.uCascadeCount.value = this.shadow.resolvedCascadeCount
    this.quad.render(ctx.renderer, target)
    return null
  }

  dispose(): void {
    this.quad.dispose()
  }
}
