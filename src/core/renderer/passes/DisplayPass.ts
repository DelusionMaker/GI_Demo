import * as THREE from 'three'
import { FULLSCREEN_VERTEX_SHADER, FullscreenQuad } from '../FullscreenQuad'
import type { Pass, PassContext } from '../Pass'

const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D tInput;
  uniform float uExposure;
  varying vec2 vUv;

  void main() {
    vec4 texel = texture2D(tInput, vUv);

    // S1 阶段刻意不做色调映射：只施加曝光，然后交给 three 的色彩空间转换。
    // 这样「场景 → HDR 目标 → 本 pass → 屏幕」与「场景 → 屏幕」的结果一致，
    // 便于用 bypass 开关做逐像素 A/B 验证。
    // 色调映射（ACES / AgX / Reinhard）在 S2 插入到本 pass 与场景之间。
    gl_FragColor = vec4(texel.rgb * uExposure, texel.a);

    #include <colorspace_fragment>
  }
`

/**
 * 链尾 pass：把上一环的输出呈现到屏幕（线性 → 输出色彩空间编码）。
 * toScreen === true，Pipeline 不为它分配 RenderTarget。
 */
export class DisplayPass implements Pass {
  readonly name = 'display'
  enabled = true
  scale = 1
  source = 'prev' as const
  toScreen = true

  /** toScreen 为 true，此字段不参与分配，仅为满足接口 */
  target = { format: 'RGBA8' as const, filter: 'linear' as const, samples: 0 }

  lastGpuMs: number | undefined

  private readonly quad: FullscreenQuad

  constructor() {
    this.quad = new FullscreenQuad(
      new THREE.ShaderMaterial({
        vertexShader: FULLSCREEN_VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        uniforms: {
          tInput: { value: null },
          uExposure: { value: 1 },
        },
        depthTest: false,
        depthWrite: false,
      }),
    )
  }

  render(ctx: PassContext, target: THREE.WebGLRenderTarget | null): null {
    const uniforms = this.quad.material.uniforms
    uniforms.tInput.value = ctx.input
    uniforms.uExposure.value = ctx.exposure
    this.quad.render(ctx.renderer, target)
    return null
  }

  dispose(): void {
    this.quad.dispose()
  }
}
