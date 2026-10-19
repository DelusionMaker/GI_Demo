import { useGLTF } from '@react-three/drei'
import { Suspense, useMemo } from 'react'
import { createGBufferMaterial } from '@/core/postfx/materials/GBufferMaterial'
import { CornellBox } from './CornellBox'
import { SCENES, type SceneId } from './scenes'

/**
 * 统一场景加载入口（文档「共享基础设施」要求：统一的场景加载器）。
 * 资产未就绪时（url === null）回落到程序化占位场景，保证 demo 可运行。
 *
 * cornell 是「按官方尺寸程序化的参考场景」，不是 GLTF 资产：
 * 它有精确的几何与反照率，用于 GI 收敛 / 白炉测试，也不受贴图/材质管线阻塞。
 */
export function SceneAsset({ id }: { id: SceneId }) {
  if (id === 'cornell') return <CornellBox />
  const entry = SCENES[id]
  if (!entry.url) return <PlaceholderScene tint={entry.tint} />
  return (
    <Suspense fallback={<PlaceholderScene tint={entry.tint} />}>
      <GltfScene url={entry.url} />
    </Suspense>
  )
}

function GltfScene({ url }: { url: string }) {
  // 第二个参数开启 Draco 解压；p0-assets 阶段需把解码器放进 public/draco 并调用 useGLTF.setDecoderPath
  const gltf = useGLTF(url, true)
  // TODO(p0-assets): GLTF 自带 meshStandardMaterial 只写 1 个 fragment output，
  // 在 MRT 下会触发 GL_INVALID_OPERATION 且 draw 被丢弃——接入真实资产时需
  // traverse 场景把材质替换为 GBufferMaterial（保留 color/roughness/metalness 参数）。
  return <primitive object={gltf.scene} />
}

/**
 * 程序化占位场景：一个开放房间 + 一个球 + 一个方盒。
 * 刻意不加顶，方便从外部机位观察；材质统一用 GBufferMaterial——
 * MRT 下帧缓冲有 3 个活动 draw buffer，three 内建材质只写 1 个 output 会触发
 * GL_INVALID_OPERATION 且该 draw 被丢弃（整帧场景直接消失）。
 * 着色由 gbuffer.frag 的前向 Cook-Torrance 负责（硬编码主光 + 占位环境项，
 * 接收阴影暂缺，属 S2 已知取舍）。
 */
function PlaceholderScene({ tint }: { tint: string }) {
  const ground = useMemo(
    () => createGBufferMaterial({ color: '#2b303a', roughness: 0.95, metalness: 0 }),
    [],
  )
  const wall = useMemo(() => createGBufferMaterial({ color: tint, roughness: 0.9, metalness: 0 }), [tint])
  const sphere = useMemo(
    () => createGBufferMaterial({ color: '#dfe6f0', roughness: 0.35, metalness: 0.05 }),
    [],
  )
  const box = useMemo(() => createGBufferMaterial({ color: '#e0a06a', roughness: 0.6, metalness: 0 }), [])

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[16, 16]} />
        <primitive object={ground} attach="material" />
      </mesh>

      <mesh position={[0, 2, -4]} receiveShadow>
        <planeGeometry args={[16, 4]} />
        <primitive object={wall} attach="material" />
      </mesh>

      <mesh position={[-1.6, 0.75, 0]} castShadow receiveShadow>
        <sphereGeometry args={[0.75, 48, 32]} />
        <primitive object={sphere} attach="material" />
      </mesh>

      <mesh position={[1.6, 0.5, 0.6]} rotation-y={0.6} castShadow receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <primitive object={box} attach="material" />
      </mesh>
    </group>
  )
}
