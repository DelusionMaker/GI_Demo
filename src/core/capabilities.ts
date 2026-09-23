import type * as THREE from 'three'
import { createStore, useStore } from './store'

export type Backend = 'webgl2' | 'webgpu'

/**
 * 运行时可用的渲染能力。用途：
 * 1. HUD 里显式标注当前档位（文档要求「降级路径必须显式标注」）
 * 2. 后续 demo 按能力决定质量档（半分辨率 ray march、MRT 张数、浮点线性过滤）
 */
export interface Capabilities {
  backend: Backend
  /** navigator.gpu 是否存在（不代表后端已启用） */
  webgpuAvailable: boolean
  maxTextureSize: number
  /** 能否渲染到浮点目标 —— 累积 / HDR 管线的前提 */
  colorBufferFloat: boolean
  /** 浮点纹理是否支持线性过滤 —— 否则需手写双线性或退回半精度 */
  floatLinear: boolean
  /** GPU 计时扩展是否可用 —— 没有它只能看帧时间，无法归因到 pass */
  timerQuery: boolean
  maxAnisotropy: number
}

export const capabilitiesStore = createStore<Capabilities>({
  backend: 'webgl2',
  webgpuAvailable: false,
  maxTextureSize: 0,
  colorBufferFloat: false,
  floatLinear: false,
  timerQuery: false,
  maxAnisotropy: 1,
})

export const useCapabilities = () => useStore(capabilitiesStore)

export function readCapabilities(renderer: THREE.WebGLRenderer): Partial<Capabilities> {
  const gl = renderer.getContext()
  return {
    backend: 'webgl2',
    webgpuAvailable: 'gpu' in navigator,
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    colorBufferFloat: Boolean(gl.getExtension('EXT_color_buffer_float')),
    floatLinear: Boolean(gl.getExtension('OES_texture_float_linear')),
    timerQuery: Boolean(gl.getExtension('EXT_disjoint_timer_query_webgl2')),
    maxAnisotropy: renderer.capabilities.getMaxAnisotropy(),
  }
}

/** 降级链档位：WebGPU → WebGL2 → 烘焙静态结果 → 预渲染视频 */
export type QualityTier = 'webgpu' | 'webgl2' | 'baked' | 'video'

export function tierOf(backend: Backend): QualityTier {
  return backend
}
