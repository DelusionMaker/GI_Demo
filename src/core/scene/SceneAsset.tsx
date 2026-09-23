import { useGLTF } from '@react-three/drei'
import { Suspense } from 'react'
import { SCENES, type SceneId } from './scenes'

/**
 * 统一场景加载入口（文档「共享基础设施」要求：统一的场景加载器）。
 * 资产未就绪时（url === null）回落到程序化占位场景，保证 demo 可运行。
 */
export function SceneAsset({ id }: { id: SceneId }) {
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
  return <primitive object={gltf.scene} />
}

/**
 * 程序化占位场景：一个开放房间 + 一个球 + 一个方盒。
 * 刻意不加顶，方便从外部机位观察；材质走 three 内置 PBR，
 * 自写 BRDF 在 p1-pbr-ibl 落地后替换。
 */
function PlaceholderScene({ tint }: { tint: string }) {
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[16, 16]} />
        <meshStandardMaterial color="#2b303a" roughness={0.95} metalness={0} />
      </mesh>

      <mesh position={[0, 2, -4]} receiveShadow>
        <planeGeometry args={[16, 4]} />
        <meshStandardMaterial color={tint} roughness={0.9} metalness={0} />
      </mesh>

      <mesh position={[-1.6, 0.75, 0]} castShadow receiveShadow>
        <sphereGeometry args={[0.75, 48, 32]} />
        <meshStandardMaterial color="#dfe6f0" roughness={0.35} metalness={0.05} />
      </mesh>

      <mesh position={[1.6, 0.5, 0.6]} rotation-y={0.6} castShadow receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#e0a06a" roughness={0.6} metalness={0} />
      </mesh>
    </group>
  )
}
