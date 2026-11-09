/**
 * p3-bake S1 · 均匀探针网格与三线性权重（框架实现，非作品集自写段）。
 *
 * S0 已定：均匀网格 + 显式 spacing，不做自适应布点。
 * 这里的 worldPos ↔ index 与权重计算要能被阶段 4 的 DDGI backend 直接复用。
 * 纯 TS，Node CLI 与运行时共用；不 import three / React / DOM。
 */

import { DEFAULT_GRID, type ProbeGridSpec, type Vec3 } from './bakeTypes.ts'

export function probeCount(grid: ProbeGridSpec = DEFAULT_GRID): number {
  return grid.dims[0] * grid.dims[1] * grid.dims[2]
}

/** 线性索引 → 世界空间探针位置；与 BakedProbe.index 一一对应 */
export function probePosition(grid: ProbeGridSpec, index: number): Vec3 {
  const [nx, ny] = grid.dims
  const ix = index % nx
  const iy = Math.floor(index / nx) % ny
  const iz = Math.floor(index / (nx * ny))
  return [
    grid.origin[0] + ix * grid.spacing,
    grid.origin[1] + iy * grid.spacing,
    grid.origin[2] + iz * grid.spacing,
  ]
}

export interface TrilinearSample {
  /** 8 个邻域探针的线性索引（边界处会重复，退化成双线性/常量） */
  indices: number[]
  /** 对应权重，和为 1 */
  weights: number[]
}

/**
 * 世界坐标 → 8 邻域三线性权重。
 * S2 的 shader 求值必须与此同形（同 p0-hdr CPU/GPU 曲线「形状一致」的约束），
 * 否则运行时插值与烘焙自校验对不上。
 */
export function trilinear(grid: ProbeGridSpec, p: Vec3): TrilinearSample {
  const gx = (p[0] - grid.origin[0]) / grid.spacing
  const gy = (p[1] - grid.origin[1]) / grid.spacing
  const gz = (p[2] - grid.origin[2]) / grid.spacing

  const bx = Math.floor(gx)
  const by = Math.floor(gy)
  const bz = Math.floor(gz)
  const fx = gx - bx
  const fy = gy - by
  const fz = gz - bz

  const clampAxis = (v: number, n: number) => Math.max(0, Math.min(n - 1, v))
  const linearIndex = (x: number, y: number, z: number) =>
    clampAxis(x, grid.dims[0]) +
    clampAxis(y, grid.dims[1]) * grid.dims[0] +
    clampAxis(z, grid.dims[2]) * grid.dims[0] * grid.dims[1]

  const indices: number[] = []
  const weights: number[] = []
  for (let dz = 0; dz < 2; dz++) {
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        indices.push(linearIndex(bx + dx, by + dy, bz + dz))
        weights.push(
          (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz),
        )
      }
    }
  }
  return { indices, weights }
}
