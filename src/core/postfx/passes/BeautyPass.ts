import type { Pass } from '../Pass'

/**
 * 链首 pass：把场景渲进 HDR 目标（DEVLOG 中称为 beauty）。
 *
 * 本 pass 没有 `render` 实现：source === 'scene' 时由 Pipeline 执行
 * `renderer.setRenderTarget(target); renderer.render(scene, camera)`。
 *
 * 关键事实（已在 three r170 源码核实）：渲到 RenderTarget 时 three 强制使用
 * `LinearSRGBColorSpace` 作为输出色彩空间，即**不做 sRGB 编码**，
 * 因此写入的是未编码的线性值 —— 正是后续色调映射需要的输入。
 *
 * 后续 p0-gbuffer-hud 的 MRT（法线 / 深度 / albedo）将由本 pass 持有并管理。
 */
export class BeautyPass implements Pass {
  readonly name = 'beauty'
  enabled = true
  scale = 1
  source = 'scene' as const

  target = {
    format: 'RGBA16F' as const,
    filter: 'linear' as const,
    /**
     * 补回因渲到 RT 而丢失的 MSAA（渲染器的 antialias 只作用于默认后缓冲）。
     * 移动端 / 降级档应置 0。
     */
    samples: 4,
    /** 深度纹理在 RT 创建时即挂好，避免 p0-gbuffer-hud / SSR / SSGI 回头改 RT */
    depthTexture: true,
  }

  dispose(): void {
    // 目前无自持资源；接入 MRT 后在此释放附加附件
  }
}
