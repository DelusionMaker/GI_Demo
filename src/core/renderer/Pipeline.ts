import * as THREE from 'three'
import type { Pass, PassContext, PassStat, PassTargetSpec, TargetFormat } from './Pass'

export interface PipelineStats {
  passes: PassStat[]
  totalMs: number
}

interface PooledTarget {
  key: string
  target: THREE.WebGLRenderTarget
  busy: boolean
}

/**
 * 自建多 pass 管线。
 *
 * 硬约束：本文件（以及 passes/ 目录）不得 import 任何 React 模块。
 * React 侧只负责用 useFrame 驱动 `render()` 与同步参数（见 PipelineDriver）。
 * 这样做的收益：可脱离 React 单测；阶段 4 切 WebGPU 时渲染核心不用重写。
 *
 * 顺序无关性：Pipeline 自己从 GL 上下文判定是否支持浮点目标，
 * 不读取 capabilities store —— 避免依赖 store 的初始化时机。
 */
export class Pipeline {
  // ---- 以下字段供 UI 读写，刻意保持为普通字段，不引状态库 ----
  /** 旁路整条链，走「场景直接渲到屏幕」的老路径，用于 A/B 对比 */
  bypass = false
  /** 中间量可视化：只跑到该 pass 为止，再借链尾 pass 呈现其输出 */
  debugPass: string | null = null
  /** 曝光倍率（S3 接入自动曝光后由外部驱动） */
  exposure = 1

  /** 场景 pass 实际可用的目标格式（不支持浮点渲染目标时为 RGBA8） */
  readonly hdrFormat: TargetFormat
  /** 是否真的用上了浮点目标；false 表示高光会在写入时就被截断 */
  readonly hdrActive: boolean

  private readonly renderer: THREE.WebGLRenderer
  private readonly passes: Pass[] = []
  private readonly pool: PooledTarget[] = []
  private readonly drawingBuffer = new THREE.Vector2()
  private readonly statsRef: PipelineStats = { passes: [], totalMs: 0 }

  private width = 0
  private height = 0
  private frame = 0
  private disposed = false

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer
    const gl = renderer.getContext()
    const floatRenderable = Boolean(gl.getExtension('EXT_color_buffer_float'))
    this.hdrActive = floatRenderable
    this.hdrFormat = floatRenderable ? 'RGBA16F' : 'RGBA8'
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

  /** 由 React 侧在尺寸 / DPR 变化时调用；render() 内还会用 drawingBufferSize 复核一次 */
  resize(width: number, height: number, dpr: number): void {
    this.applyPixelSize(width * dpr, height * dpr)
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    if (this.disposed) return

    const renderer = this.renderer

    // 多 pass 场景必须关掉自动重置并改为每帧手动重置一次：
    // three 的 render() 内部会执行 `if (info.autoReset) info.reset()`，
    // 若保持默认，每渲染一个全屏 pass 就把统计清零，性能面板最终只能看到
    // 最后一个 pass 的 1 个 draw call。
    renderer.info.autoReset = false
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

    const frameStart = performance.now()
    const stats: PassStat[] = []

    let input: THREE.Texture | null = null
    let heldTarget: THREE.WebGLRenderTarget | null = null

    for (const pass of chain) {
      const width = Math.max(1, Math.round(this.width * pass.scale))
      const height = Math.max(1, Math.round(this.height * pass.scale))
      const target = pass.toScreen ? null : this.acquire(pass, width, height)

      const ctx: PassContext = {
        renderer,
        scene,
        camera,
        width,
        height,
        frame: this.frame,
        input,
        exposure: this.exposure,
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

      stats.push({ name: pass.name, ms: performance.now() - passStart })

      // 上一环的输出已被本环消费，立刻回收以便同签名的后续 pass 复用
      if (heldTarget && heldTarget !== target) this.release(heldTarget)
      heldTarget = target
      input = output
    }

    if (heldTarget) this.release(heldTarget)

    this.statsRef.passes = stats
    this.statsRef.totalMs = performance.now() - frameStart
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.releaseAll(true)
    this.passes.forEach((pass) => pass.dispose())
    this.passes.length = 0
    // 恢复 three 的默认统计行为
    this.renderer.info.autoReset = true
  }

  /**
   * 解析本帧实际要跑的链路。
   * debugPass 采用「截断 + 复用链尾 pass 呈现」的方式实现，
   * 因此不需要额外的 blit 材质，且走的是与正常出屏完全相同的色彩路径。
   */
  private resolveChain(): Pass[] {
    let chain = this.passes.filter((pass) => pass.enabled)
    const debug = this.debugPass
    if (!debug) return chain

    const index = chain.findIndex((pass) => pass.name === debug)
    if (index < 0) return chain

    const truncated = chain.slice(0, index + 1)
    const screenPass = chain.find((pass) => pass.toScreen === true)
    if (screenPass && !truncated.includes(screenPass)) {
      chain = [...truncated, screenPass]
    } else {
      chain = truncated
    }
    return chain
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
    const key = `${format}|${pass.target.filter}|${samples}|${width}x${height}`

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
      this.pool.forEach((entry) => entry.target.dispose())
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

  const target = new THREE.WebGLRenderTarget(width, height, {
    format: THREE.RGBAFormat,
    type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
    minFilter: filter,
    magFilter: filter,
    depthBuffer: true,
    stencilBuffer: false,
    generateMipmaps: false,
  })
  // 构造后再赋值：three 的采样数在首次使用时惰性读取，这样写可避免依赖 options 的类型定义
  target.samples = spec.samples ?? 0
  target.texture.name = `gi-pipeline-${format}-${width}x${height}`
  return target
}
