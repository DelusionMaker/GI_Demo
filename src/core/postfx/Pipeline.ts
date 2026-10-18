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
  /**
   * 是否启用 GPU 逐 pass 计时（EXT_disjoint_timer_query_webgl2）。
   * 由调用方依据 capabilities.timerQuery 判定；为 false 时不申请扩展、不填 lastGpuMs，
   * 面板端对应展示「GPU 计时不可用」。
   */
  gpuTiming?: boolean
  /**
   * 是否启用 G-buffer MRT（多渲染目标）。由调用方依据 capabilities.mrt 判定；
   * 为 false 时即便 pass 声明了 mrt 也退化为单目标（优雅降级）。
   */
  mrt?: boolean
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
  /** G-buffer MRT（p0-gbuffer-hud）：beauty 用 MRT 渲染时暂存，供调试视图与后续 SSR / SSGI 读取 */
  private gBuffer: THREE.WebGLRenderTarget | null = null

  /** 是否启用 GPU 逐 pass 计时（来自调用方 capabilities.timerQuery） */
  private readonly gpuTiming: boolean
  /** 是否启用 G-buffer MRT（来自调用方 capabilities.mrt） */
  private readonly mrtSupported: boolean
  /** EXT_disjoint_timer_query_webgl2（懒加载并缓存，可能为 null；类型用 any：各 TS lib 对该扩展的全局声明名不一致） */
  private timerExt: any = null
  /** 持有扩展时的 GL 上下文（用于 deleteQuery 清理） */
  private timerGl: WebGL2RenderingContext | null = null
  /** 每个 pass 一个计时 query（按 name 索引）；pending=true 表示该 query 已 end、结果待下帧读取 */
  private readonly passTimers = new Map<string, { query: WebGLQuery | null; pending: boolean }>()

  constructor(options: PipelineOptions) {
    this.hdrActive = options.hdr
    this.hdrFormat = options.hdr ? 'RGBA16F' : 'RGBA8'
    this.gpuTiming = options.gpuTiming ?? false
    this.mrtSupported = options.mrt ?? false
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
    const t = this.passTimers.get(name)
    if (t?.query && this.timerGl) this.timerGl.deleteQuery(t.query)
    this.passTimers.delete(name)
    removed?.dispose()
  }

  /** 取（或建）某 pass 的计时状态；计时与 Pass 接口解耦，不污染各 pass 实现 */
  private ensureTimer(name: string): { query: WebGLQuery | null; pending: boolean } {
    let t = this.passTimers.get(name)
    if (!t) {
      t = { query: null, pending: false }
      this.passTimers.set(name, t)
    }
    return t
  }

  getPass<T extends Pass = Pass>(name: string): T | undefined {
    return this.passes.find((pass) => pass.name === name) as T | undefined
  }

  getPassNames(): string[] {
    return this.passes.map((pass) => pass.name)
  }

  /** 取 G-buffer MRT（若当前链未启用 MRT 则为 null） */
  getGBuffer(): THREE.WebGLRenderTarget | null {
    return this.gBuffer
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
    // 同上：G-buffer 引用每帧由链首重新填充，避免复用池中的旧目标残留
    this.gBuffer = null

    // GPU 计时扩展：每帧首次需要时申请一次并缓存；disjoint 每帧只读一次
    // （读取 GPU_DISJOINT_EXT 会清除该标志，故必须每帧只取一次）
    const gl = renderer.getContext() as WebGL2RenderingContext
    let ext: any = null
    let disjoint = false
    if (this.gpuTiming) {
      if (!this.timerExt) {
        this.timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2')
        this.timerGl = this.timerExt ? gl : null
      }
      ext = this.timerExt
      if (ext) disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean
    }

    const frameStart = performance.now()
    const stats: PassTiming[] = []

    let input: THREE.Texture | null = null
    let heldTarget: THREE.WebGLRenderTarget | null = null

    for (const pass of chain) {
      const width = Math.max(1, Math.round(this.width * pass.scale))
      const height = Math.max(1, Math.round(this.height * pass.scale))
      const target = pass.toScreen ? null : this.acquire(pass, width, height)

      if (target?.depthTexture) this.inputDepth = target.depthTexture
      // 暂存 G-buffer MRT，供调试视图（S3）与后续 SSR / SSGI 读取（仅在真正启用 MRT 时）
      if (target && this.mrtSupported && pass.target.mrt && pass.target.mrt.length > 1) {
        this.gBuffer = target
      }

      const ctx: PassContext = {
        renderer,
        scene,
        camera,
        width,
        height,
        frame: this.frame,
        input,
        inputDepth: this.inputDepth,
        gBuffer: this.gBuffer,
        exposureEV: this.exposureEV,
      }

      // 上一帧遗留的计时 query：结果就绪且未 disjoint 则写入 lastGpuMs；
      // 否则丢弃本帧发起（pending 保留，待下帧再读），避免覆盖未读结果。
      let activeQuery: WebGLQuery | null = null
      if (ext) {
        const t = this.ensureTimer(pass.name)
        if (t.pending && t.query) {
          if (disjoint) {
            t.pending = false
          } else {
            const available = gl.getQueryParameter(t.query, gl.QUERY_RESULT_AVAILABLE) as boolean
            if (available) {
              const ns = gl.getQueryParameter(t.query, gl.QUERY_RESULT) as number
              pass.lastGpuMs = ns / 1e6
              t.pending = false
            }
          }
        }
        if (!t.pending) {
          if (!t.query) t.query = gl.createQuery()
          if (t.query) {
            gl.beginQuery(ext.TIME_ELAPSED_EXT, t.query)
            activeQuery = t.query
          }
        }
      }

      const passStart = performance.now()
      let output: THREE.Texture | null = null

      if (pass.source === 'scene') {
        renderer.setRenderTarget(target)
        renderer.render(scene, camera)
        output = target ? target.textures[0] : null
      } else if (pass.render) {
        output = pass.render(ctx, target)
      }

      if (ext && activeQuery) {
        gl.endQuery(ext.TIME_ELAPSED_EXT)
        const t = this.passTimers.get(pass.name)
        if (t) t.pending = true
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
    if (this.timerGl) {
      this.passTimers.forEach((t) => {
        if (t.query) this.timerGl!.deleteQuery(t.query)
      })
    }
    this.passTimers.clear()
    this.timerExt = null
    this.timerGl = null
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
    const mrtTag = pass.target.mrt && pass.target.mrt.length > 1 ? `mrt${pass.target.mrt.length}` : 's'
    const key = `${format}|${pass.target.filter}|${samples}|${depth}|${mrtTag}|${width}x${height}`

    const free = this.pool.find((entry) => entry.key === key && !entry.busy)
    if (free) {
      free.busy = true
      return free.target
    }

    const target = createRenderTarget(format, pass.target, width, height, this.mrtSupported)
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
      this.gBuffer = null
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
  mrtSupported: boolean,
): THREE.WebGLRenderTarget {
  const hdr = format === 'RGBA16F'
  const filter = spec.filter === 'linear' ? THREE.LinearFilter : THREE.NearestFilter

  const depthTexture = spec.depthTexture ? new THREE.DepthTexture(width, height) : undefined
  if (depthTexture) depthTexture.format = THREE.DepthFormat

  const useMRT = Boolean(mrtSupported && spec.mrt && spec.mrt.length > 1)

  const options: THREE.RenderTargetOptions = {
    type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    minFilter: filter,
    magFilter: filter,
    // RT 内保持线性，只在最终 pass 编 sRGB（显式写出，避免依赖默认值）
    depthTexture,
    depthBuffer: true,
    stencilBuffer: false,
    generateMipmaps: false,
  }
  // MRT：多渲染目标（G-buffer）。count 不一定在 RenderTargetOptions 类型里，故按需补上
  if (useMRT) (options as Record<string, unknown>).count = spec.mrt!.length

  const target = new THREE.WebGLRenderTarget(width, height, options)
  // 构造后赋值：采样数在首次使用时惰性读取，这样写可避开 options 的类型定义差异
  target.samples = spec.samples ?? 0

  if (useMRT) {
    // 逐附件定制格式 / 过滤 / 色彩空间（G-buffer 是数据缓冲，统一 NoColorSpace）
    // 防御：附件数可能少于声明的 mrt（不支持 MRT 的环境），逐张判空避免越界
    const n = Math.min(spec.mrt!.length, target.textures.length)
    for (let i = 0; i < n; i++) {
      const att = spec.mrt![i]
      const tex = target.textures[i]
      if (!tex) continue
      tex.type = att.format === 'RGBA16F' ? THREE.HalfFloatType : THREE.UnsignedByteType
      tex.minFilter = att.filter === 'linear' ? THREE.LinearFilter : THREE.NearestFilter
      tex.magFilter = att.filter === 'linear' ? THREE.LinearFilter : THREE.NearestFilter
      tex.colorSpace = THREE.NoColorSpace
      tex.name = `gbuffer-${att.name}`
    }
  } else {
    target.texture.colorSpace = THREE.NoColorSpace
    target.texture.name = `gi-postfx-${format}-${width}x${height}`
  }
  return target
}
