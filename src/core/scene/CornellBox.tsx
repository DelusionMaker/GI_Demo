import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { createGBufferMaterial } from '@/core/postfx/materials/GBufferMaterial'

/**
 * Cornell Box —— 按 Cornell 官方测量数据程序化搭建（1:100 缩放）。
 *
 * 数据来源：https://bowers.cornell.edu/computer-graphics/data
 * - 房间：552.8 × 548.8 × 559.2（x × y × z），前方（z = 0）开口
 * - 短块：约 165³，底面中心 (185.5, 0, 169.0)
 * - 高块：约 165 × 330 × 165，底面中心 (368.5, 0, 351.25)
 * - 顶灯开口：x 213..343、z 227..332（本步只建几何，发光/面光源留给 GI 阶段）
 *
 * 坐标约定（与官方数据一致，未做镜像）：
 *   相机在 z 负半轴朝 +z 看，因此世界 +x 在画面左侧、-x 在画面右侧。
 *   官方红墙在 x = 552.8（画面左侧），绿墙在 x = 0（画面右侧），
 *   与经典 Cornell Box 照片的左右关系一致。
 *
 * 材质：MRT 下所有物体都必须写满 3 个 fragment output，
 * 因此统一用 GBufferMaterial（three 内建材质只写 1 个 out，会触发
 * GL_INVALID_OPERATION 且整次 draw 被丢弃）。
 */

/** 1 cm → 0.01 场景单位（房间约 5.5 单位宽，与现有相机/灯光尺度一致） */
const S = 0.01

const ROOM_X = 552.8 * S
const ROOM_Y = 548.8 * S
const ROOM_Z = 559.2 * S
const HALF_X = ROOM_X / 2
const HALF_Z = ROOM_Z / 2

/** 官方数据以 x ∈ [0, 552.8]、z ∈ [0, 559.2] 建模，这里平移到房间中心 */
const cx = (x: number) => (x - 276.4) * S
const cz = (z: number) => (z - 279.6) * S

/**
 * 线性空间反照率：shader 里 uBaseColor 直接当 albedo 用，
 * 不能传 sRGB 十六进制（THREE.Color 会再做一次 sRGB → 线性转换，画面会偏暗）。
 */
function linear(r: number, g: number, b: number): THREE.Color {
  return new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace)
}

/** 官方光谱折算到线性 RGB 的近似值（白 / 绿 / 红） */
const WHITE = linear(0.74, 0.74, 0.74)
const GREEN = linear(0.12, 0.45, 0.15)
const RED = linear(0.63, 0.065, 0.05)

export function CornellBox() {
  const materials = useMemo(
    () => ({
      white: createGBufferMaterial({ color: WHITE, roughness: 0.95, metalness: 0 }),
      green: createGBufferMaterial({ color: GREEN, roughness: 0.95, metalness: 0 }),
      red: createGBufferMaterial({ color: RED, roughness: 0.95, metalness: 0 }),
      // 顶灯面板：当前只有几何 + 高反照率，发光/面光源在 GI 阶段实现
      light: createGBufferMaterial({ color: linear(1, 1, 1), roughness: 1, metalness: 0 }),
    }),
    [],
  )

  // 切换场景时释放材质；MRT 材质不做 dispose 会在反复切换中泄漏 GPU 资源
  useEffect(() => {
    return () => {
      Object.values(materials).forEach((material) => material.dispose())
    }
  }, [materials])

  return (
    <group>
      {/* 地板（官方 y = 0，法线 +y） */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[ROOM_X, ROOM_Z]} />
        <primitive object={materials.white} attach="material" />
      </mesh>

      {/* 天花板（官方 y = 548.8，法线 -y） */}
      <mesh position={[0, ROOM_Y, 0]} rotation-x={Math.PI / 2} receiveShadow>
        <planeGeometry args={[ROOM_X, ROOM_Z]} />
        <primitive object={materials.white} attach="material" />
      </mesh>

      {/* 后墙（官方 z = 559.2，法线 -z，朝向相机） */}
      <mesh position={[0, ROOM_Y / 2, HALF_Z]} rotation-y={Math.PI} receiveShadow>
        <planeGeometry args={[ROOM_X, ROOM_Y]} />
        <primitive object={materials.white} attach="material" />
      </mesh>

      {/* 绿墙（官方 x = 0，世界 -x，相机朝 +z 看时位于画面右侧；法线 +x 朝内） */}
      <mesh position={[-HALF_X, ROOM_Y / 2, 0]} rotation-y={Math.PI / 2} receiveShadow>
        <planeGeometry args={[ROOM_Z, ROOM_Y]} />
        <primitive object={materials.green} attach="material" />
      </mesh>

      {/* 红墙（官方 x = 552.8，世界 +x，画面左侧；法线 -x 朝内） */}
      <mesh position={[HALF_X, ROOM_Y / 2, 0]} rotation-y={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[ROOM_Z, ROOM_Y]} />
        <primitive object={materials.red} attach="material" />
      </mesh>

      {/* 顶灯开口：与天花板共面会 z-fighting，向下偏移 0.004 */}
      <mesh position={[cx(278), ROOM_Y - 0.004, cz(279.5)]} rotation-x={Math.PI / 2}>
        <planeGeometry args={[130 * S, 105 * S]} />
        <primitive object={materials.light} attach="material" />
      </mesh>

      {/* 短块：底面中心 (185.5, 169.0)，实测约绕 y 轴 -16.6°；画面右侧、靠绿墙 */}
      <mesh
        position={[cx(185.5), 82.5 * S, cz(169.0)]}
        rotation-y={THREE.MathUtils.degToRad(-16.6)}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[1.65, 1.65, 1.65]} />
        <primitive object={materials.white} attach="material" />
      </mesh>

      {/* 高块：底面中心 (368.5, 351.25)，实测约绕 y 轴 +17.0°；画面左侧、靠红墙 */}
      <mesh
        position={[cx(368.5), 165 * S, cz(351.25)]}
        rotation-y={THREE.MathUtils.degToRad(17.0)}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[1.65, 3.3, 1.65]} />
        <primitive object={materials.white} attach="material" />
      </mesh>
    </group>
  )
}
