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
  /**
   * RGBA32F，每 cluster 存 (offset, count, 0, 0)。
   * 长度已按 CLUSTER_TEX_WIDTH 向上对齐（尾行零填充），可直接作为 DataTexture 的数据源。
   * 注意：该缓冲会被下次构建原地覆盖复用，不要跨帧持有。
   */
  gridData: Float32Array<ArrayBuffer>
  /** RGBA32F，每槽 .r = 灯号；同上，长度已对齐纹理尺寸，且同样跨帧复用 */
  indicesData: Float32Array<ArrayBuffer>
  gridW: number
  gridH: number
  zSlices: number
  totalClusters: number
  /** 两张数据纹理的高度（行数），配合 CLUSTER_TEX_WIDTH 构造 DataTexture */
  gridTexRows: number
  indicesTexRows: number
}

/**
 * 数据纹理所需行数：把 texel 数向上取整到 CLUSTER_TEX_WIDTH 的整数倍。
 *
 * 必须补齐：DataTexture 上传时按 width × height 整块 texSubImage2D，
 * 数据长度不足会触发 WebGL INVALID_OPERATION（ArrayBufferView not big enough for request）。
 */
const textureRows = (texels: number) => Math.max(1, Math.ceil(texels / CLUSTER_TEX_WIDTH))

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

/**
 * 复用的工作缓冲（模块级）。buildClusterLights 是同步单线程调用，
 * 尺寸不变时直接复用同一批数组：正常帧零分配，仅在分辨率 / 灯数变化时重建。
 */
let countsBuf = new Int32Array(0)
let offsetsBuf = new Int32Array(0)
let rangesBuf = new Int32Array(0)
let cursorBuf = new Int32Array(0)
let gridBuf = new Float32Array(0)
let indicesBuf = new Float32Array(0)

function int32Buffer(current: Int32Array<ArrayBuffer>, length: number): Int32Array<ArrayBuffer> {
  return current.length === length ? current : new Int32Array(length)
}

function float32Buffer(current: Float32Array<ArrayBuffer>, length: number): Float32Array<ArrayBuffer> {
  return current.length === length ? current : new Float32Array(length)
}

/** 临时向量同样复用：函数同步执行，不会被并发打断 */
const viewCenter = new THREE.Vector3()
const viewCorner = new THREE.Vector3()

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

  // counts / cursor 是累加语义，复用前必须清零；offsets 与 ranges 每帧全量覆盖
  const counts = (countsBuf = int32Buffer(countsBuf, totalClusters))
  counts.fill(0)
  const offsets = (offsetsBuf = int32Buffer(offsetsBuf, totalClusters))
  // 每盏灯的覆盖范围（6 个 int：tx0,ty0,tz0,tx1,ty1,tz1），避免 Pass B 重算
  const ranges = (rangesBuf = int32Buffer(rangesBuf, lights.length * 6))

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
      viewCenter.copy(light.pos).applyMatrix4(viewInv)
      const r = light.range
      const minX = viewCenter.x - r
      const maxX = viewCenter.x + r
      const minY = viewCenter.y - r
      const maxY = viewCenter.y + r
      const minZ = viewCenter.z - r
      const maxZ = viewCenter.z + r // 视图空间 z 为负，越小越远

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
            viewCorner.set(cx ? maxX : minX, cy ? maxY : minY, cz ? maxZ : minZ).applyMatrix4(proj)
            ndcMinX = Math.min(ndcMinX, viewCorner.x)
            ndcMaxX = Math.max(ndcMaxX, viewCorner.x)
            ndcMinY = Math.min(ndcMinY, viewCorner.y)
            ndcMaxY = Math.max(ndcMaxY, viewCorner.y)
            const depth = -viewCorner.z // 视图空间深度（正）
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
  // 按纹理尺寸分配（而非逻辑长度）：多出的尾部 texel 保持 0，只用于满足 texSubImage2D 的整块上传
  const gridTexRows = textureRows(totalClusters)
  const indicesTexRows = textureRows(Math.max(totalIndices, 1))
  const gridData = (gridBuf = float32Buffer(gridBuf, gridTexRows * CLUSTER_TEX_WIDTH * 4))
  const indicesData = (indicesBuf = float32Buffer(indicesBuf, indicesTexRows * CLUSTER_TEX_WIDTH * 4))
  // 每个 cluster 的写入游标（累加语义）必须清零；尾部 padding 与未达上限的 texel 保持 0
  const cursor = (cursorBuf = int32Buffer(cursorBuf, totalClusters))
  cursor.fill(0)
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

  return {
    gridData,
    indicesData,
    gridW: gw,
    gridH: gh,
    zSlices: zs,
    totalClusters,
    gridTexRows,
    indicesTexRows,
  }
}
