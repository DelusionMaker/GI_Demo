/**
 * p3-bake S1 · CLI 与运行时共用的纯数据契约。
 *
 * 硬约束：本模块及其依赖链（grid / cornellData / trace / bakeMath / irradiance）
 * **不得 import three、React 或任何 DOM API** —— Node 24 直接以 type stripping
 * 运行 `scripts/bake-probes.ts`，浏览器侧模块链会加载失败。
 */

/** 世界空间三维向量（与 GLSL 的 vec3 一一对应，避免引入 three 依赖） */
export type Vec3 = readonly [number, number, number]

/**
 * TODO(作品集 · 你来定稿)：低阶 SH 每探针、每通道的系数数量。
 * S0 定的是「低阶 SH + 三线性」，手册给的低档是 9 系数（到 L2）。
 * 改这里之前先想清楚：每探针总 float 数 = COEFFS_PER_PROBE × 3（RGB），
 * 直接决定产物体积与运行时带宽；改完需同步 `bakeMath.ts` 的投影与求值。
 */
export const COEFFS_PER_PROBE = 9

/** 均匀探针网格（S0 已定：显式 spacing，不做自适应布点） */
export interface ProbeGridSpec {
  /** 网格最小角（世界空间） */
  origin: Vec3
  /** 各轴探针数 */
  dims: readonly [number, number, number]
  spacing: number
}

/**
 * TODO(作品集 · 你来定稿)：Cornell 探针网格的 spacing 与 dims。
 * 房间约 5.528 × 5.488 × 5.592；下面的 0.8 / 7×7×7 只是让骨架能跑的占位，
 * 定稿时同时考虑墙体两侧的漏光（探针离墙太近会跨墙插值）。
 */
export const DEFAULT_GRID: ProbeGridSpec = {
  origin: [-2.4, 0.4, -2.4],
  dims: [7, 7, 7],
  spacing: 0.8,
}

export interface BakedProbe {
  /** 在网格中的线性索引，见 grid.ts 的 probePosition() */
  index: number
  /** SH 系数，长度 = COEFFS_PER_PROBE × 3（RGB 三通道） */
  coeffs: number[]
}

/** 入库产物格式；版本化是为了「可复现」不是装饰 */
export interface BakedProbesFile {
  format: 'gi-probe-sh'
  version: 1
  /** 'stub' = 算法段未实现，产物不可用于展示；只有骨架自检会用到 */
  status: 'implemented' | 'stub'
  seed: number
  spp: number
  coeffsPerProbe: number
  grid: ProbeGridSpec
  probes: BakedProbe[]
}

/** 一条方向上的入射 radiance 样本（供 SH 投影使用） */
export interface RadianceSample {
  /** 单位方向（世界空间） */
  dir: Vec3
  /** 该方向上的入射 radiance（线性 RGB） */
  radiance: Vec3
}
