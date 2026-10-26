import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { gbufferShared, MAX_LIGHTS } from './materials/gbufferShared'
import { buildClusterLights, CLUSTER_TEX_WIDTH, type ClusterLightInput } from './clusterCulling'

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

// cluster 数据纹理：每次构建都重建（仅在 clustered/调试开启时触发，可接受；
// 作品集优化点：尺寸不变时复用同一张纹理并 .set，避免每帧 dispose/上传开销）
let gridTex: THREE.DataTexture | null = null
let indicesTex: THREE.DataTexture | null = null

function uploadClusterTextures(gridData: Float32Array, indicesData: Float32Array, totalClusters: number) {
  const gw = Math.ceil(totalClusters / CLUSTER_TEX_WIDTH) || 1
  const totalIndices = indicesData.length / 4
  const iw = Math.ceil(Math.max(totalIndices, 1) / CLUSTER_TEX_WIDTH) || 1

  gridTex?.dispose()
  // 类型边界：TS 5.x 把 Float32Array 默认为 ArrayBufferLike，与 three 的 BufferSource(ArrayBuffer) 不兼容，此处收窄
  gridTex = new THREE.DataTexture(gridData as unknown as Float32Array<ArrayBuffer>, CLUSTER_TEX_WIDTH, gw, THREE.RGBAFormat, THREE.FloatType)
  gridTex.minFilter = gridTex.magFilter = THREE.NearestFilter
  gridTex.generateMipmaps = false
  gridTex.needsUpdate = true
  gbufferShared.uClusterLightGrid.value = gridTex

  indicesTex?.dispose()
  indicesTex = new THREE.DataTexture(indicesData as unknown as Float32Array<ArrayBuffer>, CLUSTER_TEX_WIDTH, iw, THREE.RGBAFormat, THREE.FloatType)
  indicesTex.minFilter = indicesTex.magFilter = THREE.NearestFilter
  indicesTex.generateMipmaps = false
  indicesTex.needsUpdate = true
  gbufferShared.uClusterLightIndices.value = indicesTex
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
      const lights: ClusterLightInput[] = []
      for (const l of directionalLights) lights.push({ pos: l.getWorldPosition(tmpLightPos.clone()), range: 0 })
      for (const l of pointLights) lights.push({ pos: l.getWorldPosition(tmpLightPos.clone()), range: l.distance })
      for (const l of spotLights) lights.push({ pos: l.getWorldPosition(tmpLightPos.clone()), range: l.distance })

      gl.getDrawingBufferSize(bufSize)
      const result = buildClusterLights({ lights, camera: camera as THREE.PerspectiveCamera, width: bufSize.x, height: bufSize.y })
      uploadClusterTextures(result.gridData, result.indicesData, result.totalClusters)
      gbufferShared.uClusterDims.value.set(result.gridW, result.gridH, result.zSlices)
      gbufferShared.uViewNear.value = camera.near
      gbufferShared.uViewFar.value = camera.far
    }
  })

  return null
}
