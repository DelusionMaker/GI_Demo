import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { gbufferShared } from './materials/gbufferShared'

// 模块级临时对象：每帧遍历场景图时不产生分配
const tmpLightPos = new THREE.Vector3()
const tmpTargetPos = new THREE.Vector3()
const tmpAmbient = new THREE.Color()
const tmpColor = new THREE.Color()
const directionalLights: THREE.DirectionalLight[] = []
const ambientLights: THREE.AmbientLight[] = []

/**
 * 把场景里的真实灯光同步到 GBufferMaterial 的共享 uniform（p1-pbr-ibl S1）。
 *
 * 规则（与 p1 的范围一致）：
 * - 主平行光取「优先 castShadow 的那一盏」—— demo 里的 key light；
 * - AmbientLight 全部求和，作为 IBL 未接入时的占位环境项；
 * - **不做**多光源循环与剔除：那是 `p1-light-ssr` 的范围。
 *
 * 每帧遍历一次场景图（demo 规模很小）；用模块级数组/向量避免 GC 抖动。
 */
export function GBufferLightSync() {
  const scene = useThree((state) => state.scene)

  useFrame(() => {
    directionalLights.length = 0
    ambientLights.length = 0

    scene.traverse((object) => {
      if ((object as THREE.DirectionalLight).isDirectionalLight) {
        directionalLights.push(object as THREE.DirectionalLight)
      } else if ((object as THREE.AmbientLight).isAmbientLight) {
        ambientLights.push(object as THREE.AmbientLight)
      }
    })

    const main = directionalLights.find((light) => light.castShadow) ?? directionalLights[0] ?? null
    if (main) {
      main.getWorldPosition(tmpLightPos)
      main.target.getWorldPosition(tmpTargetPos)
      // 指向光源的单位向量（与 gbuffer.frag 里的 L 同语义）
      gbufferShared.uLightDir.value.copy(tmpLightPos).sub(tmpTargetPos).normalize()
      gbufferShared.uLightColor.value.copy(main.color).multiplyScalar(main.intensity)
    }

    tmpAmbient.setRGB(0, 0, 0)
    for (const light of ambientLights) {
      tmpColor.copy(light.color).multiplyScalar(light.intensity)
      tmpAmbient.add(tmpColor)
    }
    gbufferShared.uAmbient.value.copy(tmpAmbient)
  })

  return null
}
