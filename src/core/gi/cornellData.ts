/**
 * Cornell Box 的**唯一数据来源**：渲染侧（CornellBox.tsx）与离线烘焙 CLI 共用。
 *
 * 为什么必须抽出来：原先几何常量与材质颜色都藏在 R3F 组件里（React + three），
 * Node CLI 无法 import；若在 CLI 里另抄一份，烘的是 A 场景、渲染的是 B 场景，
 * S0 定的「高 spp 自对照」正确性判据直接失效。
 *
 * 数据来源：https://bowers.cornell.edu/computer-graphics/data （1:100 缩放）
 * 坐标约定：官方 x ∈ [0,552.8] / z ∈ [0,559.2]，这里平移到房间中心；未做镜像。
 *
 * 硬约束：纯数字，不 import three / React / DOM（Node CLI 直接加载）。
 */

import type { Vec3 } from './bakeTypes.ts'

/** 1 cm → 0.01 场景单位 */
export const S = 0.01

export const ROOM_X = 552.8 * S
export const ROOM_Y = 548.8 * S
export const ROOM_Z = 559.2 * S
export const HALF_X = ROOM_X / 2
export const HALF_Z = ROOM_Z / 2

export const cx = (x: number): number => (x - 276.4) * S
export const cz = (z: number): number => (z - 279.6) * S

/** 线性空间反照率（shader 里 uBaseColor 直接当线性 albedo 用，不能再做 sRGB→线性） */
export const CORNELL_ALBEDO = {
  white: [0.74, 0.74, 0.74],
  green: [0.12, 0.45, 0.15],
  red: [0.63, 0.065, 0.05],
  light: [1, 1, 1],
} as const satisfies Record<string, Vec3>

/**
 * 顶灯：渲染侧目前只有几何 + 高反照率，**不发光**（CornellBox.tsx 原注释即如此）。
 *
 * TODO(作品集 · 你来定)：`emission` 是 S1 烘焙的第一道前提 —— 它是发光面还是
 * 点光近似、发射值取多少、是否与 shader 侧的 emissive 保持同一量纲。
 * 骨架阶段保留 [0,0,0]，CLI 会据此提示「顶灯发射值未定，烘焙不会有间接光」，
 * 避免产出一个看似跑通实则全黑的假结果。
 */
export const CORNELL_LIGHT = {
  center: [cx(278), ROOM_Y - 0.004, cz(279.5)] as Vec3,
  /** 渲染侧 planeGeometry args=[130*S, 105*S] 的半尺寸；y 极薄代表水平面 */
  half: [65 * S, 0.001, 52.5 * S] as Vec3,
  albedo: CORNELL_ALBEDO.light,
  emission: [0, 0, 0] as Vec3,
  name: 'ceiling-light',
}

/** 轴对齐薄板（墙 / 地板 / 天花板 / 顶灯）与绕 y 旋转的盒子，统一用 OBB 表达 */
export interface CornellSurface {
  name: string
  center: Vec3
  half: Vec3
  /** 绕 y 轴旋转，单位度；与渲染侧 rotation-y 一致 */
  yawDeg: number
  albedo: Vec3
  emission: Vec3
}

const thin = 0.001

export const CORNELL_BOXES: readonly CornellSurface[] = [
  {
    name: 'short-block',
    center: [cx(185.5), 82.5 * S, cz(169.0)],
    half: [1.65 / 2, 1.65 / 2, 1.65 / 2],
    yawDeg: -16.6,
    albedo: CORNELL_ALBEDO.white,
    emission: [0, 0, 0],
  },
  {
    name: 'tall-block',
    center: [cx(368.5), 165 * S, cz(351.25)],
    half: [1.65 / 2, 3.3 / 2, 1.65 / 2],
    yawDeg: 17.0,
    albedo: CORNELL_ALBEDO.white,
    emission: [0, 0, 0],
  },
]

export const CORNELL_SURFACES: readonly CornellSurface[] = [
  {
    name: 'floor',
    center: [0, 0, 0],
    half: [HALF_X, thin, HALF_Z],
    yawDeg: 0,
    albedo: CORNELL_ALBEDO.white,
    emission: [0, 0, 0],
  },
  {
    name: 'ceiling',
    center: [0, ROOM_Y, 0],
    half: [HALF_X, thin, HALF_Z],
    yawDeg: 0,
    albedo: CORNELL_ALBEDO.white,
    emission: [0, 0, 0],
  },
  {
    name: 'back-wall',
    center: [0, ROOM_Y / 2, HALF_Z],
    half: [HALF_X, ROOM_Y / 2, thin],
    yawDeg: 0,
    albedo: CORNELL_ALBEDO.white,
    emission: [0, 0, 0],
  },
  {
    name: 'green-wall',
    center: [-HALF_X, ROOM_Y / 2, 0],
    half: [thin, ROOM_Y / 2, HALF_Z],
    yawDeg: 0,
    albedo: CORNELL_ALBEDO.green,
    emission: [0, 0, 0],
  },
  {
    name: 'red-wall',
    center: [HALF_X, ROOM_Y / 2, 0],
    half: [thin, ROOM_Y / 2, HALF_Z],
    yawDeg: 0,
    albedo: CORNELL_ALBEDO.red,
    emission: [0, 0, 0],
  },
  {
    name: CORNELL_LIGHT.name,
    center: CORNELL_LIGHT.center,
    half: CORNELL_LIGHT.half,
    yawDeg: 0,
    albedo: CORNELL_LIGHT.albedo,
    emission: CORNELL_LIGHT.emission,
  },
  ...CORNELL_BOXES,
]
