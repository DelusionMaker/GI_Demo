import { createDemoStore } from '../controls/demoStore'
import type { TonemapMode } from './HDRPipeline'

/**
 * HDR 链路的用户旋钮。
 *
 * 走 `createDemoStore` 是为了自动获得 URL 序列化（文档硬要求：状态进 URL 可直接分享复现），
 * 例如 `?ev=-2&tm=aces` 打开即复现同样的曝光与曲线。
 *
 * 参数名刻意避开 demo 自己的参数：demoStore 的 `debug` 已被 demo 占用，
 * 所以链路调试视图叫 `hdrDebug`，否则两者会互相覆盖。
 */
export type HdrParams = {
  /** 曝光偏移，单位 EV；着色器内 multiplier = exp2(ev) */
  ev: number
  /** 色调映射曲线 */
  tm: TonemapMode
  /** 旁路整条链（场景直出），用于 A/B 对比 */
  bypass: boolean
  /** 中间量可视化：把链路截断到某个 pass；'none' = 完整链路 */
  hdrDebug: string
  /** 自动曝光：由 luminance 测光 pass 跨帧算 EV（手动 EV 滑块转为补偿量） */
  autoexposure: boolean
  /** 过曝回收诊断：把任一通道 > 1 的像素染红，直观展示被 tonemap 救回的高光 */
  clipView: boolean
  /** Bloom（HDR 域内阈值 + mip 链），物理正确的高光光晕 */
  bloom: boolean
  /** Bloom 强度（HDR 线性空间叠加系数） */
  bloomIntensity: number
  /** Bloom 亮度阈值（HDR 线性空间，通常 ~1.0） */
  bloomThreshold: number
  /** Bloom soft-knee 半宽：阈值附近的柔和过渡区间 */
  bloomKnee: number
}

/** 注意：defaults 必须显式标注类型，否则 boolean 会被推断成字面量类型 */
export const HDR_PARAM_DEFAULTS: HdrParams = {
  ev: 0,
  tm: 'linear',
  bypass: false,
  hdrDebug: 'none',
  autoexposure: false,
  clipView: false,
  bloom: false,
  bloomIntensity: 1,
  bloomThreshold: 0.8,
  bloomKnee: 0.5,
}

export const hdrParams = createDemoStore(HDR_PARAM_DEFAULTS)

/** 把 hdrDebug 的 'none' 哨兵转成管线要的 null */
export function resolveDebugPass(value: string): string | null {
  return value === 'none' ? null : value
}

/**
 * G-buffer 调试视图取值（S3）：'gbuffer:normal' → 1（0 = gAlbedo / 1 = gNormal / 2 = gMRAO）。
 * 与「按 pass 名截断」共用同一个 hdrDebug 下拉，因此能自动进 URL。
 */
const GBUFFER_DEBUG_ATTACHMENT: Record<string, number> = {
  'gbuffer:albedo': 0,
  'gbuffer:normal': 1,
  'gbuffer:mrao': 2,
}

/** 非 G-buffer 视图返回 null（此时走 resolveDebugPass 的 pass 截断逻辑） */
export function resolveGBufferDebug(value: string): number | null {
  return GBUFFER_DEBUG_ATTACHMENT[value] ?? null
}
