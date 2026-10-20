/**
 * p1-shadow 的类型与索引映射。
 *
 * 单独成文件：渲染核心（passes/ShadowMapPass）与 UI 旋钮（shadowParams）都要用，
 * 但两边不应互相 import（渲染核心不能依赖 MobX 状态层）。
 *
 * 索引值会写进共享 uniform，必须与 `gbuffer.frag` 里的分支保持一致。
 */

/**
 * 阴影算法：硬阴影 / PCF / PCSS。
 * VSM 需要独立的 moment RT + 可分离 blur pass，不在本骨架内；
 * 要做时在这里加 'vsm' 并补对应索引与 pass。
 */
export type ShadowMode = 'hard' | 'pcf' | 'pcss'

/** bias 补偿方式：不做 / 常数深度偏移 / 法线偏移 / 斜率缩放 */
export type ShadowBiasMode = 'none' | 'constant' | 'normal' | 'slope'

export const SHADOW_MODE_INDEX: Record<ShadowMode, number> = {
  hard: 0,
  pcf: 1,
  pcss: 2,
}

export const SHADOW_BIAS_INDEX: Record<ShadowBiasMode, number> = {
  none: 0,
  constant: 1,
  normal: 2,
  slope: 3,
}
