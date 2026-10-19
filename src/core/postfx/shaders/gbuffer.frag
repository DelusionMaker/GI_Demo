// G-buffer 片元着色器（GLSL ES 3.00，RawShaderMaterial + GLSL3 加载）。
//
// 输出 3 个 MRT 附件（与 BeautyPass.target.mrt 顺序一致）：
//   location 0  gAlbedo  RGBA8   反照率（下游 HDR 链当 beauty）
//   location 1  gNormal  RGBA16F 法线（需精度，防 banding）
//   location 2  gMRAO    RGBA8   metallic / roughness / ao / emissive
//
// ⚠️ 这是 S2 脚手架：光照与编码均为最小可用实现，标记 TODO 处留给你实现。
//    关键待决策（你定）：管线走「前向」还是「延迟」——
//      - 前向：gAlbedo 应直接输出 PBR 最终着色（直接光 + IBL）；
//      - 延迟：gAlbedo 存 unlit albedo，光照交给后续 pass。

precision highp float;

uniform vec3 uBaseColor;
uniform float uRoughness;
uniform float uMetalness;
uniform vec3 cameraPosition;
uniform int uDebugNormals; // 调试视图：1 = gAlbedo 输出编码法线（见下方 main 内分支）

// ── 场景灯光（GBufferLightSync 每帧从真实灯光同步，见 gbufferShared.ts）──
uniform vec3 uLightDir;    // 指向光源的单位向量（世界空间）
uniform vec3 uLightColor;  // 颜色 × 强度
uniform vec3 uAmbient;     // 环境兜底（IBL 未启用时）：颜色 × 强度

// ── IBL（p1 算法段使用；GBufferEnvironment + demo 旋钮提供）──
uniform samplerCube tEnvMap; // CubeCamera 捕获的立方体贴图（带 mipmap，世界空间方向直接采样）
uniform float uEnvIntensity; // 环境强度倍率
uniform int uHasEnv;         // 1 = 环境贴图就绪且开关打开
uniform int uFurnace;        // 1 = 白炉测试：环境视为纯白、直接光关闭

in vec3 vWorldNormal;
in vec3 vWorldPos;
in vec2 vUv;

layout(location = 0) out vec4 gAlbedo;
layout(location = 1) out vec4 gNormal;
layout(location = 2) out vec4 gMRAO;

const float PI = 3.14159265359;
// 放在两个函数定义附近，或直接在 iblSpecular 内联
const float ENV_MAX_LOD = 8.0; // 256² cube → log2(256) = 8
// 漫反射 IBL 的 irradiance 近似 LOD：越高 = 环境越"抹平"，越接近 cosine-weighted irradiance 的廉价近似。
// 调参旋钮：环境高频细节越多越该调高；RoomEnvironment 这类平滑环境 7 即可。
const float IBL_DIFFUSE_LOD = ENV_MAX_LOD - 1.0;

// 法线分布函数：GGX
float distributionGGX(float NoH, float rough) {
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
  vec4 c1 = vec4( 1.0,  0.0425, 1.0425, -0.04);
  vec4 r = roughness * c0 + c1;
  float a004 = min(r.x * r.x, exp2(-9.28 * NoV)) * r.x + r.y;
  vec2 AB = vec2(-1.73296, 1.35963) * a004 + r.zw;
  return F0 * AB.x + AB.y; // 注意 AB.y 不带 F0，对应 F90=1 的 Fresnel
}

// ==========================================================================
// TODO(p1 · 你来写)：IBL（split-sum 环境光照）
//
// 目标：把 main 里的占位环境项换成真正的环境光照。自查点：
//   1) 漫反射：irradiance(N) 近似 —— 对 tEnvMap 取高 LOD（如最大 LOD - 2）即可；
//      能量上乘 kD = (1-F)(1-metalness)，与直接光同一套能量分配；
//   2) 镜面：R = reflect(-V, N)，按 roughness 映射 LOD 采样预滤波环境；
//      再乘 split-sum 的 DFG 项（可用 Karis 的 EnvBRDFApprox 解析近似，
//      或用 BRDF LUT；关键是 F0 * brdf.x + brdf.y）；
//   3) 白炉（uFurnace == 1）：环境采样替换为 vec3(1.0)，直接光由 main 置零；
//      正确实现下画面应接近均匀白——单次散射 GGX 在 roughness→1 会损失多次散射
//      能量而偏暗，属已知取舍，请把实测偏差写进 demo limitations；
//   4) uHasEnv == 0 时返回 vec3(0.0)，由 main 的占位环境项兜底；
//   5) 采样约定：tEnvMap 是世界空间方向的立方体贴图，最大 LOD 由尺寸决定（当前 256 → 8）。
//
// 建议顺序：先实现镜面（视觉差异最明显），再补漫反射；每步用白炉 + 单球验证。
// ==========================================================================
vec3 iblDiffuse(vec3 N, vec3 V, vec3 F0, float roughness) {
  if (uHasEnv == 0) return vec3(0.0);
  // irradiance ≈ 取很高 LOD（接近均匀）的环境采样
  vec3 irradiance = (uFurnace == 1) ? vec3(1.0) : textureLod(tEnvMap, N, IBL_DIFFUSE_LOD).rgb;
  vec3 kD = (vec3(1.0) - F0) * (1.0 - uMetalness); // 能量守恒：金属无漫反射
  // 与直接光漫反射同口径补 /PI（直接光在 main 为 kD*albedo/PI）。
  // 盒式滤波 mip 取的是均匀平均 radiance 而非 cosine-weighted irradiance，
  // 绝对亮度另由 uEnvIntensity 标定，二者归一到同一能量口径。
  return irradiance * kD * uBaseColor / PI;
}

vec3 iblSpecular(vec3 N, vec3 V, vec3 F0, float roughness) {
  if (uHasEnv == 0) return vec3(0.0);
  vec3 R = reflect(-V, N); // reflect 用于计算入射向量的镜面反射方向

  // 1. 采样预过滤环境贴图 (Part 1)
  // roughness → LOD：越粗糙越取更模糊的 mip；这是调参旋钮
  float lod = clamp(roughness * ENV_MAX_LOD, 0.0, ENV_MAX_LOD);
  vec3 prefiltered = (uFurnace == 1) ? vec3(1.0) : textureLod(tEnvMap, R, lod).rgb; // 白炉：环境视为纯白

  // 2. DFG
  vec3 dfg = envBRDFApprox(F0, max(dot(N, V), 1e-4), roughness);

  return prefiltered * dfg;
}

void main() {
  vec3 N = normalize(vWorldNormal);

  // ── gNormal：world normal 编码到 [0,1] ──
  // TODO(S2 · 你来写)：world / view 空间选择；必要时叠加 normal map 扰动。
  // 下游没有写 view-space 先用 world-space
  // normal map 等接贴图时再做
  gNormal = vec4(N * 0.5 + 0.5, 1.0);

  // ── gMRAO：metal / rough / ao / emissive ──
  // TODO(S2 · 你来写)：从这些 uniform 或贴图取金属度、粗糙度、AO、emissive。
  // 暂时用 uniform
  gMRAO = vec4(uMetalness, uRoughness, 1.0, 0.0);

  // ── 调试：法线视图（demo 的「法线（中间量）」档位）──
  // MRT 下帧缓冲有 3 个活动 draw buffer，任何材质都必须写满 3 个 out，
  // 因此调试视图也不能换回 three 内建材质（只写 1 个 out 会直接
  // GL_INVALID_OPERATION 且该 draw 被丢弃）。这里让 gAlbedo 输出编码法线，
  // 经下游 HDR 链呈现即得法线图。gNormal/gMRAO 上面已写满，可提前返回。
  if (uDebugNormals == 1) {
    gAlbedo = vec4(N * 0.5 + 0.5, 1.0);
    return;
  }

  // ── gAlbedo：脚手架用最小 Lambert，让画面不像纯平 albedo（占位光照）。
  //    真实实现应替换为你的 BRDF（直接光 + IBL），并把结果写到这里。
  // vec3 L = normalize(vec3(0.5, 0.8, 0.4)); // 硬编码主光方向（占位）
  // float ndl = max(dot(N, L), 0.0);
  // vec3 ambient = uBaseColor * 0.25;
  // vec3 diffuse = uBaseColor * ndl;
  // gAlbedo = vec4(ambient + diffuse, 1.0);

  // ── gAlbedo：Cook-Torrance 直接光（前向 PBR，gAlbedo = 最终着色）──
  // viewDir 计算当前片元指向相机的方向
  vec3 V = normalize(cameraPosition - vWorldPos);   // three 已按名上传 cameraPosition
  vec3 L = normalize(uLightDir);                    // 场景主平行光（GBufferLightSync 同步真实灯光）
  vec3 albedo = uBaseColor;                       // 已是线性空间（THREE.Color 自动转）
  vec3 F0 = mix(vec3(0.04), albedo, uMetalness); // 介电质 F0≈0.04，金属用 albedo

  float NoL = max(dot(N, L), 0.0); // 衡量表面接收到的光线强度
  float NoV = max(dot(N, V), 1e-4); // 衡量观察角度的核心量
  vec3 H = normalize(L + V); // 半程向量（Halfway Vector）光线向量和视线方向的角平分线
  float NoH = max(dot(N, H), 0.0); // NOH 简单理解就是 NOH 越大（夹角越大，值越小），说明该像素的微表面越接近完美反射方向，高光就越亮
  float VoH = max(dot(V, H), 0.0); // VoH 是 Schlick 近似公式的核心输入，用来模拟“掠射角反射增强”的物理现象——即视线与表面夹角越小，反射越强。

  float D = distributionGGX(NoH, uRoughness); // 法线分布函数 GGX 告诉我们在某个方向上有多少微表面法线朝向该方向
  float G = geometrySmith(NoV, NoL, uRoughness); // 几何遮蔽 Smith 随着角度变掠射，逐渐降低微表面的贡献率，模拟真实世界中粗糙表面边缘变暗、高光收敛的物理现象
  vec3  F = fresnelSchlick(VoH, F0); // Fresnel 视线与表面法线夹角越大（越接近掠射角），表面的反射能力就越强‌

  vec3 specular = (D * G * F) / (4.0 * NoV * NoL + 1e-4); // 镜面反射项 (4.0 * NoV * NoL + 1e-4) 校正因子，用于补偿微表面模型和真实反射之间的能量差异；加上 1e-4 只是防止除零。
  vec3 kD = (vec3(1.0) - F) * (1.0 - uMetalness);   
  // vec3(1.0) - F‌：F 是菲涅尔项（Fresnel），表示当前角度下镜面反射占入射光的比例。用 1 减去它，就得到剩余能进入材质内部的光线比例，这是能量守恒的体现——反射和折射（漫反射）加起来不能超过 1。
  // * (1.0 - uMetalness)‌：金属度越高，光线越倾向直接反射而不是进入内部散射。金属（metalness=1）没有漫反射，所以这里直接乘 (1.0 - metalness) 把漫反射系数压到 0；非金属（metalness=0）则保留完整的漫反射能量。‌‌

  vec3 diffuse  = kD * albedo / PI; // kD是给漫反射项乘的权重系数

  vec3 direct = (diffuse + specular) * uLightColor * NoL;

  // 白炉测试：关掉直接光，只留环境（环境在 ibl* 内视为纯白）
  if (uFurnace == 1) direct = vec3(0.0);

  // 环境光：IBL 算法段接入后走 split-sum；未启用 / 未实现时用占位常量兜底
  vec3 ambient = albedo * uAmbient;
  if (uHasEnv == 1) {
    ambient = (iblDiffuse(N, V, F0, uRoughness) + iblSpecular(N, V, F0, uRoughness)) * uEnvIntensity;
  }

  gAlbedo = vec4(ambient + direct, 1.0);
  // gAlbedo = vec4(vec3(albedo), 1.0);
}
