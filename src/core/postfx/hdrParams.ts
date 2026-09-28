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
}

/** 注意：defaults 必须显式标注类型，否则 boolean 会被推断成字面量类型 */
export const HDR_PARAM_DEFAULTS: HdrParams = {
  ev: 0,
  tm: 'linear',
  bypass: false,
  hdrDebug: 'none',
}

export const hdrParams = createDemoStore(HDR_PARAM_DEFAULTS)

/** 把 hdrDebug 的 'none' 哨兵转成管线要的 null */
export function resolveDebugPass(value: string): string | null {
  return value === 'none' ? null : value
}
