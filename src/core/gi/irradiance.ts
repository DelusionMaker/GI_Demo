/**
 * p3-bake S0 · 统一辐照度采样契约（S1 只落契约，S2 才接运行时）。
 *
 * S0 已定：静态 SH 与 DDGI 图集同属世界空间辐照度缓存，只换 backend，
 * 着色侧不感知来源。签名 `sampleIrradiance(worldPos, normal) → vec3` 不变，
 * 这里用纯 `Vec3` 元组代替 THREE.Vector3，好让 CLI 链（Node 24 type stripping）
 * 不依赖 three；语义一致。
 *
 * 语义契约：
 * - 返回 `E/π`（平均 radiance），不含 albedo / kD / 显式 π；
 * - worldPos / normal 均为世界空间；
 * - 无探针覆盖返回 [0,0,0]，由着色侧按 `?bake=` 决定是否回退 uAmbient，
 *   保证关闭时逐像素零回归。
 */

import type { Vec3 } from './bakeTypes.ts'

export type IrradianceBackend = 'static-sh' | 'ddgi'

export interface IrradianceSource {
  readonly backend: IrradianceBackend
  sampleIrradiance(worldPos: Vec3, normal: Vec3): Vec3
  dispose(): void
}

// TODO(S2)：建 backends/StaticSH.ts 与 backends/DDGI.ts。
// StaticSH 消费 BakedProbesFile + grid.ts 的 trilinear()，DDGI 换八面体图集，
// 两者都实现本接口；visibility / backface 抗漏光放在 DDGI backend 内部，
// 不改这里的两参数签名（S0 第 3 项决策）。
