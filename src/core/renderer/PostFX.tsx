import type { ReactNode } from 'react'
import { HDRDriver } from '../postfx/HDRDriver'

/**
 * 后处理链的插槽（p0-hdr 落地点）。必须渲染在 <Canvas> 内部。
 *
 * 当前链（p0-hdr 步骤 1）：
 *   HDRDriver：场景 → RGBA16F HDR RT（含 DepthTexture / MSAA）
 *   → 全屏曝光直通 pass（手写线性→sRGB 编码）→ canvas
 *
 * 链路已下沉为通用 `Pipeline` + 可插拔 `Pass`（见 src/core/postfx/），
 * 后续插入只需新增 pass、不必改调度逻辑：
 *   2. 自写色调映射：ACES / AgX / Reinhard 可切换 + 曲线图
 *   3. 物理 bloom：半分辨率 mip 链下采样再上采样（在 tonemap **之前**，HDR 线性空间）
 *   4. 自动曝光：亮度 mip 测光 + 跨帧异步回读 + EV 语义
 *
 * ⚠️ 色调映射必须全局关闭，且**必须在 `<Canvas>` 上传 `flat`**：
 *   R3F 在 configure 阶段会执行 `gl.toneMapping = flat ? NoToneMapping : ACESFilmicToneMapping`，
 *   仅靠 createRenderer 里的设置会被覆盖。否则场景材质先做一次 ACES，
 *   HDR RT 里存的就不再是线性 HDR 值，后续曲线会在已映射过的数据上再映射一次。
 */
export function PostFX({ children }: { children?: ReactNode }) {
  return (
    <>
      {children}
      <HDRDriver />
    </>
  )
}
