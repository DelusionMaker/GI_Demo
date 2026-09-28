import * as THREE from 'three'
import type {
  Pass,
  PassContext,
  PassTargetSpec,
  PassTiming,
  PipelineStats,
  TargetFormat,
} from './Pass'

interface PooledTarget {
  key: string
  target: THREE.WebGLRenderTarget
  busy: boolean
}

export interface PipelineOptions {
  /**
   * 是否允许浮点渲染目标（由调用方判定，通常是 capabilities.colorBufferFloat）。
   * 刻意不在 Pipeline 内读 store：渲染核心保持与状态层无关。
   */
  hdr: boolean
}

/**
 * 通用多 pass 管线（p0-hdr 步骤 1 抽象出的容器）。
 *
 * 硬约束：本文件与 passes/ 目录不得 import 任何 React / MobX 模块。
 * React 侧只通过驱动组件在 useFrame 里调 `render()` 与同步参数。
 *
 * 演进说明：`HDRPipeline` 原本是写死的「beauty + 全屏输出」两段；
 * 抽出本类后，步骤 3（bloom 多级 mip）与步骤 4（luminance 链）
 * 以及 p0-gbuffer-hud 的 MRT 都只需新增 pass，不必再改调度逻辑。
 */
export class Pipeline {
  // ---- 供 UI 读写，保持为普通字段，不引状态库 ----
  /** 旁路整条链，走「场景直接渲到屏幕」的老路径，用于 A/B 对比 */
  bypass = false
  /** 中间量可视化：只跑到该 pass 为止，再借链尾 pass 呈现其输出 */
  debugPass: string | null = null
  /** 曝光偏移（EV） */
  exposureEV = 0

  /** 浮点目标是否真正生效（false = 已回落 RGBA8，高光会被截断） */
  readonly hdrActive: boolean
  readonly hdrFormat: TargetFormat

  private readonly passes: Pass[] = []
  private readonly pool: PooledTarget[] = []
  private readonly drawingBuffer = new THREE.Vector2()
  private readonly statsRef: PipelineStats = { passes: [], totalMs: 0 }

  private width = 0
  private height = 0
  private frame = 0
  private inputDepth: THREE.DepthTexture | null = null

  constructor(options: PipelineOptions) {
    this.hdrActive = options.hdr
    this.hdrFormat = options.hdr ? 'RGBA16F' : 'RGBA8'
  }

  get stats(): PipelineStats {
    return this.statsRef
  }

  addPass(pass: Pass, index?: number): void {
    if (index === undefined) this.passes.push(pass)
    else this.passes.splice(index, 0, pass)
  }

  removePass(name: string): void {
    const index = this.passes.findIndex((pass) => pass.name === name)
    if (index < 0) return
    const [removed] = this.passes.splice(index, 1)
    removed?.dispose()
  }

  getPass<T extends Pass = Pass>(name: string): T | undefined {
    return this.passes.find((pass) => pass.name === name) as T | undefined
  }

  getPassNames(): string[] {
    return this.passes.map((pass) => pass.name)
  }

  /** 物理像素尺寸（CSS 尺寸 × DPR）。render() 内还会用 drawingBufferSize 复核一次。 */
  setSize(width: number, height: number): void {
    this.applyPixelSize(width, height)
  }

  /** 渲染器按帧传入（与 HDRPipeline 既有的 render(renderer, scene, camera) 签名保持一致） */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    // 关闭 info 自动清零：three 默认在每次 renderer.render 前 reset，
    // 一帧内有 beauty + 多个全屏 pass 时，外部只能读到最后一个 pass 的
    // 1 call / 2 tri。改为每帧开头手动 reset，累计整帧的 call / tri。
    if (renderer.info.autoReset) renderer.info.autoReset = false
    renderer.info.reset()
    this.frame += 1

    // 复核像素尺寸：R3F 自己也会调整渲染器尺寸，以 drawingBufferSize 为准最稳
    const buffer = renderer.getDrawingBufferSize(this.drawingBuffer)
    this.applyPixelSize(buffer.x, buffer.y)

    if (this.bypass) {
      renderer.setRenderTarget(null)
      renderer.render(scene, camera)
      this.statsRef.passes = []
      this.statsRef.totalMs = 0
      return
    }

    const chain = this.resolveChain()
    this.releaseAll()
    this.inputDepth = null

    const frameStart = performance.now()
    const stats: PassTiming[] = []

    let input: THREE.Texture | null = null
    let heldTarget: THREE.WebGLRenderTarget | null = null

    for (const pass of chain) {
      const width = Math.max(1, Math.round(this.width * pass.scale))
      const height = Math.max(1, Math.round(this.height * pass.scale))
      const target = pass.toScreen ? null : this.acquire(pass, width, height)

      if (target?.depthTexture) this.inputDepth = target.depthTexture

      const ctx: PassContext = {
        renderer,
        scene,
        camera,
        width,
        height,
        frame: this.frame,
        input,
        inputDepth: this.inputDepth,
        exposureEV: this.exposureEV,
      }

      const passStart = performance.now()
      let output: THREE.Texture | null = null

      if (pass.source === 'scene') {
        renderer.setRenderTarget(target)
        renderer.render(scene, camera)
        output = target ? target.texture : null
      } else if (pass.render) {
        output = pass.render(ctx, target)
      }

      stats.push({ name: pass.name, cpuMs: performance.now() - passStart, gpuMs: pass.lastGpuMs ?? null })

      // 上一环输出已被本环消费，立即回收，供同签名的后续 pass 复用
      if (heldTarget && heldTarget !== target) this.release(heldTarget)
      heldTarget = target
      input = output
    }

    if (heldTarget) this.release(heldTarget)

    this.statsRef.passes = stats
    this.statsRef.totalMs = performance.now() - frameStart
  }

  /**
   * 释放 GPU 资源。
   *
   * 注意：本方法**不是终结性的** —— 调用后对象仍可继续 render()，
   * 渲染目标会在下次 render 时惰性重建。
   * 这样设计是为了兼容 React StrictMode 的 mount → cleanup → mount：
   * 若 dispose 置死标记，第二次挂载会拿到一个永久失效的实例（画面全黑）。
   */
  dispose(): void {
    this.releaseAll(true)
    this.passes.forEach((pass) => pass.dispose())
    this.passes.length = 0
  }

  /**
   * 解析本帧实际链路。
   * debugPass 用「截断 + 复用链尾 pass 呈现」实现：
   * 不需要额外的 blit 材质，且走的是与正常出屏完全相同的色彩路径。
   */
  private resolveChain(): Pass[] {
    const chain = this.passes.filter((pass) => pass.enabled)
    const debug = this.debugPass
    if (!debug) return chain

    const index = chain.findIndex((pass) => pass.name === debug)
    if (index < 0) return chain

    const truncated = chain.slice(0, index + 1)
    const screenPass = chain.find((pass) => pass.toScreen === true)
    return screenPass && !truncated.includes(screenPass)
      ? [...truncated, screenPass]
      : truncated
  }

  private applyPixelSize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width))
    const h = Math.max(1, Math.round(height))
    if (w === this.width && h === this.height) return
    this.width = w
    this.height = h
    // 尺寸变了，旧目标全部作废
    this.releaseAll(true)
  }

  private resolveFormat(format: TargetFormat): TargetFormat {
    return format === 'RGBA16F' && !this.hdrActive ? 'RGBA8' : format
  }

  private acquire(pass: Pass, width: number, height: number): THREE.WebGLRenderTarget {
    const format = this.resolveFormat(pass.target.format)
    const samples = pass.target.samples ?? 0
    const depth = pass.target.depthTexture ? 1 : 0
    const key = `${format}|${pass.target.filter}|${samples}|${depth}|${width}x${height}`

    const free = this.pool.find((entry) => entry.key === key && !entry.busy)
    if (free) {
      free.busy = true
      return free.target
    }

    const target = createRenderTarget(format, pass.target, width, height)
    this.pool.push({ key, target, busy: true })
    return target
  }

  private release(target: THREE.WebGLRenderTarget): void {
    const entry = this.pool.find((item) => item.target === target)
    if (entry) entry.busy = false
  }

  private releaseAll(dispose = false): void {
    if (dispose) {
      this.pool.forEach((entry) => {
        entry.target.depthTexture?.dispose()
        entry.target.dispose()
      })
      this.pool.length = 0
      return
    }
    this.pool.forEach((entry) => {
      entry.busy = false
    })
  }
}

function createRenderTarget(
  format: TargetFormat,
  spec: PassTargetSpec,
  width: number,
  height: number,
): THREE.WebGLRenderTarget {
  const hdr = format === 'RGBA16F'
  const filter = spec.filter === 'linear' ? THREE.LinearFilter : THREE.NearestFilter

  const depthTexture = spec.depthTexture ? new THREE.DepthTexture(width, height) : undefined
  if (depthTexture) depthTexture.format = THREE.DepthFormat

  const target = new THREE.WebGLRenderTarget(width, height, {
    type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    minFilter: filter,
    magFilter: filter,
    // RT 内保持线性，只在最终 pass 编 sRGB（显式写出，避免依赖默认值）
    depthTexture,
    depthBuffer: true,
    stencilBuffer: false,
    generateMipmaps: false,
  })
  // 构造后赋值：采样数在首次使用时惰性读取，这样写可避开 options 的类型定义差异
  target.samples = spec.samples ?? 0
  target.texture.colorSpace = THREE.NoColorSpace
  target.texture.name = `gi-postfx-${format}-${width}x${height}`
  return target
}
