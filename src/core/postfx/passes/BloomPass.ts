import * as THREE from 'three'
import { FULLSCREEN_VERTEX_SHADER, FullscreenQuad } from '../FullscreenQuad'
import thresholdFrag from '../shaders/bloom-threshold.frag'
import downsampleFrag from '../shaders/bloom-downsample.frag'
import upsampleFrag from '../shaders/bloom-upsample.frag'
import compositeFrag from '../shaders/bloom-composite.frag'
import type { Pass, PassContext } from '../Pass'

/**
 * Bloom pass（p0-hdr 步骤 4 落地点）。
 *
 * 设计要点：
 * - **HDR 域内做**（在 tonemap 之前）：bloom 必须叠加在线性 HDR 上才物理正确，
 *   否则就是 LDR 近似（TODO 已记取舍）。
 * - **单 pass 自管 mip 链**：与 `LuminancePass` 同样的「内部 RT」思路，但这里是
 *   一整条级联——阈值提取 → 降采样级联 → 上采样累加 → 合成。这些内部 RT 由本 pass
 *   自己分配/复用，不进 `Pipeline` 的 RT 池（Pipeline 只为本 pass 分配最终的全分辨率输出 RT）。
 * - **链上位置**：beauty → luminance(旁路) → **bloom** → tonemap-output。
 *   bloom 读 beauty 的 HDR，输出「scene + bloom」回链，tonemap-output 只管映射，
 *   无需改动（它本就读 `ctx.input`）。
 * - `enabled=false` 时整条链跳过本 pass，回链的是原 beauty，等于无 bloom。
 *
 * 与 React / MobX 完全无关（硬约束）。
 *
 * ⚠️ 算法段留给你实现：四个 .frag 里的 `extractBright` / `downsample` / `upsample`
 * 目前是占位（原样返回），会让 bloom 看起来「整屏都糊」——开启前请先填算法段。
 */

const MIP_LEVELS = 6
/** 起始分辨率：半分辨率（TODO 3.3；移动端可减半到 0.25） */
const BASE_SCALE = 0.5

export class BloomPass implements Pass {
  readonly name = 'bloom'
  enabled = true
  source = 'prev' as const
  scale = 1
  target = { format: 'RGBA16F' as const, filter: 'linear' as const, samples: 0 }
  toScreen = false

  /** bloom 强度（HDR 线性空间叠加系数），由控制面板驱动 */
  intensity = 1
  /** 亮度阈值（HDR 线性空间） */
  threshold = 1.0
  /** soft-knee 半宽 */
  knee = 0.5

  private readonly thresholdQuad: FullscreenQuad
  private readonly downQuad: FullscreenQuad
  private readonly upQuad: FullscreenQuad
  private readonly compositeQuad: FullscreenQuad

  private mips: THREE.WebGLRenderTarget[] = []
  private mipW = 0
  private mipH = 0

  constructor() {
    this.thresholdQuad = new FullscreenQuad(
      new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: FULLSCREEN_VERTEX_SHADER,
        fragmentShader: thresholdFrag,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          tInput: { value: null },
          uThreshold: { value: this.threshold },
          uKnee: { value: this.knee },
        },
      }),
    )
    this.downQuad = new FullscreenQuad(
      new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: FULLSCREEN_VERTEX_SHADER,
        fragmentShader: downsampleFrag,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          tInput: { value: null },
          uTexel: { value: new THREE.Vector2(1, 1) },
        },
      }),
    )
    this.upQuad = new FullscreenQuad(
      new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: FULLSCREEN_VERTEX_SHADER,
        fragmentShader: upsampleFrag,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          tInput: { value: null },
          tAccum: { value: null },
          uTexel: { value: new THREE.Vector2(1, 1) },
        },
      }),
    )
    this.compositeQuad = new FullscreenQuad(
      new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: FULLSCREEN_VERTEX_SHADER,
        fragmentShader: compositeFrag,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          tScene: { value: null },
          tBloom: { value: null },
          uIntensity: { value: this.intensity },
        },
      }),
    )
  }

  render(ctx: PassContext, target: THREE.WebGLRenderTarget | null): THREE.Texture | null {
    // 被绕过（debug 截断 / 未启用）时不应分配输出；Pipeline 保证 enabled 才调用，
    // 这里再兜底一次：没有 target 就原样透传
    if (!target) return ctx.input
    this.ensureMips(ctx.width, ctx.height)

    const r = ctx.renderer

    // 1) 阈值提取：beauty(HDR) → mips[0]
    this.thresholdQuad.material.uniforms.tInput.value = ctx.input
    this.thresholdQuad.material.uniforms.uThreshold.value = this.threshold
    this.thresholdQuad.material.uniforms.uKnee.value = this.knee
    this.thresholdQuad.render(r, this.mips[0])

    // 2) 降采样级联：mips[0] → mips[1] → … → mips[N-1]
    for (let i = 0; i < MIP_LEVELS - 1; i += 1) {
      const src = this.mips[i]
      const dst = this.mips[i + 1]
      this.downQuad.material.uniforms.tInput.value = src.texture
      this.downQuad.material.uniforms.uTexel.value.set(1 / src.width, 1 / src.height)
      this.downQuad.render(r, dst)
    }

    // 3) 上采样级联（累加）：从最粗回叠到 mips[0]
    for (let i = MIP_LEVELS - 1; i > 0; i -= 1) {
      const finer = this.mips[i - 1]
      const coarser = this.mips[i]
      this.upQuad.material.uniforms.tInput.value = coarser.texture
      this.upQuad.material.uniforms.tAccum.value = finer.texture
      this.upQuad.material.uniforms.uTexel.value.set(1 / coarser.width, 1 / coarser.height)
      // 渲回更细的 mip：finer = finer + upsample(coarser)
      this.upQuad.render(r, finer)
    }

    // 4) 合成：scene + bloom * intensity → 全分辨率 HDR 输出 RT
    this.compositeQuad.material.uniforms.tScene.value = ctx.input
    this.compositeQuad.material.uniforms.tBloom.value = this.mips[0].texture
    this.compositeQuad.material.uniforms.uIntensity.value = this.intensity
    this.compositeQuad.render(r, target)

    return target.texture
  }

  private ensureMips(w: number, h: number): void {
    const bw = Math.max(1, Math.round(w * BASE_SCALE))
    const bh = Math.max(1, Math.round(h * BASE_SCALE))
    if (bw === this.mipW && bh === this.mipH && this.mips.length === MIP_LEVELS) return
    this.disposeMips()
    this.mipW = bw
    this.mipH = bh
    let cw = bw
    let ch = bh
    for (let i = 0; i < MIP_LEVELS; i += 1) {
      const rt = new THREE.WebGLRenderTarget(cw, ch, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: false,
      })
      rt.texture.colorSpace = THREE.NoColorSpace
      this.mips.push(rt)
      cw = Math.max(1, cw >> 1)
      ch = Math.max(1, ch >> 1)
    }
  }

  private disposeMips(): void {
    this.mips.forEach((m) => m.dispose())
    this.mips = []
  }

  dispose(): void {
    this.disposeMips()
    this.thresholdQuad.dispose()
    this.downQuad.dispose()
    this.upQuad.dispose()
    this.compositeQuad.dispose()
  }
}
