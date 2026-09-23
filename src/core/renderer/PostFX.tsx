import type { ReactNode } from 'react'
import { HDRDriver } from '../postfx/HDRDriver'

/**
 * 后处理链的插槽（p0-hdr 落地点）。必须渲染在 <Canvas> 内部。
 *
 * 当前链（p0-hdr 步骤 1）：
 *   HDRDriver：场景 → RGBA16F HDR RT（含 DepthTexture / MSAA）
 *   → 全屏曝光直通 pass（手写线性→sRGB 编码）→ canvas
 *
 * 后续按 p0-hdr / p0-gbuffer-hud 依次插入：
 *   2. 自写色调映射：ACES / AgX / Reinhard 可切换 + 曲线图
 *   3. 物理 bloom：半分辨率 mip 链下采样再上采样
 *   4. 自动曝光：亮度 mip 测光 + 跨帧异步回读 + EV 语义
 *
 * 注意：HDRDriver 以 renderPriority=1 接管了 R3F 自动渲染，
 * 且依赖 createRenderer 中 toneMapping = NoToneMapping，
 * 否则会和后处理链重复做一次映射（画面发灰的常见原因）。
 */
export function PostFX({ children }: { children?: ReactNode }) {
  return (
    <>
      {children}
      <HDRDriver />
    </>
  )
}
