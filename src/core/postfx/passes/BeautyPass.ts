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
     * MSAA：S3 复核后开启 4x（脚手架阶段为 0）。
     * - 三附件均正确 resolve（G-buffer 调试视图数值与 0x 时一致）；
     * - 与直出路径（自带 MSAA）的 A/B 最大差从 68.4 → 29.1，边缘对齐，
     *   残差主要是 16F/8bit 量化；
     * - three r170 默认 `resolveDepthBuffer = true`（见 updateMultisampleRenderTarget），
     *   MSAA 下深度会 blit 到 DepthTexture；SSR 阶段仍需在目标设备实测确认
     *   （不同驱动对 depth blit 的支持有差异，不稳则退回 samples:0 或改 TAA）。
     */
    samples: 4,
    /** 深度纹理在 RT 创建时即挂好，避免 p0-gbuffer-hud / SSR / SSGI 回头改 RT */
    depthTexture: true,
    /**
     * G-buffer MRT：albedo（供下游当 beauty）/ normal / MRAO。S2 由 GBufferMaterial 填充。
     *
     * gAlbedo 用 RGBA16F 而非 S1 规划的 RGBA8：S2 已定「前向着色」——gAlbedo 存的是
     * Cook-Torrance 的**最终颜色**（含 >1 的高光），RGBA8 会在写入时截断到 1，
     * 下游 tonemap / bloom 阈值 / EV 就失去 HDR 前提（MRT 真正启用后才会暴露）。
     * gMRAO 仍是数据通道，RGBA8 足够。
     */
    mrt: [
      { name: 'gAlbedo' as const, format: 'RGBA16F' as const, filter: 'linear' as const },
      { name: 'gNormal' as const, format: 'RGBA16F' as const, filter: 'linear' as const },
      { name: 'gMRAO' as const, format: 'RGBA8' as const, filter: 'linear' as const },
    ],
  }

  dispose(): void {
    // 目前无自持资源；接入 MRT 后在此释放附加附件
  }
}
