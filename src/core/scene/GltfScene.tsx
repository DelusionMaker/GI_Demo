import { useGLTF } from '@react-three/drei'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { createGBufferMaterial } from '@/core/postfx/materials/GBufferMaterial'

const ORIGIN: [number, number, number] = [0, 0, 0]

export interface GltfSceneProps {
  url: string
  /** 把模型最长边缩放到该场景单位；不传则保留 GLTF 原始尺度 */
  fit?: number
  /** 归一化后的落地点（模型底面中心在 y=0），默认原点 */
  position?: [number, number, number]
}

/**
 * GLTF 资产加载 + MRT 材质替换。
 *
 * 两件事必须在进 MRT 前做掉：
 * 1. GLTF 自带的 `meshStandardMaterial` 只写 1 个 fragment output，在 3 附件 MRT 下
 *    会触发 GL_INVALID_OPERATION 且整个 draw 被丢弃 → 必须 traverse 替换成
 *    `GBufferMaterial`；
 * 2. 蒙皮模型（LittlestTokyo 有 1 个 skin）不能用 `Object3D.clone()`，否则骨骼
 *    引用会指回原场景 → 用 `SkeletonUtils.clone()`。
 *
 * 本步只接 baseColor 贴图 / side / alphaTest；normal map、metallicRoughness、
 * emissive 与透明混合留到 Sponza / 后续材质步（LittlestTokyo 本身没有 MR/normal 贴图）。
 */
export function GltfScene({ url, fit, position = ORIGIN }: GltfSceneProps) {
  // 第二个参数直接给 DRACOLoader 解码器路径（public/draco，来自 three 官方示例）
  const gltf = useGLTF(url, '/draco/')

  const { root, materials } = useMemo(() => {
    const root = cloneSkeleton(gltf.scene)
    const cache = new Map<THREE.Material, THREE.RawShaderMaterial>()
    const created: THREE.RawShaderMaterial[] = []

    const convert = (source: THREE.Material): THREE.RawShaderMaterial => {
      const cached = cache.get(source)
      if (cached) return cached

      const standard = source as THREE.MeshStandardMaterial
      const isStandard = standard.isMeshStandardMaterial === true
      const transparent = source.transparent === true
      const alphaTest =
        isStandard && standard.alphaTest > 0
          ? standard.alphaTest
          : transparent
            ? // BLEND 在 MRT 下不做硬件混合（会污染 gNormal/gMRAO），
              // 只丢掉全透明像素，避免玻璃片变成实心矩形
              0.1
            : 0

      const material = createGBufferMaterial({
        color: isStandard && standard.color ? standard.color : '#ffffff',
        roughness: isStandard ? (standard.roughness ?? 1) : 0.9,
        metalness: isStandard ? (standard.metalness ?? 0) : 0,
        map: isStandard ? (standard.map ?? null) : null,
        alphaTest,
        side: source.side,
      })
      material.name = `GBufferMaterial:${source.name || 'gltf'}`
      cache.set(source, material)
      created.push(material)
      return material
    }

    root.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map(convert)
      } else if (mesh.material) {
        mesh.material = convert(mesh.material)
      }
      // p1-shadow：ShadowMapPass 用 castShadow 标记筛选投影物；
      // 资产默认两者都开（地面/天空球在各自场景里单独控制）。
      mesh.castShadow = true
      mesh.receiveShadow = true
    })

    if (fit) {
      // 动画先不播放：用 bind pose 的包围盒做归一化，保证场景布局可复现。
      root.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(root)
      const size = box.getSize(new THREE.Vector3())
      const maxDimension = Math.max(size.x, size.y, size.z)
      if (maxDimension > 1e-6) {
        root.scale.setScalar(fit / maxDimension)
        root.updateMatrixWorld(true)
        const fittedBox = new THREE.Box3().setFromObject(root)
        const center = fittedBox.getCenter(new THREE.Vector3())
        root.position.x -= center.x
        root.position.z -= center.z
        root.position.y -= fittedBox.min.y
      }
    }

    root.position.x += position[0]
    root.position.y += position[1]
    root.position.z += position[2]

    return { root, materials: created }
  }, [gltf.scene, fit, position])

  useEffect(() => {
    return () => {
      materials.forEach((material) => material.dispose())
    }
  }, [materials])

  return <primitive object={root} />
}
