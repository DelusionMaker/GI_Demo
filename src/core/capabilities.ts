import { actionBound, computed, makeObservable, observable } from 'mobx'
import type * as THREE from 'three'

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
  maxAnisotropy = 1

  constructor() {
    makeObservable(this, {
      backend: observable,
      webgpuAvailable: observable,
      maxTextureSize: observable,
      colorBufferFloat: observable,
      floatLinear: observable,
      timerQuery: observable,
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
    this.maxAnisotropy = renderer.capabilities.getMaxAnisotropy()
  }
}

export const capabilitiesStore = new CapabilitiesStore()
