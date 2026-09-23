export type SceneId = 'cornell' | 'indoor' | 'outdoor'

export interface SceneEntry {
  id: SceneId
  name: string
  /**
   * GLTF 路径（Draco / meshopt 压缩）。
   * TODO(p0-assets): 填入真实资产；为 null 时回落到程序化占位场景，
   * 保证在资产就绪前所有 demo 都能跑通。
   */
  url: string | null
  /** 占位场景的色调，仅用于区分三个场景 */
  tint: string
  note: string
}

export const SCENES: Record<SceneId, SceneEntry> = {
  cornell: {
    id: 'cornell',
    name: 'Cornell Box',
    url: null,
    tint: '#c8c0b2',
    note: 'GI 收敛、能量守恒与白炉测试的参考场景',
  },
  indoor: {
    id: 'indoor',
    name: '室内',
    url: null,
    tint: '#b39d86',
    note: '多光源 + 遮挡，验证阴影、接触阴影与间接光',
  },
  outdoor: {
    id: 'outdoor',
    name: '户外',
    url: null,
    tint: '#8ea8c2',
    note: 'HDR 环境光与 IBL 主场景',
  },
}

export const SCENE_IDS = Object.keys(SCENES) as SceneId[]
