import * as THREE from 'three'

/**
 * GBufferMaterial 的**全局共享 uniform**（灯光 / 环境 / 白炉）。
 *
 * 为什么共享：场景里每个 mesh 各自持有材质实例，但灯光与环境是「一份场景状态」。
 * 这里让所有材质挂同一批 uniform 对象引用，外部只改这一份值，所有材质同时生效——
 * 避免「每个材质一份拷贝 + 到处写同步逻辑」。
 *
 * 数据流向（单向）：
 *   场景真实灯光 ──GBufferLightSync──► gbufferShared.uLight*
 *   RoomEnvironment ──GBufferEnvironment──► gbufferShared.uEnvMap
 *   demo 旋钮 ──<GBufferParamSync>──► uHasEnv / uEnvIntensity / uFurnace
 *   以上全部 ──► gbuffer.frag（p1 自写 IBL 算法段读取）
 */
/** 多光源数组容量（必须与 gbuffer.frag 的 MAX_LIGHTS 一致）。p1-light-ssr S1 用 uniform 数组承载，S2/S3 Clustered 改走数据纹理后可下调。 */
export const MAX_LIGHTS = 64

/** 新建一张存 cluster 灯列表用的 RGBA32F 数据纹理（Nearest 过滤，无需线性过滤 float 扩展） */
function makeClusterTexture(): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType)
  tex.minFilter = THREE.NearestFilter
  tex.magFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  return tex
}

export const gbufferShared = {
  /** 主平行光：指向光源的单位向量（世界空间，与 gbuffer.frag 的 L 同语义） */
  uLightDir: { value: new THREE.Vector3(0.5, 0.8, 0.4).normalize() },
  /** 主平行光颜色 × 强度 */
  uLightColor: { value: new THREE.Color(1, 1, 1).multiplyScalar(3) },
  /** 环境兜底项（IBL 未启用时）：颜色 × 强度 */
  uAmbient: { value: new THREE.Color(1, 1, 1).multiplyScalar(0.03) },

  // ── 多光源（p1-light-ssr S1：暴力前向；S2/S3 Clustered 改走数据纹理取代本数组）──
  /** 活跃光源数量（GBufferLightSync 每帧填充；0 = 退化到仅环境/IBL） */
  uLightCount: { value: 0 },
  /** 主平行光（阴影投射光）在 uLightData* 数组中的索引；-1 = 无阴影光 */
  uShadowLightIndex: { value: -1 },
  /** 每盏灯：xyz = 世界位置，w = range（0 = 无限远，平行光用） */
  uLightData0: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4()) },
  /** 每盏灯：rgb = 颜色 × 强度，w = 类型（0 平行光 / 1 点光 / 2 聚光） */
  uLightData1: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4()) },
  /** 每盏灯：xyz = 方向（平行光=指向光源；聚光=光锥轴 从灯出），w = cosInner（聚光内角） */
  uLightData2: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4()) },
  /** 每盏灯：x = cosOuter（聚光外角），yzw 预留 */
  uLightData3: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4()) },

  // ── Clustered 剔除（p1-light-ssr S2）：cluster 灯列表数据纹理 + 网格参数 ──
  /** 调试：cluster 可视化（0=关 / 1=tile 叠加 / 2=每 cluster 灯数热力），由 HDRDriver 每帧同步 */
  uClusterDebug: { value: 0 },
  /** 1 = 启用 Clustered 前向（替换 S1 暴力循环）；0 = 暴力前向（A/B 基线）。默认 0 保证现 demo 无回归；S3 接入 UI 旋钮 / URL 参数做 A/B 时改为可切换、默认 1 */
  uClustered: { value: 1 },
  /** cluster 网格尺寸：x=gridW, y=gridH, z=zSlices（GBufferLightSync 每帧填充） */
  uClusterDims: { value: new THREE.Vector3(1, 1, 1) },
  /** 相机近/远平面（算 slice 用） */
  uViewNear: { value: 0.1 },
  uViewFar: { value: 100 },
  /** per-cluster 灯列表：RGBA32F，每 cluster 存 (offset, count, 0, 0)；GBufferLightSync 每帧重建 */
  uClusterLightGrid: { value: makeClusterTexture() },
  /** 扁平全局灯号索引数组：RGBA32F，每槽 .r = 灯号；GBufferLightSync 每帧重建 */
  uClusterLightIndices: { value: makeClusterTexture() },

  /** 环境贴图：CubeCamera 捕获的立方体贴图（带 mipmap），世界空间方向直接采样 */
  uEnvMap: { value: null as THREE.Texture | null },
  /**
   * 天空背景：原始 equirect HDR（2D），只给 `SkyMaterial` 用。
   * IBL 仍走 256² cube + mip；天空保留 1K 原图，避免背景被 cube 分辨率拖糊。
   */
  uSkyMap: { value: null as THREE.Texture | null },
  /** 1 = equirect HDR 就绪（天空可见；与 IBL 开关解耦） */
  uHasSkyMap: { value: 0 },
  /** 环境强度倍率（demo 滑杆；同时作用于 IBL 与天空亮度） */
  uEnvIntensity: { value: 1 },
  /** 1 = 环境贴图就绪且开关打开（此时走 IBL 算法段；0 = 占位环境项兜底） */
  uHasEnv: { value: 0 },
  /** 1 = 白炉测试：环境视为纯白、直接光关闭（能量守恒验证） */
  uFurnace: { value: 0 },

  // ── 阴影（p1-shadow；ShadowMapPass 每帧写入）──
  /** 1 = 在 gbuffer.frag 里应用阴影（shadowFactor）；0 = 跳过（直接光不压暗） */
  uShadowEnabled: { value: 0 },
  /** 深度图集（DepthTexture，RGBA8 颜色附件不参与采样） */
  uShadowAtlas: { value: null as THREE.Texture | null },
  /**
   * 每级级联的 worldPos → 图集 UV + 深度矩阵（已含 tile 变换）。
   * 数组长度固定 4，未使用的槽位为上一帧残留，shader 用 uShadowCascadeCount 限界。
   */
  uShadowMatrices: {
    value: Array.from({ length: 4 }, () => new THREE.Matrix4()),
  },
  /** 各级级联的 view-space far（未使用的槽位填最后一个有效值） */
  uShadowSplits: { value: new THREE.Vector4(1, 1, 1, 1) },
  uShadowCascadeCount: { value: 0 },
  /** 图集布局（cols, rows），供调试视图画分块边框 */
  uShadowAtlasGrid: { value: new THREE.Vector2(1, 1) },
  /** 1 / 图集边长（UV 空间一个纹素） */
  uShadowTexelSize: { value: 1 / 2048 },
  uShadowAtlasSize: { value: 2048 },
  /** 0 = SM / 1 = PCF / 2 = PCSS，与 shadowTypes.ts 的 SHADOW_MODE_INDEX 一致 */
  uShadowMode: { value: 1 },
  /** 0 = none / 1 = constant / 2 = normal offset / 3 = slope，与 SHADOW_BIAS_INDEX 一致 */
  uShadowBiasMode: { value: 2 },
  uShadowBias: { value: 0.0008 },
  /** 斜率缩放系数（slope bias 模式，与 uShadowBias 解耦） */
  uShadowSlopeBias: { value: 0.002 },
  uShadowNormalBias: { value: 0.02 },
  uShadowPCFRadius: { value: 1.5 },
  /** PCSS 半影尺度（UV 空间近似；按光源世界尺寸 / 场景尺度调） */
  uShadowLightSize: { value: 0.03 },
  /** 阴影强度：1 = 全黑，0 = 不压暗 */
  uShadowStrength: { value: 1 },
  /** 1 = 调试：把 cascade 索引染成色块（gbuffer.frag 内分支） */
  uShadowDebugCascade: { value: 0 },
}
