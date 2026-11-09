import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { createGBufferMaterial } from '@/core/postfx/materials/GBufferMaterial'
import {
  CORNELL_ALBEDO,
  CORNELL_BOXES,
  CORNELL_LIGHT,
  HALF_X,
  HALF_Z,
  ROOM_X,
  ROOM_Y,
  ROOM_Z,
} from '@/core/gi/cornellData'

/**
 * Cornell Box —— 按 Cornell 官方测量数据程序化搭建（1:100 缩放）。
 *
 * 几何与材质数值**单一来源**：`src/core/gi/cornellData.ts`，
 * 渲染侧与离线烘焙 CLI 共用，避免「烘的是 A 场景、渲染的是 B 场景」。
 * 数据来源：https://bowers.cornell.edu/computer-graphics/data
 *
 * 坐标约定（与官方数据一致，未做镜像）：
 *   相机在 z 负半轴朝 +z 看，因此世界 +x 在画面左侧、-x 在画面右侧。
 *
 * 材质：MRT 下所有物体都必须写满 3 个 fragment output，
 * 因此统一用 GBufferMaterial（three 内建材质只写 1 个 out，会触发
 * GL_INVALID_OPERATION 且整次 draw 被丢弃）。
 */

/** 线性空间反照率：不能传 sRGB 十六进制（THREE.Color 会再做一次转换） */
function linear(r: number, g: number, b: number): THREE.Color {
  return new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace)
}

const WHITE = linear(...CORNELL_ALBEDO.white)
const GREEN = linear(...CORNELL_ALBEDO.green)
const RED = linear(...CORNELL_ALBEDO.red)
const LIGHT = linear(...CORNELL_ALBEDO.light)

const SHORT_BLOCK = CORNELL_BOXES[0]
const TALL_BLOCK = CORNELL_BOXES[1]

export function CornellBox() {
  const materials = useMemo(
    () => ({
      white: createGBufferMaterial({ color: WHITE, roughness: 0.95, metalness: 0 }),
      green: createGBufferMaterial({ color: GREEN, roughness: 0.95, metalness: 0 }),
      red: createGBufferMaterial({ color: RED, roughness: 0.95, metalness: 0 }),
      // 顶灯面板：当前只有几何 + 高反照率；emission 由 GI 阶段在 cornellData.ts 定稿
      light: createGBufferMaterial({ color: LIGHT, roughness: 1, metalness: 0 }),
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

      {/* 顶灯：位置 / 尺寸来自 cornellData（与烘焙 CLI 同一份），向下偏移避免 z-fighting */}
      <mesh position={[...CORNELL_LIGHT.center]} rotation-x={Math.PI / 2}>
        <planeGeometry args={[CORNELL_LIGHT.half[0] * 2, CORNELL_LIGHT.half[2] * 2]} />
        <primitive object={materials.light} attach="material" />
      </mesh>

      {/* 短块 / 高块：中心、尺寸、倾角来自 cornellData（与烘焙 CLI 的 OBB 同一份） */}
      <mesh
        position={[...SHORT_BLOCK.center]}
        rotation-y={THREE.MathUtils.degToRad(SHORT_BLOCK.yawDeg)}
        castShadow
        receiveShadow
      >
        <boxGeometry
          args={[SHORT_BLOCK.half[0] * 2, SHORT_BLOCK.half[1] * 2, SHORT_BLOCK.half[2] * 2]}
        />
        <primitive object={materials.white} attach="material" />
      </mesh>

      <mesh
        position={[...TALL_BLOCK.center]}
        rotation-y={THREE.MathUtils.degToRad(TALL_BLOCK.yawDeg)}
        castShadow
        receiveShadow
      >
        <boxGeometry
          args={[TALL_BLOCK.half[0] * 2, TALL_BLOCK.half[1] * 2, TALL_BLOCK.half[2] * 2]}
        />
        <primitive object={materials.white} attach="material" />
      </mesh>
    </group>
  )
}
