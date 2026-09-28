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

// ==========================================================================
// TODO(S2 · 你来写)：三条色调映射曲线
//
//   mode 1 = ACES(Narkowicz) / 2 = AgX / 3 = Reinhard / 0 = 直通
//
// 现在三个分支都直接返回入参（等于直通），所以切换下拉暂时看不出区别 ——
// 这是预期的，因为曲线本体还没写。
//
// 三个分支必须与 CPU 侧 src/core/postfx/toneCurves.ts 的结果一致
// （曲线图画的是那一份）。同步策略见该文件顶部说明。
//
// 每个分支的注意事项与 toneCurves.ts 中的注释相同：
// 负数要 clamp 到 0、f(0)=0、单调不减、x→∞ 有界。
// ==========================================================================
vec3 tonemap(vec3 color, int mode) {
  if (mode == 1) {
    // TODO(S2)：ACES —— 形如 x(ax+b) / (x(cx+d)+e) 的有理函数
    return color;
  }
  if (mode == 2) {
    // TODO(S2)：AgX —— 完整实现需配原色变换矩阵，见 toneCurves.ts 的说明
    return color;
  }
  if (mode == 3) {
    // TODO(S2)：Reinhard —— 从最简形式起步
    return color;
  }
  return color;
}

void main() {
  vec3 color = texture2D(tColor, vUv).rgb;

  // EV 曝光：multiplier = 2^EV，由控制面板的滑杆每帧推进来
  color *= exp2(uExposureEV);

  // ======================================================================
  // TODO(S2 · 你来定)：过曝回收怎么呈现
  //
  // 这里是最合适的切入点（映射前，还拿得到 > 1 的原始值）。
  // 两种低成本做法，选一个并把理由记进 DEVLOG：
  //
  //   a) 加一个 uClipView 开关：映射前把任一通道 > 1 的像素标红，
  //      再走完映射 —— 直观，改动最小（一个 uniform + 一个分支）。
  //   b) 复用调试视图机制：新增一个 clip-view pass 插在本 pass 之前。
  //      更符合现有架构，但要新建文件。
  //
  // 无论选哪种，记得在 demo 页的 limitations 里写清"标红是诊断视图，
  // 不代表最终画面"，避免被误解成渲染瑕疵。
  // ======================================================================
  vec3 mapped = tonemap(color, uTonemap);

  gl_FragColor = vec4(linearToSrgb(clamp(mapped, 0.0, 65504.0)), 1.0);
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

  setTonemapIndex(index: number): void {
    this.quad.material.uniforms.uTonemap.value = index
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
