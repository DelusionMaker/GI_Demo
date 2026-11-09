/**
 * p3-bake S1 · Cornell 场景射线求交（框架实现，非作品集自写段）。
 *
 * 所有几何统一用 OBB 表达（薄板 = 某个轴半尺寸极小的盒子），
 * 因此只有一份 slab-test 代码；旋转来自 cornellData.ts 的 yawDeg，
 * 与渲染侧 CornellBox.tsx 的 rotation-y 同一数值，避免「烘焙场景 ≠ 渲染场景」。
 *
 * 作品集自写段只负责「往哪个方向发射、命中后怎么积分」，不负责求交。
 */

import type { Vec3 } from './bakeTypes.ts'
import { CORNELL_SURFACES } from './cornellData.ts'

export interface Hit {
  /** 沿单位方向的距离，> 0 */
  t: number
  /** 命中面法线（世界空间，指向射线来向） */
  normal: Vec3
  albedo: Vec3
  emission: Vec3
  name: string
}

const EPS = 1e-5

/** 世界→局部：R_y(-θ)；局部→世界用 R_y(θ)，与 three 的 rotation-y 一致 */
function toLocal(dx: number, dz: number, cos: number, sin: number): [number, number] {
  return [cos * dx - sin * dz, sin * dx + cos * dz]
}

function toWorldXZ(lx: number, lz: number, cos: number, sin: number): [number, number] {
  return [cos * lx + sin * lz, -sin * lx + cos * lz]
}

export function traceCornell(origin: Vec3, direction: Vec3): Hit | null {
  const len = Math.hypot(direction[0], direction[1], direction[2])
  if (len < EPS) return null
  const d: Vec3 = [direction[0] / len, direction[1] / len, direction[2] / len]

  let best: Hit | null = null
  let bestT = Infinity

  for (const surface of CORNELL_SURFACES) {
    const rad = (surface.yawDeg * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)

    const [ox, oz] = toLocal(
      origin[0] - surface.center[0],
      origin[2] - surface.center[2],
      cos,
      sin,
    )
    const [dx, dz] = toLocal(d[0], d[2], cos, sin)
    const o: Vec3 = [ox, origin[1] - surface.center[1], oz]
    const ld: Vec3 = [dx, d[1], dz]

    let tMin = -Infinity
    let tMax = Infinity
    let axis = 0
    let sign = 1

    for (let a = 0; a < 3; a++) {
      const half = surface.half[a]
      const oa = o[a]
      const da = ld[a]
      if (Math.abs(da) < EPS) {
        if (oa < -half || oa > half) {
          tMin = Infinity
          break
        }
        continue
      }
      let t1 = (-half - oa) / da
      let t2 = (half - oa) / da
      let s = -1
      if (t1 > t2) {
        const tmp = t1
        t1 = t2
        t2 = tmp
        s = 1
      }
      if (t1 > tMin) {
        tMin = t1
        axis = a
        sign = s
      }
      if (t2 < tMax) tMax = t2
      if (tMin > tMax) break
    }

    if (!Number.isFinite(tMin) || tMin <= EPS || tMin >= tMax || tMin >= bestT) continue

    const localNormal: number[] = [0, 0, 0]
    localNormal[axis] = sign
    const [nx, nz] = toWorldXZ(localNormal[0], localNormal[2], cos, sin)
    bestT = tMin
    best = {
      t: tMin,
      normal: [nx, localNormal[1], nz],
      albedo: surface.albedo,
      emission: surface.emission,
      name: surface.name,
    }
  }

  return best
}
