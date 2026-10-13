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

in vec3 vWorldNormal;
in vec3 vWorldPos;
in vec2 vUv;

layout(location = 0) out vec4 gAlbedo;
layout(location = 1) out vec4 gNormal;
layout(location = 2) out vec4 gMRAO;

void main() {
  vec3 N = normalize(vWorldNormal);

  // ── gNormal：world normal 编码到 [0,1] ──
  // TODO(S2 · 你来写)：world / view 空间选择；必要时叠加 normal map 扰动。
  gNormal = vec4(N * 0.5 + 0.5, 1.0);

  // ── gMRAO：metal / rough / ao / emissive ──
  // TODO(S2 · 你来写)：从这些 uniform 或贴图取金属度、粗糙度、AO、emissive。
  gMRAO = vec4(uMetalness, uRoughness, 1.0, 0.0);

  // ── gAlbedo：脚手架用最小 Lambert，让画面不像纯平 albedo（占位光照）。
  //    真实实现应替换为你的 BRDF（直接光 + IBL），并把结果写到这里。
  vec3 L = normalize(vec3(0.5, 0.8, 0.4)); // 硬编码主光方向（占位）
  float ndl = max(dot(N, L), 0.0);
  vec3 ambient = uBaseColor * 0.25;
  vec3 diffuse = uBaseColor * ndl;
  gAlbedo = vec4(ambient + diffuse, 1.0);
}
