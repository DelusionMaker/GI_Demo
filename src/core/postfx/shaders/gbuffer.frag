// G-buffer 片元着色器（GLSL ES 3.00，RawShaderMaterial + GLSL3 加载）。
//
// 本文件是「编排器」：只声明 precision / uniform / varying / MRT out 常量，
// 并通过 #include 拼入各「自写算法模块」。各模块只含函数定义，不重复声明 uniform，
// 否则链接期报 redefinition（include 是文本拼接，不是真正的模块系统）。
//
// 输出 3 个 MRT 附件（与 BeautyPass.target.mrt 顺序一致）：
//   location 0  gAlbedo  RGBA8   反照率（下游 HDR 链当 beauty，前向存最终着色）
//   location 1  gNormal  RGBA16F 法线（需精度，防 banding）
//   location 2  gMRAO    RGBA8   metallic / roughness / ao / emissive
//
// 当前走「前向」：gAlbedo 直接输出 PBR 最终着色（直接光 + IBL + 阴影），
// gNormal / gMRAO 保留给后续 SSR / SSGI / 阴影等屏幕空间 pass 使用。

precision highp float;

uniform vec3 uBaseColor;
uniform float uRoughness;
uniform float uMetalness;

// ── baseColor 贴图（glTF 资产）──
uniform sampler2D uBaseColorMap;
uniform int uHasBaseColorMap;   // 1 = 采样 uBaseColorMap
uniform vec4 uMapTransform;     // xy = repeat，zw = offset
uniform float uAlphaTest;       // >0 时按 baseColor.a 裁切（glTF MASK）

uniform vec3 cameraPosition;
uniform int uDebugNormals; // 调试视图：1 = gAlbedo 输出编码法线（见 lib/gbuffer_debug.glsl）

// ── 场景灯光（GBufferLightSync 每帧从真实灯光同步，见 gbufferShared.ts）──
uniform vec3 uLightDir;    // 指向光源的单位向量（世界空间）
uniform vec3 uLightColor;  // 颜色 × 强度
uniform vec3 uAmbient;     // 环境兜底（IBL 未启用时）：颜色 × 强度

// ── IBL（p1 算法段使用；GBufferEnvironment + demo 旋钮提供，见 lib/gbuffer_ibl.glsl）──
uniform samplerCube uEnvMap; // CubeCamera 捕获的立方体贴图（带 mipmap，世界空间方向直接采样）
uniform float uEnvMaxLod;    // cube 的最大 mip LOD（= log2(ENV_SIZE)），由 gbufferShared 按实际尺寸注入
uniform float uEnvIntensity; // 环境强度倍率
uniform int uHasEnv;         // 1 = 环境贴图就绪且开关打开
uniform int uFurnace;        // 1 = 白炉测试：环境视为纯白、直接光关闭

// ── 阴影（p1-shadow；ShadowMapPass 每帧写入，见 lib/gbuffer_shadow.glsl）──
uniform sampler2D uShadowAtlas;   // 深度图集（DepthTexture 的 .r）
uniform vec2 uShadowAtlasGrid;
uniform mat4 uShadowMatrices[4];  // worldPos → 图集 UV(xy) + 归一化深度(z)，已含 tile 变换
uniform vec4 uShadowSplits;       // 各级级联的 view-space far
uniform int uShadowCascadeCount;  // 1–4；0 = 本帧没有阴影贴图
uniform float uShadowTexelSize;   // 1 / 图集边长（UV 空间一个纹素）
uniform float uShadowAtlasSize;   // 图集边长（像素）
uniform int uShadowEnabled;       // 1 = 应用阴影
uniform int uShadowMode;          // 0 = SM / 1 = PCF / 2 = PCSS
uniform int uShadowBiasMode;      // 0 = none / 1 = constant / 2 = normal / 3 = slope
uniform float uShadowBias;        // 常数深度偏移
uniform float uShadowSlopeBias;   // 斜率缩放系数（slope bias 模式，与 uShadowBias 解耦）
uniform float uShadowNormalBias;  // 法线偏移（世界单位）
uniform float uShadowPCFRadius;   // PCF 半径（纹素）
uniform float uShadowLightSize;   // PCSS 半影尺度（UV 近似）
uniform float uShadowStrength;    // 1 = 全黑阴影，0 = 不压暗
uniform int uShadowDebugCascade;  // 1 = 输出 cascade 色块（中间量视图）

// ── 多光源（p1-light-ssr S1：暴力前向；S2/S3 Clustered 改走数据纹理取代本数组）──
uniform int uLightCount;          // 活跃光源数量（GBufferLightSync 每帧填充）
uniform int uShadowLightIndex;    // 主平行光（阴影投射光）在数组中的索引；-1 = 无
uniform vec4 uLightData0[64];     // xyz = 世界位置，w = range（0 = 无限远，平行光用）
uniform vec4 uLightData1[64];     // rgb = 颜色 × 强度，w = 类型（0 平行光 / 1 点光 / 2 聚光）
uniform vec4 uLightData2[64];     // xyz = 方向（平行光=指向光源；聚光=光锥轴 从灯出），w = cosInner（聚光内角）
uniform vec4 uLightData3[64];     // x = cosOuter（聚光外角），yzw 预留

// ── Clustered（p1-light-ssr S2）──
uniform int uClusterDebug;          // 0=关 / 1=tile 叠加 / 2=每 cluster 灯数热力
uniform int uClustered;             // 1 = 启用 Clustered 前向（替换暴力循环）
uniform vec3 uClusterDims;          // x=gridW, y=gridH, z=zSlices
uniform float uViewNear;
uniform float uViewFar;
uniform sampler2D uClusterLightGrid;     // 每 cluster 存 (offset, count, 0, 0)
uniform sampler2D uClusterLightIndices; // 扁平灯号索引（.r = 灯号）

uniform mat4 viewMatrix; // three 按名自动上传；级联选择需要 view-space 深度

in vec3 vWorldNormal;
in vec3 vWorldPos;
in vec2 vUv;

layout(location = 0) out vec4 gAlbedo;
layout(location = 1) out vec4 gNormal;
layout(location = 2) out vec4 gMRAO;

const float PI = 3.14159265359;

const int MAX_LIGHTS = 64; // 必须与 gbufferShared.ts 的 MAX_LIGHTS 保持一致

// ── 自写算法模块（各自成文件，便于作品集独立审阅 / 小 diff；顺序：被调用者在前）──
#include "./lib/gbuffer_brdf.glsl"    // D/G/F + EnvBRDFApprox
#include "./lib/gbuffer_ibl.glsl"     // iblDiffuse / iblSpecular
#include "./lib/gbuffer_shadow.glsl"  // cascade / PCF / PCSS / shadowFactor
#include "./lib/gbuffer_lights.glsl"  // 多光源循环 + cluster-fetch（须排在 debug 之前）
#include "./lib/gbuffer_debug.glsl"   // 调试视图（法线 / cascade / cluster）

void main() {
  // baseColor 贴图 + alphaTest 必须在写 MRT 之前完成：
  // MASK 材质（树叶 / 栏杆）若裁切晚了，gAlbedo / gNormal / gMRAO 会先被写脏。
  vec2 baseUv = vUv * uMapTransform.xy + uMapTransform.zw;
  vec4 baseSample = (uHasBaseColorMap == 1) ? texture(uBaseColorMap, baseUv) : vec4(1.0);
  if (uAlphaTest > 0.0 && baseSample.a < uAlphaTest) discard;

  vec3 albedo = uBaseColor * baseSample.rgb;
  float metalness = uMetalness;
  float roughness = uRoughness;

  // 白炉：与材质颜色解耦。环境视为纯白、直接光关闭，正确实现下
  // 片元输出应接近 1.0（split-sum 近似在粗糙端会有偏差，读数会如实显示）。
  if (uFurnace == 1) {
    albedo = vec3(1.0);
    metalness = 0.0;
  }

  vec3 N = normalize(vWorldNormal);

  // ── gNormal：world normal 编码到 [0,1] ──
  // TODO(S2 · 你来写)：world / view 空间选择；必要时叠加 normal map 扰动。
  // 下游没有写 view-space 先用 world-space
  // normal map 等接贴图时再做
  gNormal = vec4(N * 0.5 + 0.5, 1.0);

  // ── gMRAO：metal / rough / ao / emissive ──
  // TODO(S2 · 你来写)：从这些 uniform 或贴图取金属度、粗糙度、AO、emissive。
  // 暂时用 uniform
  gMRAO = vec4(metalness, roughness, 1.0, 0.0);

  // ── 调试视图（命中则写 gAlbedo 并提前结束）──
  if (applyGbufferDebug(N, vWorldPos)) return;

  // ── gAlbedo：Cook-Torrance 直接光（前向 PBR，多光源；gAlbedo = 最终着色）──
  vec3 V = normalize(cameraPosition - vWorldPos);   // 当前片元指向相机
  vec3 F0 = mix(vec3(0.04), albedo, metalness);     // 介电质 F0≈0.04，金属用 albedo
  float NoV = max(dot(N, V), 1e-4);

  // 多光源（p1-light-ssr S1→S2）：uClustered 决定走暴力循环还是 Clustered cluster-fetch。
  // 两条路径都调用 lightContribution()（见 lib/gbuffer_lights.glsl），逐字节等价，仅循环来源不同。
  // TODO(p1-light-ssr · S3 作品集自写): 接 UI 旋钮 / URL 参数做 A/B（同场景同灯数，亮度应一致）。
  vec3 direct = vec3(0.0);
  if (uClustered == 1) {
    float viewZ = -(viewMatrix * vec4(vWorldPos, 1.0)).z; // 视图空间深度（正）
    int cidx = getClusterIndex(gl_FragCoord.xy, viewZ, uClusterDims, uViewNear, uViewFar);
    vec2 gc = texelFetch(uClusterLightGrid, clusterTexCoord(cidx), 0).rg;
    int offset = int(gc.x);
    int count = int(gc.y);
    for (int k = 0; k < MAX_LIGHTS; k++) {
      if (k >= count) break;
      int li = int(texelFetch(uClusterLightIndices, clusterTexCoord(offset + k), 0).r);
      direct += lightContribution(li, N, V, NoV, albedo, metalness, roughness, F0, vWorldPos);
    }
  } else {
    for (int i = 0; i < MAX_LIGHTS; i++) {
      if (i >= uLightCount) break;
      direct += lightContribution(i, N, V, NoV, albedo, metalness, roughness, F0, vWorldPos);
    }
  }

  // 白炉测试：关掉直接光，只留环境（环境在 ibl* 内视为纯白）
  if (uFurnace == 1) direct = vec3(0.0);

  // 环境光：IBL 启用时走 split-sum；否则用占位环境项兜底
  vec3 ambient = albedo * uAmbient;
  if (uHasEnv == 1) {
    ambient = (iblDiffuse(N, F0, albedo, metalness) + iblSpecular(N, V, F0, roughness)) * uEnvIntensity;
  }

  gAlbedo = vec4(ambient + direct, 1.0);
  // gAlbedo = vec4(vec3(albedo), 1.0);
}
