// gbuffer_brdf.glsl —— 自写前向 BRDF（Cook-Torrance）
//
// 由 gbuffer.frag 经 #include 拼入；本文件只含函数定义，不声明 uniform / precision / out
// （那些只存在于编排器 gbuffer.frag，避免重复声明）。
// 依赖编排器声明的常量 PI 与各 uniform（uLightColor 等由 main 传入）。

// 法线分布函数：GGX
float distributionGGX(float NoH, float rough) {
  rough = max(rough, 1e-3); // 防止 roughness=0 时 a2=0 把高光直接抹成 0（理想镜面的 delta 退化）
  float a = rough * rough; // 通过二次方映射让高光衰减对粗糙度变化更敏感，避免美术调整时高光形态失控。
  float a2 = a * a;
  float d = (NoH * NoH) * (a2 - 1.0) + 1.0;
  return a2 / max((PI * d * d), 1e-7);
}

// 几何遮蔽：Smith（直接光 k 用 Disney remap）
float geometrySmith(float NoV, float NoL, float rough) {
  float r = rough + 1.0;
  float k = (r * r) / 8.0;
  float gv = NoV / (NoV * (1.0 - k) + k);
  float gl = NoL / (NoL * (1.0 - k) + k);
  return gv * gl;
}

// 菲涅尔：Schlick
vec3 fresnelSchlick(float cosT, vec3 F0) {
  return F0 + (1.0 - F0) * pow(clamp(1.0 - cosT, 0.0, 1.0), 5.0);
}

// Karis 的 EnvBRDFApprox 解析
vec3 envBRDFApprox(vec3 F0, float NoV, float roughness) {
  // Karis 2013, UE4 用的同款标量近似，返回 F0*AB.x + AB.y
  vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
  vec4 c1 = vec4( 1.0,  0.0425, 1.04, -0.04);
  vec4 r = roughness * c0 + c1;
  float a004 = min(r.x * r.x, exp2(-9.28 * NoV)) * r.x + r.y;
  vec2 AB = vec2(-1.04, 1.04) * a004 + r.zw;
  return F0 * AB.x + AB.y; // 注意 AB.y 不带 F0，对应 F90=1 的 Fresnel
}
