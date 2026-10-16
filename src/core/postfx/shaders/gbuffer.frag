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

in vec3 vWorldNormal;
in vec3 vWorldPos;
in vec2 vUv;

layout(location = 0) out vec4 gAlbedo;
layout(location = 1) out vec4 gNormal;
layout(location = 2) out vec4 gMRAO;

const float PI = 3.14159265359;

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
  vec3 L = normalize(vec3(0.5, 0.8, 0.4));          // 占位主光方向（之后可改 uniform 接场景灯光）
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




  gAlbedo = vec4(vec3(albedo), 1.0);
}
