import { Suspense, useEffect, useMemo } from 'react'
import type * as THREE from 'three'
import { createGBufferMaterial, type GBufferMaterialOptions } from '@/core/postfx/materials/GBufferMaterial'
import { createSkyMaterial } from '@/core/postfx/materials/SkyMaterial'
import { GltfScene } from './GltfScene'
import { SCENES } from './scenes'

const MODEL_POSITION: [number, number, number] = [0, 0.01, -8]
const MODEL_FIT = 11

interface SphereSpec {
  x: number
  color: string
  roughness: number
  metalness: number
}

/** 经典 IBL 对照：一排金属 / 介电球，粗糙度从左到右递增 */
const TEST_SPHERES: SphereSpec[] = [
  { x: -4, color: '#e2e8f0', roughness: 0.05, metalness: 1 },
  { x: -2, color: '#e2e8f0', roughness: 0.25, metalness: 1 },
  { x: 0, color: '#e2e8f0', roughness: 0.55, metalness: 1 },
  { x: 2, color: '#d8dee6', roughness: 0.1, metalness: 0 },
  { x: 4, color: '#d8dee6', roughness: 0.55, metalness: 0 },
]

interface BoxSpec {
  position: [number, number, number]
  size: [number, number, number]
  rotationY: number
  color: string
  roughness: number
  metalness: number
}

/** 简单建筑体块：给 IBL 一个比球更「平」的对照面，同时框住画面 */
const TEST_BOXES: BoxSpec[] = [
  {
    position: [-6.5, 1.5, 1.5],
    size: [2.2, 3, 2.2],
    rotationY: 0.4,
    color: '#6b7280',
    roughness: 0.8,
    metalness: 0,
  },
  {
    position: [6.5, 1, 1],
    size: [2.4, 2, 2.4],
    rotationY: -0.3,
    color: '#9a6b4f',
    roughness: 0.7,
    metalness: 0,
  },
]

/**
 * 户外 IBL 验证场景。
 *
 * 组成：
 * - 地面（大平面）+ 一排金属/介电球 + 两个建筑体块，全部用 GBufferMaterial；
 * - LittlestTokyo（CC BY 4.0，Draco 压缩）作为带贴图/蒙皮的真实资产对照。
 *
 * 环境贴图不在这里加载：`GBufferEnvironment` 按 `SCENES.outdoor.envUrl` 加载
 * Poly Haven 的 equirect HDR，并写进 gbufferShared.uEnvMap。
 */
export function OutdoorScene() {
  const modelUrl = SCENES.outdoor.url

  const materials = useMemo(() => {
    const created: THREE.RawShaderMaterial[] = []
    const make = (options: GBufferMaterialOptions) => {
      const material = createGBufferMaterial(options)
      created.push(material)
      return material
    }

    const ground = make({ color: '#30363d', roughness: 0.95, metalness: 0 })
    const spheres = TEST_SPHERES.map((spec) =>
      make({ color: spec.color, roughness: spec.roughness, metalness: spec.metalness }),
    )
    const boxes = TEST_BOXES.map((spec) =>
      make({ color: spec.color, roughness: spec.roughness, metalness: spec.metalness }),
    )
    // 天空球：1K equirect HDR 直接显示；写满 3 个 MRT 附件，不能用 scene.background。
    const sky = createSkyMaterial()
    created.push(sky)

    return { ground, spheres, boxes, sky, all: created }
  }, [])

  useEffect(() => {
    return () => {
      materials.all.forEach((material) => material.dispose())
    }
  }, [materials])

  return (
    <group>
      {/* 天空球先画（renderOrder=-1，depthTest/Write=false），场景物体随后覆盖 */}
      <mesh renderOrder={-1} frustumCulled={false}>
        <sphereGeometry args={[300, 32, 16]} />
        <primitive object={materials.sky} attach="material" />
      </mesh>

      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        {/* 地面远大于相机 far=500：避免 60×60 边缘在画面里形成一条硬地平线 */}
        <planeGeometry args={[1000, 1000]} />
        <primitive object={materials.ground} attach="material" />
      </mesh>

      {TEST_SPHERES.map((spec, index) => (
        <mesh key={`sphere-${spec.x}`} position={[spec.x, 0.7, 3]} castShadow receiveShadow>
          <sphereGeometry args={[0.7, 48, 32]} />
          <primitive object={materials.spheres[index]} attach="material" />
        </mesh>
      ))}

      {TEST_BOXES.map((spec, index) => (
        <mesh
          key={`box-${spec.position[0]}`}
          position={spec.position}
          rotation-y={spec.rotationY}
          castShadow
          receiveShadow
        >
          <boxGeometry args={spec.size} />
          <primitive object={materials.boxes[index]} attach="material" />
        </mesh>
      ))}

      {modelUrl ? (
        <Suspense fallback={null}>
          <GltfScene url={modelUrl} fit={MODEL_FIT} position={MODEL_POSITION} />
        </Suspense>
      ) : null}
    </group>
  )
}
