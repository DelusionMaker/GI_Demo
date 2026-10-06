import * as THREE from 'three'
import { FULLSCREEN_VERTEX_SHADER, FullscreenQuad } from '../FullscreenQuad'
import tonemapFrag from '../shaders/tonemap-output.frag'
import type { Pass, PassContext } from '../Pass'

/**
 * 精确线性 → sRGB 分段编码。
 *
 * 自建 pass 走 RawShaderMaterial（着色器在独立 .frag 文件里，自带 #version 300 es
 * 与 in/out），three 不会自动为它插入编码调用，必须自己编码 ——
 * 这是自建管线画面发灰 / 发暗的最高频原因。不要用 pow(c, 1/2.2) 近似，暗部会偏。
 */
const FRAGMENT_SHADER = tonemapFrag

/**
 * 链尾 pass：EV + 曲线 + 线性→sRGB 编码，直接输出到屏幕。
 * toScreen === true，Pipeline 不为它分配 RenderTarget。
 */
export class TonemapOutputPass implements Pass {
  readonly name = 'tonemap-output'
  enabled = true
  scale = 1
  source = 'prev' as const
  toScreen = true

  /** toScreen 为 true，此字段不参与分配，仅为满足接口 */
  target = { format: 'RGBA8' as const, filter: 'linear' as const, samples: 0 }

  private readonly quad: FullscreenQuad

  constructor() {
    this.quad = new FullscreenQuad(
      new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: FULLSCREEN_VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        uniforms: {
          tColor: { value: null },
          uResolution: { value: new THREE.Vector2(1, 1) },
          uExposureEV: { value: 0 },
          uTonemap: { value: 0 },
          uClipView: { value: 0 },
        },
        depthTest: false,
        depthWrite: false,
      }),
    )
  }

  setTonemapIndex(index: number): void {
    this.quad.material.uniforms.uTonemap.value = index
  }

  setClipView(enabled: boolean): void {
    this.quad.material.uniforms.uClipView.value = enabled ? 1 : 0
  }

  render(ctx: PassContext, target: THREE.WebGLRenderTarget | null): null {
    const uniforms = this.quad.material.uniforms
    uniforms.tColor.value = ctx.input
    uniforms.uResolution.value.set(ctx.width, ctx.height)
    // 曝光每帧跟随 ctx（由 Pipeline 从 UI 旋钮同步），不在这里缓存
    uniforms.uExposureEV.value = ctx.exposureEV
    this.quad.render(ctx.renderer, target)
    return null
  }

  dispose(): void {
    this.quad.dispose()
  }
}
