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
  /** 环境强度倍率（demo 滑杆） */
  uEnvIntensity: { value: 1 },
  /** 1 = 环境贴图就绪且开关打开（此时走 IBL 算法段；0 = 占位环境项兜底） */
  uHasEnv: { value: 0 },
  /** 1 = 白炉测试：环境视为纯白、直接光关闭（能量守恒验证） */
  uFurnace: { value: 0 },
}
