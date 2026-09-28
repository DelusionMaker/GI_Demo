import type { Pass } from '../Pass'

/**
 * 链首 pass：把场景渲进 HDR 目标。
 *
 * 关键事实（已在 three r170 源码中核实）：渲到 RenderTarget 时 three 强制使用
 * `LinearSRGBColorSpace` 作为输出色彩空间，即**不做 sRGB 编码**，
 * 因此这里写入的是未编码的线性值 —— 正是后续色调映射需要的输入。
 *
 * 本 pass 没有 `render` 实现：source === 'scene' 时由 Pipeline 执行
 * `renderer.setRenderTarget(target); renderer.render(scene, camera)`。
 * 后续 p0-gbuffer-hud 的 MRT（法线 / 深度 / albedo）将由本 pass 持有并管理。
 */
export class ScenePass implements Pass {
  readonly name = 'scene'
  enabled = true
  scale = 1
  source = 'scene' as const

  target = {
    format: 'RGBA16F' as const,
    filter: 'linear' as const,
    /** 补回因渲到 RT 而丢失的 MSAA，否则与老路径的边缘会有可见差异 */
    samples: 4,
  }

  lastGpuMs: number | undefined

  dispose(): void {
    // 目前无自持资源；接入 MRT 后在此释放附加附件
  }
}
