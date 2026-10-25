import { createDemoStore } from '../controls/demoStore'
import type { ShadowBiasMode, ShadowMode } from './shadowTypes'

/**
 * p1-shadow 的用户旋钮。
 *
 * 与 hdrParams 一样走 `createDemoStore`，自动获得 URL 序列化：
 * 例如 `?shadow=1&shadowMode=pcss&shadowCascades=4&shadowMapSize=1024`
 * 打开即复现同样的阴影配置。
 *
 * 参数名统一加 `shadow` 前缀，避免与 demo / HDR 链的同名旋钮冲突。
 */
export type ShadowParams = {
  /** 开关：1 = gbuffer.frag 应用阴影（调试视图会自动临时渲染图集） */
  shadow: boolean
  /** SM / PCF / PCSS */
  shadowMode: ShadowMode
  /** CSM 级联数：1 / 2 / 4（骨架支持最多 4 级） */
  shadowCascades: number
  /** 深度图集边长（像素）：1024 / 2048 / 4096 */
  shadowMapSize: number
  /** 阴影距离（世界单位） */
  shadowDistance: number
  /** bias 补偿方式 */
  shadowBiasMode: ShadowBiasMode
  /** 常数深度偏移 */
  shadowBias: number
  /** 斜率缩放系数（slope bias 模式） */
  shadowSlopeBias: number
  /** 法线偏移（世界单位） */
  shadowNormalBias: number
  /** PCF 半径（纹素） */
  shadowPCFRadius: number
  /** PCSS 半影尺度 */
  shadowLightSize: number
  /** 阴影强度 */
  shadowStrength: number
}

/** defaults 必须显式标注类型，否则 boolean 会被推断成字面量类型 */
export const SHADOW_PARAM_DEFAULTS: ShadowParams = {
  // 算法段（gbuffer.frag 的 shadowFactor）尚未实现，默认关闭。
  // 打开后图集照常生成，可在「阴影图集 / cascade 分层」调试视图里检查。
  shadow: false,
  shadowMode: 'pcf',
  shadowCascades: 1,
  shadowMapSize: 2048,
  shadowDistance: 40,
  shadowBiasMode: 'normal',
  shadowBias: 0.0008,
  shadowSlopeBias: 0.002,
  shadowNormalBias: 0.02,
  shadowPCFRadius: 1.5,
  shadowLightSize: 0.03,
  shadowStrength: 1,
}

export const shadowParams = createDemoStore(SHADOW_PARAM_DEFAULTS)
