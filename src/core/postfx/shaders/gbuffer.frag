// G-buffer 片元着色器（GLSL ES 3.00，RawShaderMaterial + GLSL3 加载）。
//
// 输出 3 个 MRT 附件（与 BeautyPass.target.mrt 顺序一致）：
//   location 0  gAlbedo  RGBA8   反照率（下游 HDR 链当 beauty）
//   location 1  gNormal  RGBA16F 法线（需精度，防 banding）
//   location 2  gMRAO    RGBA8   metallic / roughness / ao / emissive
//
// 当前走「前向」：gAlbedo 直接输出 PBR 最终着色（直接光 + IBL），
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
uniform int uDebugNormals; // 调试视图：1 = gAlbedo 输出编码法线（见下方 main 内分支）

// ── 场景灯光（GBufferLightSync 每帧从真实灯光同步，见 gbufferShared.ts）──
uniform vec3 uLightDir;    // 指向光源的单位向量（世界空间）
uniform vec3 uLightColor;  // 颜色 × 强度
uniform vec3 uAmbient;     // 环境兜底（IBL 未启用时）：颜色 × 强度

// ── IBL（p1 算法段使用；GBufferEnvironment + demo 旋钮提供）──
uniform samplerCube uEnvMap; // CubeCamera 捕获的立方体贴图（带 mipmap，世界空间方向直接采样）
uniform float uEnvIntensity; // 环境强度倍率
uniform int uHasEnv;         // 1 = 环境贴图就绪且开关打开
uniform int uFurnace;        // 1 = 白炉测试：环境视为纯白、直接光关闭

// ── 阴影（p1-shadow；ShadowMapPass 每帧写入，见 gbufferShared.ts）──
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

uniform mat4 viewMatrix; // three 按名自动上传；级联选择需要 view-space 深度

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

// ==========================================================================
// 阴影（p1-shadow）—— 骨架已就位，算法段留给你写
// ==========================================================================

/**
 * 按 view-space 深度选择级联。
 * 返回 0–3；-1 = 超出最后一级阴影距离（应视为完全受光）。
 *
 * 这一步是纯记账（比较切分距离），框架已实现；真正需要自写的是下面的
 * shadowFactor()。注意：不检查 uShadowEnabled，这样「cascade 分层」调试视图
 * 在关闭阴影时也能看到覆盖范围。
 */
int shadowCascadeIndex(vec3 worldPos) {
  if (uShadowCascadeCount <= 0) return -1;
  float viewDepth = -(viewMatrix * vec4(worldPos, 1.0)).z; // viewMatrix 把世界坐标变换到相机空间
  if (viewDepth <= uShadowSplits.x) return 0;
  if (uShadowCascadeCount > 1 && viewDepth <= uShadowSplits.y) return 1;
  if (uShadowCascadeCount > 2 && viewDepth <= uShadowSplits.z) return 2;
  if (uShadowCascadeCount > 3 && viewDepth <= uShadowSplits.w) return 3;
  return -1;
}

/** PCF 5 x 5（样本钳制在本级 tile 内，避免多级联时采样到相邻级联的深度） */
float PCF(sampler2D shadowMap, vec3 coord, float bias, vec2 tileMin, vec2 tileMax) {
  vec2 lo = tileMin + vec2(uShadowTexelSize * 0.5);
  vec2 hi = tileMax - vec2(uShadowTexelSize * 0.5);
  float sum = 0.0;
  for (int i = -2; i <= 2; i++) {
    for (int j = -2; j <= 2; j++) {
      vec2 off = vec2(float(i), float(j)) * uShadowTexelSize * uShadowPCFRadius;
      vec2 uv = clamp(coord.xy + off, lo, hi);
      float pcfDepth = texture(shadowMap, uv).r;
      sum += (coord.z <= pcfDepth + bias) ? 1.0: 0.0;
    }
  }
  return sum / 25.0;
}

/** PCSS: blocker search + 可变半径 PCF（样本同样钳制在本级 tile 内） */
float PCSS(sampler2D shadowMap, vec3 coord, float bias, vec2 tileMin, vec2 tileMax) {
  // 约束：TAPS 必须是奇数（配合 i <= TAPS/2），除数必须是 TAPS*TAPS。
  // 之前 3 -> 4 taps/16、8 -> 81 taps/64 都是在这条上翻车。
  const int TAPS = 5; // 5×5 = 25
  const float SEARCH_RADIUS_TEXELS = 6.0; // blocker search 固定半径
  const float MAX_PENUMBRA_TEXELS = 32.0;

  vec2 lo = tileMin + vec2(uShadowTexelSize * 0.5);
  vec2 hi = tileMax - vec2(uShadowTexelSize * 0.5);

  // STEP 1: 遮挡物搜索（Blocker Search） —— 在阴影里找平均遮挡深度
  float avgBlockerDepth = 0.0;
  float blockers = 0.0;
  float searchStep = uShadowTexelSize * SEARCH_RADIUS_TEXELS / float(TAPS / 2);
  for (int i = - TAPS / 2; i <= TAPS / 2; i++){
    for (int j = - TAPS / 2; j <= TAPS / 2; j ++) {
      vec2 uv = clamp(coord.xy + vec2(float(i), float(j)) * searchStep, lo, hi);
      float z = texture(shadowMap, uv).r;
      if(z < coord.z - bias){ avgBlockerDepth += z; blockers += 1.0; }
    }
  }
  if(blockers < 1.0) return 1.0;            // 没遮挡 → 全亮
  avgBlockerDepth /= blockers;

  // STEP 2: 由相似三角形估算半影半径 w
  float radiusUV = (coord.z - avgBlockerDepth) * uShadowLightSize / max(avgBlockerDepth, 1e-3);
  float radiusTexels = clamp(radiusUV * uShadowAtlasSize, 1.0, MAX_PENUMBRA_TEXELS);

  // STEP 3: 用半径 penumbra 做 PCF
  float sum = 0.0;
  float filterStep = uShadowTexelSize * radiusTexels / float(TAPS / 2);

  for (int i = - TAPS / 2; i <= TAPS / 2; i++){
    for (int j = - TAPS / 2; j <= TAPS / 2; j ++) {
      vec2 uv = clamp(coord.xy + vec2(float(i), float(j)) * filterStep, lo, hi);
      float z = texture(shadowMap, uv).r;
      sum += (coord.z <= z + bias) ? 1.0 : 0.0;
    }
  }

  return sum / (float(TAPS * TAPS));
}
 
// ==========================================================================
// p1-shadow：返回 [0,1] 的阴影可见性（1 = 完全受光）
//
// 框架已经准备好的原料：
//   - shadowCascadeIndex(worldPos)            级联选择（已实现）
//   - uShadowMatrices[ci]                     worldPos → 图集 UV + 深度
//                                             （xy 已含 tile 变换，z ∈ [0,1]）
//   - uShadowAtlas / uShadowTexelSize         深度图集与纹素尺寸
//   - uShadowMode / uShadowBiasMode / 各参数  面板旋钮
//
// 建议实现顺序（每一步都能在 HUD / 调试视图里验证）：
//   0) SM：int ci = shadowCascadeIndex(worldPos);
//      if (ci < 0) return 1.0;
//      vec4 clip = uShadowMatrices[ci] * vec4(worldPos, 1.0);
//      vec3 coord = clip.xyz / clip.w;          // 正交光相机 w = 1
//      coord.xy 超出 [0,1] 或 coord.z 超出 [0,1] → 1.0（级联外不压暗）
//      float sceneDepth = texture(uShadowAtlas, coord.xy).r;
//      visibility = (coord.z <= sceneDepth + bias) ? 1.0 : 0.0;
//
//   1) 三种 bias 补偿（用 uShadowBiasMode 分支，做 A/B 对照）：
//      - constant：coord.z -= uShadowBias
//      - normal  ：投影前 worldPos += N * uShadowNormalBias
//      - slope   ：偏移量随 NoL 变小而增大（如 uShadowBias * tan(acos(NoL))）
//      目标：Cornell 方块底面无 acne；接触处不脱落（peter-panning）。
//      这一项是作品集最好的「同一算法三种取舍」叙事，别只留一种。
//
//   2) PCF（uShadowMode == 1）：
//      以 coord.xy 为中心，按 uShadowTexelSize * uShadowPCFRadius 取
//      3×3 / 5×5（或泊松盘）样本，逐样本比较后取平均可见性。
//      采样数写死便于对照；半径滑块只改变偏移，不改循环次数。
//
//   3) PCSS（uShadowMode == 2）：
//      blocker search：在 UV 邻域内统计 sceneDepth < coord.z 的样本，
//                      求平均遮挡深度 avgBlockerDepth，计数为 0 → 1.0；
//      penumbra：宽度 ≈ (coord.z - avgBlockerDepth) * uShadowLightSize；
//      用该宽度做可变半径 PCF（宽度越大样本越分散，可限制最大半径）。
//      自检：遮挡物越远，半影越宽（近硬远软）。
//
//   4) 级联过渡：硬切会在级联边界留下接缝。可对相邻级联各采样一次，
//      按 viewDepth 在切分点附近的窗口内线性混合。
//
//   5) 最后：return mix(1.0, visibility, uShadowStrength); 
//
// 自检点：
//   - 关闭阴影 / 超出阴影距离时，画面应与接入前逐像素一致；
//   - Cornell：bias 从小往大扫，先出现 acne、后出现 peter-panning；
//   - PCF 半径增大边缘变软，GPU 时间线性上升（性能面板逐 pass 归因）；
//   - 2 级 / 4 级级联时，「cascade 分层」调试视图能看出覆盖范围与接缝。
// 出现问题：在没有 bias 的时候，会出现 shadow acne (自阴影)
// ==========================================================================
float shadowFactor(vec3 N, vec3 L, vec3 worldPos) {
  if (uShadowEnabled == 0) return 1.0;

  // bias
  float bias = 0.0;
  vec3 samplePos = worldPos;
  if (uShadowBiasMode == 1) {
    bias = uShadowBias;
  } else if (uShadowBiasMode == 2) {
    samplePos += N * uShadowNormalBias;
  } else if (uShadowBiasMode == 3) {
    float NoL = clamp(dot(N, L), 0.05, 1.0);
    bias = uShadowSlopeBias * tan(acos(NoL));
  }
  
  int ci = shadowCascadeIndex(worldPos);
  if (ci < 0) return 1.0;

  vec4 clip = uShadowMatrices[ci] * vec4(samplePos, 1.0);
  vec3 coord = clip.xyz / clip.w;          // 正交光相机 w = 1

  // 本级 tile 在图集里的范围（矩阵已烘 tile 变换，coord.xy 即图集 UV）
  float tileSpan = 1.0 / max(uShadowAtlasGrid.x, uShadowAtlasGrid.y);
  vec2 tileId = vec2(mod(float(ci), uShadowAtlasGrid.x),
                     floor(float(ci) / uShadowAtlasGrid.x));
  vec2 tileMin = tileId * tileSpan;
  vec2 tileMax = tileMin + tileSpan;

  if (coord.x < tileMin.x || coord.y < tileMin.y ||
      coord.x >= tileMax.x || coord.y >= tileMax.y ||
      coord.z < 0.0 || coord.z > 1.0) {
    return 1.0;
  }

  float visibility = 1.0;
  if (uShadowMode == 0) { // SM
    float sceneDepth = texture(uShadowAtlas, coord.xy).r;
    visibility = (coord.z <= sceneDepth + bias) ? 1.0 : 0.0;
  } else if (uShadowMode == 1) { // PCF
    visibility = PCF(uShadowAtlas, coord, bias, tileMin, tileMax);
  } else if (uShadowMode == 2) { // PCSS
    visibility = PCSS(uShadowAtlas, coord, bias, tileMin, tileMax);
  }

  return mix(1.0, visibility, uShadowStrength);
}

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

  // ── 调试：法线视图（demo 的「法线（中间量）」档位）──
  // MRT 下帧缓冲有 3 个活动 draw buffer，任何材质都必须写满 3 个 out，
  // 因此调试视图也不能换回 three 内建材质（只写 1 个 out 会直接
  // GL_INVALID_OPERATION 且该 draw 被丢弃）。这里让 gAlbedo 输出编码法线，
  // 经下游 HDR 链呈现即得法线图。gNormal/gMRAO 上面已写满，可提前返回。
  if (uDebugNormals == 1) {
    gAlbedo = vec4(N * 0.5 + 0.5, 1.0);
    return;
  }

  // ── 调试：cascade 分层着色（中间量视图）──
  // 每个级联一个颜色，超出阴影距离的像素压暗；用于检查 CSM 覆盖范围与接缝。
  if (uShadowDebugCascade == 1) {
    int ci = shadowCascadeIndex(vWorldPos);
    vec3 tint = vec3(0.08, 0.09, 0.11);
    if (ci == 0) tint = vec3(0.98, 0.42, 0.30);
    else if (ci == 1) tint = vec3(0.35, 0.78, 0.98);
    else if (ci == 2) tint = vec3(0.52, 0.90, 0.45);
    else if (ci == 3) tint = vec3(0.95, 0.86, 0.35);
    gAlbedo = vec4(tint, 1.0);
    return;
  }

  // ── gAlbedo：Cook-Torrance 直接光（前向 PBR，gAlbedo = 最终着色）──
  // viewDir 计算当前片元指向相机的方向
  vec3 V = normalize(cameraPosition - vWorldPos);   // three 已按名上传 cameraPosition
  vec3 L = normalize(uLightDir);                    // 场景主平行光（GBufferLightSync 同步真实灯光）
  vec3 F0 = mix(vec3(0.04), albedo, metalness);     // 介电质 F0≈0.04，金属用 albedo

  float NoL = max(dot(N, L), 0.0); // 衡量表面接收到的光线强度
  float NoV = max(dot(N, V), 1e-4); // 衡量观察角度的核心量
  vec3 H = normalize(L + V); // 半程向量（Halfway Vector）光线向量和视线方向的角平分线
  float NoH = max(dot(N, H), 0.0); // NOH 简单理解就是 NOH 越大（夹角越大，值越小），说明该像素的微表面越接近完美反射方向，高光就越亮
  float VoH = max(dot(V, H), 0.0); // VoH 是 Schlick 近似公式的核心输入，用来模拟“掠射角反射增强”的物理现象——即视线与表面夹角越小，反射越强。

  float D = distributionGGX(NoH, roughness); // 法线分布函数 GGX 告诉我们在某个方向上有多少微表面法线朝向该方向
  float G = geometrySmith(NoV, NoL, roughness); // 几何遮蔽 Smith 随着角度变掠射，逐渐降低微表面的贡献率，模拟真实世界中粗糙表面边缘变暗、高光收敛的物理现象
  vec3  F = fresnelSchlick(VoH, F0); // Fresnel 视线与表面法线夹角越大（越接近掠射角），表面的反射能力就越强‌

  vec3 specular = (D * G * F) / (4.0 * NoV * NoL + 1e-4); // 镜面反射项 (4.0 * NoV * NoL + 1e-4) 校正因子，用于补偿微表面模型和真实反射之间的能量差异；加上 1e-4 只是防止除零。
  vec3 kD = (vec3(1.0) - F) * (1.0 - metalness);
  // vec3(1.0) - F‌：F 是菲涅尔项（Fresnel），表示当前角度下镜面反射占入射光的比例。用 1 减去它，就得到剩余能进入材质内部的光线比例，这是能量守恒的体现——反射和折射（漫反射）加起来不能超过 1。
  // * (1.0 - metalness)‌：金属度越高，光线越倾向直接反射而不是进入内部散射。金属（metalness=1）没有漫反射，所以这里直接乘 (1.0 - metalness) 把漫反射系数压到 0；非金属（metalness=0）则保留完整的漫反射能量。‌‌

  vec3 diffuse  = kD * albedo / PI; // kD是给漫反射项乘的权重系数

  // 阴影只压暗直接光；IBL / 环境项保持原样（AO 属 p2-gtao 的范围）。
  float visibility = shadowFactor(N, L, vWorldPos);
  vec3 direct = (diffuse + specular) * uLightColor * NoL * visibility;

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
