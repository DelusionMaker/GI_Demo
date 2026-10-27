import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { gbufferShared, MAX_LIGHTS } from './materials/gbufferShared'
import {
  buildClusterLights,
  CLUSTER_TEX_WIDTH,
  type ClusterBuildResult,
  type ClusterLightInput,
} from './clusterCulling'

// 模块级临时对象：每帧遍历场景图 / 重建 cluster 时不产生分配
const tmpLightPos = new THREE.Vector3()
const tmpTargetPos = new THREE.Vector3()
const tmpAmbient = new THREE.Color()
const tmpColor = new THREE.Color()
const tmpAxis = new THREE.Vector3()
const bufSize = new THREE.Vector2()

const directionalLights: THREE.DirectionalLight[] = []
const pointLights: THREE.PointLight[] = []
const spotLights: THREE.SpotLight[] = []
const ambientLights: THREE.AmbientLight[] = []

// cluster 构建的输入同样池化：灯数不变时每帧零分配（否则每盏灯每帧 new 一个 Vector3）
const clusterLightPool: ClusterLightInput[] = []
const clusterLights: ClusterLightInput[] = []

function pushClusterLight(pos: THREE.Vector3, range: number) {
  const index = clusterLights.length
  let entry = clusterLightPool[index]
  if (!entry) {
    entry = { pos: new THREE.Vector3(), range }
    clusterLightPool[index] = entry
  }
  entry.pos.copy(pos)
  entry.range = range
  clusterLights.push(entry)
}

/**
 * cluster 数据纹理槽。
 *
 * 行数不变时复用同一张纹理，只置 needsUpdate 让 three 重传数据；
 * 只有分辨率变化（行数变化）才 dispose + 重建，避免每帧创建 / 销毁 GL 纹理对象。
 */
interface ClusterTextureSlot {
  texture: THREE.DataTexture | null
  rows: number
}

function uploadDataTexture(
  slot: ClusterTextureSlot,
  data: Float32Array<ArrayBuffer>,
  rows: number,
): THREE.DataTexture {
  if (slot.texture && slot.rows === rows) {
    slot.texture.needsUpdate = true
    return slot.texture
  }

  slot.texture?.dispose()
  // 尺寸必须与数据长度严格一致：DataTexture 按 width × height 整块上传，
  // 数据不足会触发 texSubImage2D INVALID_OPERATION（见 clusterCulling.ts 的 textureRows）
  const texture = new THREE.DataTexture(data, CLUSTER_TEX_WIDTH, rows, THREE.RGBAFormat, THREE.FloatType)
  texture.minFilter = texture.magFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  slot.texture = texture
  slot.rows = rows
  return texture
}

const gridSlot: ClusterTextureSlot = { texture: null, rows: 0 }
const indicesSlot: ClusterTextureSlot = { texture: null, rows: 0 }

function uploadClusterTextures(result: ClusterBuildResult) {
  // 数据缓冲由 clusterCulling 跨帧复用，同样的数组内容每帧都变，故都要标记 needsUpdate
  gbufferShared.uClusterLightGrid.value = uploadDataTexture(gridSlot, result.gridData, result.gridTexRows)
  gbufferShared.uClusterLightIndices.value = uploadDataTexture(indicesSlot, result.indicesData, result.indicesTexRows)
}

/**
 * 把场景里的真实灯光同步到 GBufferMaterial 的共享 uniform（p1-light-ssr S1 + S2）。
 *
 * - S1：收集全部 平行光 / 点光 / 聚光 / 环境光，填入 uLightData*（暴力前向用）。
 * - S2：当 `uClustered==1` 或 `uClusterDebug!=0` 时，额外构建 Clustered 的
 *   per-cluster 灯列表（CPU 基线，见 clusterCulling.ts），写入两张数据纹理。
 *   默认 uClustered=0 → 不构建，走 S1 暴力路径，保证现 demo 无回归。
 *
 * 每帧遍历一次场景图（demo 规模很小）；用模块级数组/向量避免 GC 抖动。
 */
export function GBufferLightSync() {
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)

  useFrame(() => {
    directionalLights.length = 0
    pointLights.length = 0
    spotLights.length = 0
    ambientLights.length = 0

    scene.traverse((object) => {
      if (object instanceof THREE.DirectionalLight) directionalLights.push(object)
      else if (object instanceof THREE.PointLight) pointLights.push(object)
      else if (object instanceof THREE.SpotLight) spotLights.push(object)
      else if (object instanceof THREE.AmbientLight) ambientLights.push(object)
    })

    // 主平行光（阴影投射光）取「优先 castShadow 的那一盏」
    const main = directionalLights.find((l) => l.castShadow) ?? directionalLights[0] ?? null

    let count = 0
    let shadowIndex = -1

    const writeLight = (
      type: number,
      pos: THREE.Vector3,
      color: THREE.Color,
      intensity: number,
      range: number,
      dir: THREE.Vector3,
      cosInner: number,
      cosOuter: number,
    ) => {
      if (count >= MAX_LIGHTS) return
      const d0 = gbufferShared.uLightData0.value[count]
      const d1 = gbufferShared.uLightData1.value[count]
      const d2 = gbufferShared.uLightData2.value[count]
      const d3 = gbufferShared.uLightData3.value[count]
      d0.set(pos.x, pos.y, pos.z, range)
      d1.set(color.r * intensity, color.g * intensity, color.b * intensity, type)
      d2.set(dir.x, dir.y, dir.z, cosInner)
      d3.set(cosOuter, 0, 0, 0)
      count++
    }

    // 平行光
    for (const light of directionalLights) {
      light.getWorldPosition(tmpLightPos)
      const isMain = light === main
      if (isMain) {
        light.target.getWorldPosition(tmpTargetPos)
        gbufferShared.uLightDir.value.copy(tmpLightPos).sub(tmpTargetPos).normalize()
        gbufferShared.uLightColor.value.copy(light.color).multiplyScalar(light.intensity)
      }
      tmpAxis.copy(tmpLightPos).sub(tmpTargetPos).normalize()
      writeLight(0, tmpLightPos, light.color, light.intensity, 0, tmpAxis, 0, 0)
      if (isMain) shadowIndex = count - 1
    }

    // 点光
    // TODO(作品集 · p1-light-ssr): 点光强度按 three 的 decay / 物理单位换算，与衰减模型对齐
    for (const light of pointLights) {
      light.getWorldPosition(tmpLightPos)
      writeLight(1, tmpLightPos, light.color, light.intensity, light.distance, tmpAxis.set(0, 0, 0), 0, 0)
    }

    // 聚光
    for (const light of spotLights) {
      light.getWorldPosition(tmpLightPos)
      light.target.getWorldPosition(tmpTargetPos)
      tmpAxis.copy(tmpTargetPos).sub(tmpLightPos).normalize()
      const cosOuter = Math.cos(light.angle)
      const cosInner = Math.cos(light.angle * (1 - light.penumbra))
      writeLight(2, tmpLightPos, light.color, light.intensity, light.distance, tmpAxis, cosInner, cosOuter)
    }

    // 环境兜底（IBL 未启用时）
    tmpAmbient.setRGB(0, 0, 0)
    for (const light of ambientLights) {
      tmpColor.copy(light.color).multiplyScalar(light.intensity)
      tmpAmbient.add(tmpColor)
    }
    gbufferShared.uAmbient.value.copy(tmpAmbient)

    gbufferShared.uLightCount.value = count
    gbufferShared.uShadowLightIndex.value = shadowIndex

    // ── S2：Clustered 构建（仅开启时，避免无谓开销）──
    const clustered = gbufferShared.uClustered.value === 1
    const clusterDebug = gbufferShared.uClusterDebug.value !== 0
    if (clustered || clusterDebug) {
      clusterLights.length = 0
      for (const l of directionalLights) pushClusterLight(l.getWorldPosition(tmpLightPos), 0)
      for (const l of pointLights) pushClusterLight(l.getWorldPosition(tmpLightPos), l.distance)
      for (const l of spotLights) pushClusterLight(l.getWorldPosition(tmpLightPos), l.distance)

      gl.getDrawingBufferSize(bufSize)
      const result = buildClusterLights({ lights: clusterLights, camera: camera as THREE.PerspectiveCamera, width: bufSize.x, height: bufSize.y })
      uploadClusterTextures(result)
      gbufferShared.uClusterDims.value.set(result.gridW, result.gridH, result.zSlices)
      gbufferShared.uViewNear.value = camera.near
      gbufferShared.uViewFar.value = camera.far
    }
  })

  return null
}
