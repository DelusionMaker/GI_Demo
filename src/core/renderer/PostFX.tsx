import type { ReactNode } from 'react'

/**
 * 后处理链的插槽（p0-hdr 落地点）。
 *
 * 目前是直通（pass-through），后续按 p0-hdr / p0-gbuffer-hud 依次接入：
 *   1. HDR 渲染目标：把场景渲到 RGBA16F，而不是默认的 8bit 后缓冲
 *      （需要 capabilities.colorBufferFloat；WebGL2 下用 EXT_color_buffer_float）
 *   2. 自写色调映射：ACES / AgX / Reinhard 可切换 + 曲线图（约 30 行 shader）
 *   3. 自动曝光：亮度直方图回读（readPixels 异步回读，避免 stall）+ EV 语义
 *   4. 物理 bloom：mip 链下采样 + 上采样
 *
 * 注意：接入手写色调映射后，必须保持 renderer.toneMapping = NoToneMapping，
 * 否则会和后处理链重复做一次映射（画面发灰的常见原因）。
 */
export function PostFX({ children }: { children?: ReactNode }) {
  return <>{children}</>
}
