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
export const gbufferShared = {
  /** 主平行光：指向光源的单位向量（世界空间，与 gbuffer.frag 的 L 同语义） */
  uLightDir: { value: new THREE.Vector3(0.5, 0.8, 0.4).normalize() },
  /** 主平行光颜色 × 强度 */
  uLightColor: { value: new THREE.Color(1, 1, 1).multiplyScalar(3) },
  /** 环境兜底项（IBL 未启用时）：颜色 × 强度 */
  uAmbient: { value: new THREE.Color(1, 1, 1).multiplyScalar(0.03) },

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
