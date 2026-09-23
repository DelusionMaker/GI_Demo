import * as THREE from 'three'
import { capabilitiesStore } from '../capabilities'

/**
 * HDR 后处理管线（p0-hdr 落地点）。
 *
 * 设计原则（见 TODO.md「职责边界」）：
 * - 与 React 完全无关的纯 TS class，React 侧只负责在 useFrame 里调 render()。
 * - 消费「场景」而不是「相机后缓冲」：场景先渲到自建 HDR RT，
 *   后续全部 pass 在全屏 quad 上完成，three 只管场景图与资源。
 *
 * p0-hdr 分步：
 *   1. 本骨架：RGBA16F 目标 + 直通输出（手写线性→sRGB），画面与接入前一致
 *   2. EV 滑杆 + ACES / AgX / Reinhard 曲线切换
 *   3. 物理 bloom：半分辨率 mip 链（先加 bloom 后 tonemap）
 *   4. 自动曝光：mip 测光 + 跨帧异步回读 + 帧率无关适应
 *
 * 注意：依赖 createRenderer 中 toneMapping = NoToneMapping，
 * 否则材质侧与本管线会各做一次映射，画面发灰。
 */

/** 步骤 2 放开 'aces' | 'agx' | 'reinhard' */
export type TonemapMode = 'linear'

const TONEMAP_INDEX: Record<TonemapMode, number> = {
  linear: 0,
  // aces: 1, agx: 2, reinhard: 3（步骤 2）
}

/** 管线按固定顺序登记 pass，供性能面板展示；GPU 计时在 p0-gbuffer-hud 填充 */
export interface PassTiming {
  name: string
  /** CPU 侧耗时占坑（performance.now），仅反映提交成本 */
  cpuMs: number
  /** 单 pass GPU 耗时；p0-gbuffer-hud 接 EXT_disjoint_timer_query_webgl2 */
  gpuMs: number | null
}

export interface HDRPipelineOptions {
  /**
   * HDR RT 的 MSAA 采样数，0 关闭。
   * 注意：three 只自动 resolve 颜色，DepthTexture 在 MSAA 下不保证可采样；
   * 当前阶段不读深度所以安全，到 p0-gbuffer-hud 需要读深度时要复核
   * （或届时改走 TAA，移动端直接 0）。
   */
  samples?: number
}

const FULLSCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const FULLSCREEN_FRAGMENT = /* glsl */ `
precision highp float;

uniform sampler2D tColor;
uniform vec2 uResolution;
uniform float uExposureEV;
uniform int uTonemap;

varying vec2 vUv;

/**
 * 精确线性→sRGB 分段编码。
 * ShaderMaterial 走自建 pass，three 不会注入 colorspace_fragment，
 * 必须自己编码 —— 这是自建管线画面发灰/发暗的最高频原因。
 * 不要用 pow(c, 1/2.2) 近似，暗部会偏。
 */
vec3 linearToSrgb(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}

void main() {
  vec3 color = texture2D(tColor, vUv).rgb;

  // EV 曝光：multiplier = 2^EV。骨架默认 EV=0，exp2(0)=1，视觉直通。
  color *= exp2(uExposureEV);

  // TODO(p0-hdr 步骤2)：按 uTonemap 分支 ACES / AgX / Reinhard
  //   1 = ACES(Narkowicz) / 2 = AgX(需配 contrast look) / 3 = Reinhard
  // 当前仅线性直通（0），保证骨架接入后与原画面逐像素一致。

  gl_FragColor = vec4(linearToSrgb(clamp(color, 0.0, 65504.0)), 1.0);
}
`

export class HDRPipeline {
  /** false = 无 EXT_color_buffer_float，已降级到 RGBA8（高光会截断），HUD 需显式标注 */
  readonly hdrSupported: boolean
  readonly passTimes: PassTiming[] = [
    { name: 'beauty', cpuMs: 0, gpuMs: null },
    { name: 'tonemap-output', cpuMs: 0, gpuMs: null },
    // 步骤 3/4 在中间插入 luminance / bloom-down-N / bloom-up-N
  ]

  private readonly rt: THREE.WebGLRenderTarget
  private readonly fsScene: THREE.Scene
  private readonly fsCamera: THREE.OrthographicCamera
  private readonly fsMaterial: THREE.ShaderMaterial
  private width: number
  private height: number
  private static warnedFallback = false

  constructor(width: number, height: number, options: HDRPipelineOptions = {}) {
    this.width = Math.max(1, Math.floor(width))
    this.height = Math.max(1, Math.floor(height))

    // 16F 可渲染依赖 EXT_color_buffer_float；16F 线性过滤不依赖
    // OES_texture_float_linear（那是 32F 才需要），正好绕开该限制。
    this.hdrSupported = capabilitiesStore.colorBufferFloat

    const depthTexture = new THREE.DepthTexture(this.width, this.height)
    depthTexture.format = THREE.DepthFormat

    this.rt = new THREE.WebGLRenderTarget(this.width, this.height, {
      // 降级档：RGBA8 线性缓冲，HDR 价值丢失但管线不断
      type: this.hdrSupported ? THREE.HalfFloatType : THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      colorSpace: THREE.NoColorSpace, // RT 内保持线性，只在最终 pass 编 sRGB
      depthTexture,
      samples: this.hdrSupported ? options.samples ?? 4 : 0,
    })

    this.fsScene = new THREE.Scene()
    this.fsCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    this.fsMaterial = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: FULLSCREEN_FRAGMENT,
      uniforms: {
        tColor: { value: this.rt.texture },
        uResolution: { value: new THREE.Vector2(this.width, this.height) },
        uExposureEV: { value: 0 },
        uTonemap: { value: TONEMAP_INDEX.linear },
      },
      depthTest: false,
      depthWrite: false,
    })
    // 自建输出不参与 three 的 tone mapping 注入（且全局已是 NoToneMapping）
    this.fsMaterial.toneMapped = false

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.fsMaterial)
    quad.frustumCulled = false
    this.fsScene.add(quad)

    if (!this.hdrSupported && !HDRPipeline.warnedFallback) {
      HDRPipeline.warnedFallback = true
      console.warn(
        '[HDRPipeline] 不支持 EXT_color_buffer_float，降级到 RGBA8：>1 的高光会被截断，HUD 应标注当前档位',
      )
    }
  }

  /** EV 曝光偏移（手动/自动模式共用；自动模式下这是测光结果上的偏移） */
  setExposureEV(ev: number): void {
    this.fsMaterial.uniforms.uExposureEV.value = ev
  }

  setTonemap(mode: TonemapMode): void {
    this.fsMaterial.uniforms.uTonemap.value = TONEMAP_INDEX[mode]
  }

  /**
   * 物理像素尺寸（CSS 尺寸 × DPR）。
   * RT.setSize 会同步调整已挂载的 DepthTexture，无需手动处理。
   */
  setSize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width))
    const h = Math.max(1, Math.floor(height))
    if (w === this.width && h === this.height) return
    this.width = w
    this.height = h
    this.rt.setSize(w, h)
    this.fsMaterial.uniforms.uResolution.value.set(w, h)
  }

  /**
   * 一帧：场景 → HDR RT（beauty）→ 全屏 tonemap/output → canvas。
   * 调用方需用 R3F 的 renderPriority 接管自动渲染（useFrame(_, priority > 0)），
   * 否则 R3F 仍会自动渲染一次默认后缓冲。
   */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    // 关闭 info 自动清零：默认会在每次 renderer.render 前 reset，
    // 一帧内有 beauty + 全屏 pass 两次 render，清零后外部只能读到全屏 quad
    //（1 call / 2 tri）。改为每帧开头手动 reset，累计整帧的 call / tri。
    if (renderer.info.autoReset) renderer.info.autoReset = false
    renderer.info.reset()

    let t = performance.now()
    renderer.setRenderTarget(this.rt)
    renderer.render(scene, camera)
    this.passTimes[0].cpuMs = performance.now() - t

    t = performance.now()
    // 输出到 null（canvas）；最终 pass 内部已做线性→sRGB 编码
    renderer.setRenderTarget(null)
    renderer.render(this.fsScene, this.fsCamera)
    this.passTimes[1].cpuMs = performance.now() - t
  }

  dispose(): void {
    this.rt.dispose()
    this.rt.depthTexture?.dispose()
    this.fsMaterial.dispose()
    const quad = this.fsScene.children[0] as THREE.Mesh | undefined
    quad?.geometry.dispose()
  }
}
