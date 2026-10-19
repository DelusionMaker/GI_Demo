export type SceneId = 'cornell' | 'indoor' | 'outdoor'

export interface SceneEntry {
  id: SceneId
  name: string
  /**
   * GLTF 路径（Draco / meshopt 压缩）。
   * - 有值：加载 GLTF（户外为 LittlestTokyo）；
   * - null：cornell 走 `CornellBox` 程序化参考场景；其余回落到占位场景，
   *   保证在资产就绪前所有 demo 都能跑通。
   */
  url: string | null
  /**
   * IBL 环境贴图（equirectangular HDR）。
   * - 有值：`GBufferEnvironment` 用 RGBELoader → 带 mip 的立方体贴图；
   * - null：使用 `RoomEnvironment` 程序化环境（Cornell / 室内占位）。
   */
  envUrl: string | null
  /** 占位场景的色调，仅用于区分三个场景 */
  tint: string
  note: string
}

export const SCENES: Record<SceneId, SceneEntry> = {
  cornell: {
    id: 'cornell',
    name: 'Cornell Box',
    url: null,
    envUrl: null,
    tint: '#c8c0b2',
    note: '按 Cornell 官方测量尺寸程序化搭建（1:100），GI 收敛 / 能量守恒 / 白炉测试的参考场景',
  },
  indoor: {
    id: 'indoor',
    name: '室内',
    url: null,
    envUrl: null,
    tint: '#b39d86',
    note: '多光源 + 遮挡，验证阴影、接触阴影与间接光（Sponza 贴图管线待补）',
  },
  outdoor: {
    id: 'outdoor',
    name: '户外',
    url: '/assets/littlest-tokyo.glb',
    envUrl: '/hdr/kloppenheim_06_puresky_1k.hdr',
    tint: '#8ea8c2',
    note: 'Poly Haven CC0 HDRI（kloppenheim_06_puresky）+ LittlestTokyo（CC BY 4.0）；简单体块做 IBL 对照',
  },
}

export const SCENE_IDS = Object.keys(SCENES) as SceneId[]
