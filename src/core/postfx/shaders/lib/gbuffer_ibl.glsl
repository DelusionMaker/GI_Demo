// gbuffer_ibl.glsl —— 自写 IBL（split-sum 环境光照）
//
// 由 gbuffer.frag 经 #include 拼入；只含函数定义，不声明 uniform / precision / out。
// 依赖编排器声明的常量 ENV_MAX_LOD / IBL_DIFFUSE_LOD 与 uniform uEnvMap / uHasEnv / uFurnace。

// ==========================================================================
// IBL（split-sum 环境光照）—— 已实现（2026-10-19）
//
// 实现要点：
//   1) 漫反射：irradiance(N) 用高 LOD 采样近似；能量上乘
//      kD = (1-F)(1-metalness)，与直接光同一套能量分配；
//   2) 镜面：R = reflect(-V, N)，按 roughness 映射 LOD 采样预滤波环境；
//      再乘 split-sum 的 DFG 项（Karis EnvBRDFApprox，F0 * brdf.x + brdf.y）；
//   3) 白炉（uFurnace == 1）：环境采样替换为 vec3(1.0)，直接光由 main 置零；
//      单次散射 GGX 在 roughness→1 会损失多次散射能量而偏暗，属已知取舍；
//   4) uHasEnv == 0 时返回 vec3(0.0)，由 main 的占位环境项兜底；
//   5) 采样约定：uEnvMap 是世界空间方向的立方体贴图，最大 LOD 由尺寸决定（当前 256 → 8）。
// ==========================================================================
vec3 iblDiffuse(vec3 N, vec3 F0, vec3 albedo, float metalness) {
  if (uHasEnv == 0) return vec3(0.0);
  // irradiance ≈ 取很高 LOD（接近均匀）的环境采样
  vec3 irradiance = (uFurnace == 1) ? vec3(1.0) : textureLod(uEnvMap, N, IBL_DIFFUSE_LOD).rgb;
  vec3 kD = (vec3(1.0) - F0) * (1.0 - metalness); // 能量守恒：金属无漫反射
  // 高 LOD 的盒式 mip 给出的是「平均 radiance」，不是 cosine-weighted irradiance。
  // 对常数环境，irradiance = π × radiance；这里补 π，正好与漫反射 BRDF 的 1/π 抵消。
  // 这样白炉（环境 = 1、albedo = 1）的漫反射输出 ≈ kD，而不是 kD/π。
  return irradiance * kD * albedo;
}

vec3 iblSpecular(vec3 N, vec3 V, vec3 F0, float roughness) {
  if (uHasEnv == 0) return vec3(0.0);
  vec3 R = reflect(-V, N); // reflect 用于计算入射向量的镜面反射方向

  // 1. 采样预过滤环境贴图 (Part 1)
  // roughness → LOD：越粗糙越取更模糊的 mip；这是调参旋钮
  float lod = clamp(roughness * ENV_MAX_LOD, 0.0, ENV_MAX_LOD);
  vec3 prefiltered = (uFurnace == 1) ? vec3(1.0) : textureLod(uEnvMap, R, lod).rgb; // 白炉：环境视为纯白

  // 2. DFG
  vec3 dfg = envBRDFApprox(F0, max(dot(N, V), 1e-4), roughness);

  return prefiltered * dfg;
}
