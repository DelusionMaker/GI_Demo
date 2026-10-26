import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { gbufferShared, MAX_LIGHTS } from './materials/gbufferShared'

// 模块级临时对象：每帧遍历场景图时不产生分配
const tmpLightPos = new THREE.Vector3()
const tmpTargetPos = new THREE.Vector3()
const tmpAmbient = new THREE.Color()
const tmpColor = new THREE.Color()
const tmpAxis = new THREE.Vector3()

const directionalLights: THREE.DirectionalLight[] = []
const pointLights: THREE.PointLight[] = []
const spotLights: THREE.SpotLight[] = []
const ambientLights: THREE.AmbientLight[] = []

/**
 * 把场景里的真实灯光同步到 GBufferMaterial 的共享 uniform（p1-light-ssr S1）。
 *
 * 规则（与 p1-light-ssr 范围一致）：
 * - 收集全部 平行光 / 点光 / 聚光 / 环境光，写入 uLightData* 数组（容量 MAX_LIGHTS）；
 * - 主平行光取「优先 castShadow 的那一盏」—— 它同时是阴影投射光，
 *   其索引写进 uShadowLightIndex，gbuffer.frag 只对它施加 shadowFactor；
 * - AmbientLight 全部求和，作为 IBL 未接入时的占位环境项；
 * - 多光源循环 + 剔除：S1 是暴力前向（gbuffer.frag 遍历全部灯），
 *   **Clustered 剔除是 S2/S3 的「作品集自写段」**，届时替换 gbuffer.frag 的循环与
 *   本同步里的「整体数组」为「per-cluster 灯列表」（数据纹理）。
 *
 * 每帧遍历一次场景图（demo 规模很小）；用模块级数组/向量避免 GC 抖动。
 */
export function GBufferLightSync() {
  const scene = useThree((state) => state.scene)

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

    // 平行光：方向 = 指向光源的单位向量（与 gbuffer.frag 的 L 同语义），range = 0（无限远）
    for (const light of directionalLights) {
      light.getWorldPosition(tmpLightPos)
      const isMain = light === main
      if (isMain) {
        light.target.getWorldPosition(tmpTargetPos)
        // 同步给 uLightDir/uLightColor（阴影光方向 / 强度的 legacy 引用，调试可用）
        gbufferShared.uLightDir.value.copy(tmpLightPos).sub(tmpTargetPos).normalize()
        gbufferShared.uLightColor.value.copy(light.color).multiplyScalar(light.intensity)
      }
      tmpAxis.copy(tmpLightPos).sub(tmpTargetPos).normalize()
      writeLight(0, tmpLightPos, light.color, light.intensity, 0, tmpAxis, 0, 0)
      if (isMain) shadowIndex = count - 1
    }

    // 点光：位置取世界坐标；range = light.distance（0 = 无距离限制）
    // TODO(作品集 · p1-light-ssr): 点光强度按 three 的 decay / 物理单位换算，与衰减模型对齐
    for (const light of pointLights) {
      light.getWorldPosition(tmpLightPos)
      writeLight(1, tmpLightPos, light.color, light.intensity, light.distance, tmpAxis.set(0, 0, 0), 0, 0)
    }

    // 聚光：位置取世界坐标；光锥轴 = 从灯指向 target；内角/外角由 angle/penumbra 推出
    for (const light of spotLights) {
      light.getWorldPosition(tmpLightPos)
      light.target.getWorldPosition(tmpTargetPos)
      tmpAxis.copy(tmpTargetPos).sub(tmpLightPos).normalize()
      const cosOuter = Math.cos(light.angle)
      const cosInner = Math.cos(light.angle * (1 - light.penumbra))
      writeLight(2, tmpLightPos, light.color, light.intensity, light.distance, tmpAxis, cosInner, cosOuter)
    }

    // 环境兜底（IBL 未启用时）：全部 AmbientLight 求和
    tmpAmbient.setRGB(0, 0, 0)
    for (const light of ambientLights) {
      tmpColor.copy(light.color).multiplyScalar(light.intensity)
      tmpAmbient.add(tmpColor)
    }
    gbufferShared.uAmbient.value.copy(tmpAmbient)

    gbufferShared.uLightCount.value = count
    gbufferShared.uShadowLightIndex.value = shadowIndex
  })

  return null
}
