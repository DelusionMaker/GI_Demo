// gbuffer_shadow.glsl —— 自写阴影可见性（SM / PCF / PCSS + 三种 bias）
//
// 由 gbuffer.frag 经 #include 拼入；只含函数定义，不声明 uniform / precision / out。
// 依赖编排器声明的 uShadow* 系列 uniform 与 viewMatrix。
// 见 TODO.md 第五章、DEVLOG 2026-10-20 / 2026-10-25。

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
