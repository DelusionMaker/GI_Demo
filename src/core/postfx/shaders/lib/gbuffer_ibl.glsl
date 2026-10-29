// gbuffer_ibl.glsl —— 自写 IBL（split-sum 环境光照）
//
// 由 gbuffer.frag 经 #include 拼入；只含函数定义，不声明 uniform / precision / out。
// 依赖编排器声明的 uniform uEnvMaxLod / uEnvMap / uHasEnv / uFurnace。

// ==========================================================================
// IBL（split-sum 环境光照）—— 已实现（2026-10-19）
//
// 实现要点：
//   1) 漫反射：取「最大 LOD 往下 2.5 级」的分数 LOD 采样近似 irradiance；
//      能量上乘 kD = (1-F0)(1-metalness)（Fresnel 已积分进镜面的 DFG 项）；
//   2) 镜面：R = reflect(-V, N)，按 roughness 映射 LOD 采样预滤波环境；
//      再乘 split-sum 的 DFG 项（Karis EnvBRDFApprox，F0 * brdf.x + brdf.y）；
//   3) 白炉（uFurnace == 1）：环境采样替换为 vec3(1.0)，直接光由 main 置零；
//      单次散射 GGX 在 roughness→1 会损失多次散射能量而偏暗，属已知取舍；
//   4) uHasEnv == 0 时返回 vec3(0.0)，由 main 的占位环境项兜底；
//   5) 采样约定：uEnvMap 是世界空间方向的立方体贴图，最大 LOD 由 uEnvMaxLod 给出
//      （GBufferEnvironment 按 cube 边长写入，当前 256 → 8）。
// ==========================================================================
vec3 iblDiffuse(vec3 N, vec3 F0, vec3 albedo, float metalness) {
  if (uHasEnv == 0) return vec3(0.0);
  // irradiance 近似：取「最大 LOD 往下 2.5 级」的分数 LOD。
  // 必须是分数：整数 LOD 的 frac 为 0，三线性会退化成单级双线性；
  // 而 2×2/面（LOD 7）这种粗级只有 24 个独立纹素，漫反射会在 cube 面之间块状过渡。
  float diffuseLod = max(uEnvMaxLod - 2.5, 0.0);
  // 这里拿到的不是 irradiance 本身，而是「平均 radiance」（≈ E/π）。
  vec3 irradianceOverPi = (uFurnace == 1) ? vec3(1.0) : textureLod(uEnvMap, N, diffuseLod).rgb;
  // kD = (1 - F0)(1 - metalness)。Fresnel 用 F0 近似而非 F(NoV)：
  // DFG 已经把宽 GGX lobe 的 Fresnel 积分平均掉了，若换成 F(NoV)，
  // 粗糙表面在掠射角会严重欠能（白炉测试会明显变暗）。
  vec3 kD = (vec3(1.0) - F0) * (1.0 - metalness); // 金属无漫反射
  // 常数环境下 E = π·L_avg，漫反射 BRDF 自带 1/π，两者恰好抵消，
  // 故最终直接为 L_avg · albedo · kD（无需再显式补 π）。
  return irradianceOverPi * kD * albedo;
}

vec3 iblSpecular(vec3 N, vec3 V, vec3 F0, float roughness) {
  if (uHasEnv == 0) return vec3(0.0);
  roughness = clamp(roughness, 0.0, 1.0);

  vec3 R = reflect(-V, N); // reflect 用于计算入射向量的镜面反射方向
  // 掠射 + 粗糙时 R 会贴近切线甚至指向法线背面，采到与当前半球无关的环境（错位反射）。
  // 按 roughness² 把 R 向 N 收拢，与 three 的 getIBLRadiance 同款处理。
  R = normalize(mix(R, N, roughness * roughness));

  // 1. 采样预过滤环境贴图 (Part 1)
  // roughness → LOD：越粗糙越取更模糊的 mip。
  // 注意这是经验映射（环境是 box-filter mip，不是 GGX 重要性采样预滤波），属已知近似。
  float lod = clamp(roughness * uEnvMaxLod, 0.0, uEnvMaxLod);
  vec3 prefiltered = (uFurnace == 1) ? vec3(1.0) : textureLod(uEnvMap, R, lod).rgb; // 白炉：环境视为纯白

  // 2. DFG（split-sum 的 LUT 参数是 NoV，不是 NoR）
  vec3 dfg = envBRDFApprox(F0, max(dot(N, V), 1e-4), roughness);

  return prefiltered * dfg;
}
