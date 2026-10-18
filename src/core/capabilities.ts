import { actionBound, computed, makeObservable, observable } from 'mobx'
import * as THREE from 'three'

export type Backend = 'webgl2' | 'webgpu'

/** 降级链档位：WebGPU → WebGL2 → 烘焙静态结果 → 预渲染视频 */
export type QualityTier = 'webgpu' | 'webgl2' | 'baked' | 'video'

/**
 * 运行时渲染能力 store。
 * 用途：
 * 1. HUD 里显式标注当前档位（文档要求「降级路径必须显式标注」）
 * 2. 后续 demo 按能力决定质量档（半分辨率 ray march、MRT 张数、浮点线性过滤）
 *
 * 消费方式：组件用 `observer()` 包裹后直接读字段即可自动订阅。
 */
export class CapabilitiesStore {
  backend: Backend = 'webgl2'
  /** navigator.gpu 是否存在（不代表后端已启用） */
  webgpuAvailable = false
  maxTextureSize = 0
  /** 能否渲染到浮点目标 —— 累积 / HDR 管线的前提 */
  colorBufferFloat = false
  /** 浮点纹理是否支持线性过滤 —— 否则需手写双线性或退回半精度 */
  floatLinear = false
  /** GPU 计时扩展是否可用 —— 没有它只能看帧时间，无法归因到 pass */
  timerQuery = false
  /** 多渲染目标（MRT）是否可用 —— G-buffer 的前提；软件渲染器（SwiftShader）常不支持 */
  mrt = false
  maxAnisotropy = 1

  constructor() {
    makeObservable(this, {
      backend: observable,
      webgpuAvailable: observable,
      maxTextureSize: observable,
      colorBufferFloat: observable,
      floatLinear: observable,
      timerQuery: observable,
      mrt: observable,
      maxAnisotropy: observable,
      isWebGPU: computed,
      label: computed,
      tier: computed,
      detect: actionBound,
    })
  }

  get isWebGPU(): boolean {
    return this.backend === 'webgpu'
  }

  get label(): string {
    return this.isWebGPU ? 'WebGPU' : 'WebGL2'
  }

  get tier(): QualityTier {
    return this.backend
  }

  /** 由渲染器工厂在创建渲染器后调用，一次性填充所有能力位 */
  detect(renderer: THREE.WebGLRenderer): void {
    const gl = renderer.getContext()
    this.backend = 'webgl2'
    this.webgpuAvailable = 'gpu' in navigator
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
    this.colorBufferFloat = Boolean(gl.getExtension('EXT_color_buffer_float'))
    this.floatLinear = Boolean(gl.getExtension('OES_texture_float_linear'))
    this.timerQuery = Boolean(gl.getExtension('EXT_disjoint_timer_query_webgl2'))

    // MRT：软件渲染器（SwiftShader）常声称 MRT 帧缓冲「完整」却静默渲染成黑屏，
    // 因此不能只查 checkFramebufferStatus，必须真渲染一帧再回读像素验证可写性。
    let mrtSupported = false
    try {
      const test = new THREE.WebGLRenderTarget(4, 4, {
        count: 2,
        type: THREE.UnsignedByteType,
        format: THREE.RGBAFormat,
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: false,
      })
      // 第 2 附件用半精度，复刻真实 G-buffer（gNormal 为 RGBA16F），一并验证可渲染性
      const second = test.textures[1]
      if (second && test.textures[0]) {
        test.textures[1].type = THREE.HalfFloatType

        // 全屏四边形：用 GLSL3 RawShaderMaterial 写满 2 个 fragment output。
        // 关键：three 绑定 MRT 时会把**全部附件**设为 draw buffer（WebGLState.drawBuffers）；
        // 若材质只写 1 个 out（three 内建材质即如此），Chrome/ANGLE 会报
        // 「Active draw buffers with missing fragment shader outputs」→ GL_INVALID_OPERATION，
        // 且整次 draw 被丢弃 → 回读永远全黑 → MRT 能力被误判为不可用（探测自我否决）。
        const probeScene = new THREE.Scene()
        const probeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
        const probeMat = new THREE.RawShaderMaterial({
          glslVersion: THREE.GLSL3,
          vertexShader: `
precision highp float;
in vec3 position;
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`,
          fragmentShader: `
precision highp float;
layout(location = 0) out vec4 outColor0;
layout(location = 1) out vec4 outColor1;
void main() {
  outColor0 = vec4(1.0, 0.0, 0.0, 1.0);
  outColor1 = vec4(0.0, 0.0, 1.0, 1.0);
}
`,
        })
        const probeMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), probeMat)
        probeScene.add(probeMesh)

        renderer.setRenderTarget(test)
        renderer.setClearColor(0x000000, 0)
        renderer.clear(true, false, false)
        renderer.render(probeScene, probeCam)

        const gl2 = gl as WebGL2RenderingContext
        const buf = new Uint8Array(4)
        gl2.readBuffer(gl2.COLOR_ATTACHMENT0)
        gl2.readPixels(0, 0, 1, 1, gl2.RGBA, gl2.UNSIGNED_BYTE, buf)
        renderer.setRenderTarget(null)

        // 非全黑即代表 MRT 真的能把颜色写进第 0 附件（规避 SwiftShader 静默黑屏）
        mrtSupported = buf[0] + buf[1] + buf[2] > 24

        probeMesh.geometry.dispose()
        probeMat.dispose()
        test.dispose()
      }
    } catch {
      mrtSupported = false
    }
    this.mrt = mrtSupported
    // 本机验证入口（S1 遗留 #3）：dev 下明确告知 MRT 是否真正启用，
    // 避免「画面正常但其实一直走单目标降级」的静默状态
    if (import.meta.env.DEV) {
      console.info(
        `[capabilities] MRT ${mrtSupported ? '可用（G-buffer 走 MRT）' : '不可用（G-buffer 降级为单目标）'}`,
      )
    }

    this.maxAnisotropy = renderer.capabilities.getMaxAnisotropy()
  }
}

export const capabilitiesStore = new CapabilitiesStore()
