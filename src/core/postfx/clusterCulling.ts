import * as THREE from 'three'

// Clustered 网格常量：TS 与 gbuffer_lights.glsl 必须一致。
export const CLUSTER_TILE_SIZE = 16 // 屏幕分块（物理像素）
export const CLUSTER_Z_SLICES = 24 // 深度切片（对数切分）
export const CLUSTER_TEX_WIDTH = 2048 // 两张数据纹理的固定宽度（线性索引 → 2D 坐标）
import { MAX_LIGHTS } from './materials/gbufferShared'

export interface ClusterLightInput {
  /** 世界空间位置（平行光忽略） */
  pos: THREE.Vector3
  /** 影响半径（0 = 无限远，平行光用，覆盖全部 cluster） */
  range: number
}

export interface ClusterBuildResult {
  /** RGBA32F，长度 = totalClusters * 4，每 cluster 存 (offset, count, 0, 0) */
  gridData: Float32Array<ArrayBuffer>
  /** RGBA32F，长度 = totalIndices * 4，每槽 .r = 灯号 */
  indicesData: Float32Array<ArrayBuffer>
  gridW: number
  gridH: number
  zSlices: number
  totalClusters: number
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

/**
 * 构建 Clustered 的 per-cluster 灯列表（CPU 基线）—— 作品集可优化 / 迁 GPU compute。
 *
 * 思路（标准「保守分配」）：
 *   - 把每盏灯从世界空间变换到视图空间，取视图空间 AABB；
 *   - 投影到 NDC，得到覆盖的 tile(x,y) 与 depth slice(z) 范围；
 *   - 把灯号填进该范围内的所有 cluster（保守：cluster 内可能有未真正相交的灯）。
 * 平行光（range=0）覆盖全部 cluster。
 *
 * TODO(作品集 · p1-light-ssr S2): 这里用「范围分配」，可改成更精确的
 *   sphere-frustum 相交测试，或把整段迁到 WebGPU compute（阶段 4 后端切分点）。
 */
export function buildClusterLights(opts: {
  lights: ClusterLightInput[]
  camera: THREE.PerspectiveCamera
  width: number // drawing buffer 宽（物理像素）
  height: number
}): ClusterBuildResult {
  const { lights, camera, width, height } = opts
  const gw = Math.ceil(width / CLUSTER_TILE_SIZE)
  const gh = Math.ceil(height / CLUSTER_TILE_SIZE)
  const zs = CLUSTER_Z_SLICES
  const totalClusters = gw * gh * zs

  const near = camera.near
  const far = camera.far
  const logRatio = Math.log(far / near)
  const proj = camera.projectionMatrix // 视图空间 → 裁剪/NDC（applyMatrix4 已含透视除法）
  const viewInv = camera.matrixWorldInverse

  const counts = new Int32Array(totalClusters)
  const offsets = new Int32Array(totalClusters)
  // 每盏灯的覆盖范围（6 个 int：tx0,ty0,tz0,tx1,ty1,tz1），避免 Pass B 重算
  const ranges = new Int32Array(lights.length * 6)

  const center = new THREE.Vector3()
  const corner = new THREE.Vector3()

  // ── Pass A：统计每 cluster 灯数 + 记录每灯范围 ──
  for (let li = 0; li < lights.length; li++) {
    const light = lights[li]
    let tx0 = 0
    let ty0 = 0
    let tx1 = gw - 1
    let ty1 = gh - 1
    let tz0 = 0
    let tz1 = zs - 1

    if (light.range > 0) {
      center.copy(light.pos).applyMatrix4(viewInv)
      const r = light.range
      const minX = center.x - r
      const maxX = center.x + r
      const minY = center.y - r
      const maxY = center.y + r
      const minZ = center.z - r
      const maxZ = center.z + r // 视图空间 z 为负，越小越远

      // 8 角投影到 NDC，取 xy / 深度范围
      let ndcMinX = Infinity
      let ndcMaxX = -Infinity
      let ndcMinY = Infinity
      let ndcMaxY = -Infinity
      let depthMin = Infinity
      let depthMax = -Infinity
      for (let cx = 0; cx < 2; cx++) {
        for (let cy = 0; cy < 2; cy++) {
          for (let cz = 0; cz < 2; cz++) {
            corner.set(cx ? maxX : minX, cy ? maxY : minY, cz ? maxZ : minZ).applyMatrix4(proj)
            ndcMinX = Math.min(ndcMinX, corner.x)
            ndcMaxX = Math.max(ndcMaxX, corner.x)
            ndcMinY = Math.min(ndcMinY, corner.y)
            ndcMaxY = Math.max(ndcMaxY, corner.y)
            const depth = -corner.z // 视图空间深度（正）
            depthMin = Math.min(depthMin, depth)
            depthMax = Math.max(depthMax, depth)
          }
        }
      }
      tx0 = clamp(Math.floor(((ndcMinX + 1) / 2) * gw), 0, gw - 1)
      tx1 = clamp(Math.floor(((ndcMaxX + 1) / 2) * gw), 0, gw - 1)
      ty0 = clamp(Math.floor(((ndcMinY + 1) / 2) * gh), 0, gh - 1)
      ty1 = clamp(Math.floor(((ndcMaxY + 1) / 2) * gh), 0, gh - 1)
      // 深度→slice：depthMax 是最近（小 slice），depthMin 是最远（大 slice）
      tz0 = clamp(Math.floor((Math.log(Math.min(depthMax, far) / near) / logRatio) * zs), 0, zs - 1)
      tz1 = clamp(Math.floor((Math.log(Math.max(depthMin, near) / near) / logRatio) * zs), 0, zs - 1)
    }

    ranges[li * 6 + 0] = tx0
    ranges[li * 6 + 1] = ty0
    ranges[li * 6 + 2] = tz0
    ranges[li * 6 + 3] = tx1
    ranges[li * 6 + 4] = ty1
    ranges[li * 6 + 5] = tz1

    for (let tz = tz0; tz <= tz1; tz++) {
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          const idx = tx + ty * gw + tz * gw * gh
          if (idx >= 0 && idx < totalClusters) counts[idx]++
        }
      }
    }
  }

  // 每 cluster 灯数上限（避免单 cluster 爆炸；同时是 shader 循环上限）
  for (let i = 0; i < totalClusters; i++) {
    if (counts[i] > MAX_LIGHTS) counts[i] = MAX_LIGHTS
  }

  // 前缀和 → offset
  let acc = 0
  for (let i = 0; i < totalClusters; i++) {
    offsets[i] = acc
    acc += counts[i]
  }
  const totalIndices = acc

  // ── Pass B：填灯号索引 ──
  const gridData = new Float32Array(totalClusters * 4)
  const indicesData = new Float32Array(Math.max(totalIndices, 1) * 4)
  const cursor = new Int32Array(totalClusters)
  for (let li = 0; li < lights.length; li++) {
    const tx0 = ranges[li * 6 + 0]
    const ty0 = ranges[li * 6 + 1]
    const tz0 = ranges[li * 6 + 2]
    const tx1 = ranges[li * 6 + 3]
    const ty1 = ranges[li * 6 + 4]
    const tz1 = ranges[li * 6 + 5]
    for (let tz = tz0; tz <= tz1; tz++) {
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          const idx = tx + ty * gw + tz * gw * gh
          if (idx < 0 || idx >= totalClusters) continue
          const local = cursor[idx]
          if (local >= counts[idx]) continue // 已达该 cluster 上限
          indicesData[(offsets[idx] + local) * 4] = li
          cursor[idx] = local + 1
        }
      }
    }
  }

  // grid 数据
  for (let i = 0; i < totalClusters; i++) {
    gridData[i * 4 + 0] = offsets[i]
    gridData[i * 4 + 1] = counts[i]
  }

  return { gridData, indicesData, gridW: gw, gridH: gh, zSlices: zs, totalClusters }
}
