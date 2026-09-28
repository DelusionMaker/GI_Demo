import * as THREE from 'three'
import { FULLSCREEN_VERTEX_SHADER, FullscreenQuad } from '../FullscreenQuad'
import type { Pass, PassContext } from '../Pass'

/**
 * 精确线性 → sRGB 分段编码。
 *
 * 自建 pass 走 ShaderMaterial，three 不会自动为它插入编码调用，
 * 必须自己编码 —— 这是自建管线画面发灰 / 发暗的最高频原因。
 * 不要用 pow(c, 1/2.2) 近似，暗部会偏。
 */
const FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform sampler2D tColor;
uniform vec2 uResolution;
uniform float uExposureEV;
uniform int uTonemap;

varying vec2 vUv;

vec3 linearToSrgb(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}

void main() {
  vec3 color = texture2D(tColor, vUv).rgb;

  // EV 曝光：multiplier = 2^EV。骨架默认 EV=0，exp2(0)=1，视觉直通。
  color *= exp2(uExposureEV);

  // TODO(p0-hdr 步骤 2)：按 uTonemap 分支 ACES / AgX / Reinhard
  //   1 = ACES(Narkowicz) / 2 = AgX(需配 contrast look) / 3 = Reinhard
  // 当前仅线性直通（0）。
  // TODO(p0-hdr 步骤 3)：bloom 在 tonemap **之前**于 HDR 线性空间合成。

  gl_FragColor = vec4(linearToSrgb(clamp(color, 0.0, 65504.0)), 1.0);
}
`

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
      new THREE.ShaderMaterial({
        vertexShader: FULLSCREEN_VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        uniforms: {
          tColor: { value: null },
          uResolution: { value: new THREE.Vector2(1, 1) },
          uExposureEV: { value: 0 },
          uTonemap: { value: 0 },
        },
        depthTest: false,
        depthWrite: false,
      }),
    )
  }

  setExposureEV(ev: number): void {
    this.quad.material.uniforms.uExposureEV.value = ev
  }

  setTonemapIndex(index: number): void {
    this.quad.material.uniforms.uTonemap.value = index
  }

  render(ctx: PassContext, target: THREE.WebGLRenderTarget | null): null {
    const uniforms = this.quad.material.uniforms
    uniforms.tColor.value = ctx.input
    uniforms.uResolution.value.set(ctx.width, ctx.height)
    this.quad.render(ctx.renderer, target)
    return null
  }

  dispose(): void {
    this.quad.dispose()
  }
}
