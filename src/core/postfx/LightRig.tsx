import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { observer } from 'mobx-react-lite'
import * as THREE from 'three'
import { clusterParams } from './clusterParams'

/** 灯色循环：多光源场景要能一眼分辨「哪盏灯照亮了哪里」 */
const PALETTE = ['#ffb37a', '#ffd166', '#7fd4ff', '#b79bff', '#8ef0b0', '#ff9ec7']

export interface LightRigProps {
  /** 灯阵环半径（世界单位） */
  radius?: number
  /** 灯的高度（世界单位） */
  height?: number
  /** 单灯影响半径（**必须 > 0**：range = 0 在 clusterCulling 里等价于平行光，会覆盖全部 cluster） */
  range?: number
  /** 单灯强度（本工程的自写衰减：window / (dist² + 1)，不是 three 的物理单位） */
  intensity?: number
}

/**
 * 程序化灯阵（p1-light-ssr S3-b 的样板）。
 *
 * 为什么不用 three 的 `pointLight` 直接当主光源：本工程的直接光全部走
 * `gbuffer.frag` 的自写 BRDF，`GBufferLightSync` 每帧遍历场景把灯写进 uniform 数组，
 * 所以这里只需要摆 `pointLight` / `spotLight` 对象，渲染由自写着色器负责。
 *
 * TODO(作品集 · 你来定稿)：
 * 1. `radius / height / range / intensity` 由 demo 按场景传入（现在是 Cornell 的量级），
 *    户外场景要整体放大；灯的位置分布决定 A/B 是否「看得出差异」，值得手调。
 * 2. 2 盏聚光的位置 / 朝向 / 锥角目前是占位值，按你想要的画面改。
 * 3. 灯色只要保证相邻灯可区分即可，不必追求好看 —— 这是诊断场景，不是成片。
 */
export const LightRig = observer(function LightRig({
  radius = 1.9,
  height = 2.9,
  range = 3.2,
  intensity = 6,
}: LightRigProps) {
  const { lightCount, lightSpin } = clusterParams.params
  const group = useRef<THREE.Group>(null)

  // 灯位只在灯数 / 布局变化时重算；帧内不分配
  const placements = useMemo(() => {
    const items: Array<{ position: [number, number, number]; color: string }> = []
    for (let i = 0; i < lightCount; i++) {
      const angle = (i / lightCount) * Math.PI * 2
      // 高度错开三层，避免所有灯共面导致「看不出景深」
      const y = height + ((i % 3) - 1) * 0.35
      items.push({
        position: [Math.cos(angle) * radius, y, Math.sin(angle) * radius],
        color: PALETTE[i % PALETTE.length],
      })
    }
    return items
  }, [lightCount, radius, height])

  useFrame((_, delta) => {
    if (!lightSpin || !group.current) return
    group.current.rotation.y += delta * 0.35
  })

  // 0 盏点光时不挂任何灯：现有页面（hdr / pbr-ibl）保持逐像素一致
  if (lightCount <= 0) return null

  return (
    <group ref={group}>
      {placements.map((item, index) => (
        <pointLight
          key={index}
          position={item.position}
          color={item.color}
          intensity={intensity}
          distance={range}
          decay={2}
        />
      ))}

      {/* 聚光：验证 spot 分支（锥角 + 距离窗），目标点固定在场景中心上方 */}
      <spotLight
        position={[radius * 0.9, height + 0.6, radius * 0.9]}
        target-position={[0, 1.2, 0]}
        color="#ffe3b0"
        intensity={intensity * 1.6}
        distance={range * 2}
        angle={0.45}
        penumbra={0.35}
      />
      <spotLight
        position={[-radius * 0.9, height + 0.2, -radius * 0.9]}
        target-position={[0, 1.2, 0]}
        color="#cfe4ff"
        intensity={intensity * 1.2}
        distance={range * 2}
        angle={0.5}
        penumbra={0.5}
      />
    </group>
  )
})
