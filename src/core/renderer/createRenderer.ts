import * as THREE from 'three'
import { capabilitiesStore } from '../capabilities'

/**
 * 渲染器工厂 —— 全项目「后端」唯一分叉点。
 *
 * 当前：WebGL2（THREE.WebGLRenderer）。
 *
 * 何时切换：阶段 4 深水区若确定要做 compute 类算法（VXGI / DDGI / 实时 PT），
 * 在此处换成 `three/webgpu` 的 WebGPURenderer（可配合 TSL），
 * 其余 demo 代码不需要改动 —— 避免出现「WebGL2 版 + WebGPU 版两套代码」。
 *
 * 入参做了防御：R3F 的 gl 工厂拿到的是 defaultProps（含 canvas 字段），
 * 但也兼容直接传 canvas 的旧签名。
 */
export type RendererFactoryInput = HTMLCanvasElement | { canvas?: unknown }

export function createRenderer(input: RendererFactoryInput): THREE.WebGLRenderer {
  const canvas = (input instanceof HTMLCanvasElement ? input : input.canvas) as
    | HTMLCanvasElement
    | OffscreenCanvas
    | undefined
  if (!canvas) {
    throw new Error('[createRenderer] 未能取得 canvas')
  }

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  })

  // 颜色输出交给自建后处理链（p0-hdr），此处先不做色调映射
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NoToneMapping

  capabilitiesStore.detect(renderer)

  return renderer
}
