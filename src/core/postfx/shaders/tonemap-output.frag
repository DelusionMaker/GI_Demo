// 精确线性 → sRGB 分段编码。
//
// 自建 pass 走 RawShaderMaterial，three 不会自动为它插入编码调用，
// 必须自己编码 —— 这是自建管线画面发灰 / 发暗的最高频原因。
// 不要用 pow(c, 1/2.2) 近似，暗部会偏。
// 本文件以 RawShaderMaterial 加载，precision 与 in/out 都需自己声明。
precision highp float;

#ifndef saturate
// <common> may have defined saturate() already
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif

uniform sampler2D tColor;
uniform vec2 uResolution;
uniform float uExposureEV;
uniform int uTonemap;

in vec2 vUv;
out vec4 fragColor;

vec3 linearToSrgb(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}

// ==========================================================================
// TODO(S2 · 你来写)：三条色调映射曲线
//
//   mode 1 = ACES(Narkowicz) / 2 = AgX / 3 = Reinhard / 0 = 直通
//
// 现在三个分支都直接返回入参（等于直通），所以切换下拉暂时看不出区别 ——
// 这是预期的，因为曲线本体还没写。
//
// 三个分支必须与 CPU 侧 src/core/postfx/toneCurves.ts 的结果一致
// （曲线图画的是那一份）。同步策略见该文件顶部说明。
//
// 每个分支的注意事项与 toneCurves.ts 中的注释相同：
// 负数要 clamp 到 0、f(0)=0、单调不减、x→∞ 有界。
// ==========================================================================
// AgX（Sobotka 拟合，three.js 同款）。注意 mat3 是列主序，常数按 three.js 原样填。
vec3 agxDefaultContrastApprox(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return + 15.5   * x4 * x2
         - 40.14  * x4 * x
         + 31.96  * x4
         - 6.868  * x2 * x
         + 0.4298 * x2
         + 0.1191 * x
         - 0.00232;
}

vec3 agxTonemap(vec3 val) {
  const mat3 AgXInsetMatrix = mat3(
    0.856627153315983, 0.137318972929847, 0.11189821299995,
    0.0951212405384098, 0.761241990602591, 0.0767994186031903,
    0.0482516061456073, 0.101439036467562, 0.811302368396859
  );
  const mat3 AgXOutsetMatrix = mat3(
    1.1271005818144392, -0.1415431936718892, -0.1415431936718892,
    -0.1109175933505904, 1.157903320297076, -0.1109175933505904,
    -0.0161825364637495, -0.0161825364637495, 1.2514607733436792
  );

  // 防 log2(0) → -inf；极小输入≈黑（f(0) 给极小正值，视觉即黑）
  val = max(val, vec3(1e-4));
  val = AgXInsetMatrix * val;   // 线性 RGB → AgX 原色
  val = log2(val);
  val = (val + 10.0) / 12.0;    // 归一化到约 [0,1]
  val = AgXOutsetMatrix * val;  // look（归一化 log 空间）
  val = agxDefaultContrastApprox(val);
  val = val * 12.0 - 10.0;      // 反归一化
  val = exp2(val);
  return val;
}

vec3 tonemap(vec3 color, int mode) {
  color = max(color, 0.0);
  if (mode == 1) {
    // TODO(S2)：ACES —— 形如 x(ax+b) / (x(cx+d)+e) 的有理函数
    float a = 2.51;
    float b = 0.03;
    float c = 2.43;
    float d = 0.59;
    float e = 0.14;
    color = saturate(color * (a * color + b) / (color * (c * color + d) + e));
    return color;
  }
  if (mode == 2) {
    // AgX（Sobotka 拟合，three.js 同款）：原色变换 + log2 编码 + 对比度曲线
    color = agxTonemap(color);
    return color;
  }
  if (mode == 3) {
    // TODO(S2)：Reinhard —— 从最简形式起步
    color = saturate(color / (1.0 + color));
    return color;
  }
  return color;
}

void main() {
  vec3 color = texture(tColor, vUv).rgb;

  // EV 曝光：multiplier = 2^EV，由控制面板的滑杆每帧推进来
  color *= exp2(uExposureEV);

  // ======================================================================
  // TODO(S2 · 你来定)：过曝回收怎么呈现
  //
  // 这里是最合适的切入点（映射前，还拿得到 > 1 的原始值）。
  // 两种低成本做法，选一个并把理由记进 DEVLOG：
  //
  //   a) 加一个 uClipView 开关：映射前把任一通道 > 1 的像素标红，
  //      再走完映射 —— 直观，改动最小（一个 uniform + 一个分支）。
  //   b) 复用调试视图机制：新增一个 clip-view pass 插在本 pass 之前。
  //      更符合现有架构，但要新建文件。
  //
  // 无论选哪种，记得在 demo 页的 limitations 里写清"标红是诊断视图，
  // 不代表最终画面"，避免被误解成渲染瑕疵。
  // ======================================================================
  vec3 mapped = tonemap(color, uTonemap);

  fragColor = vec4(linearToSrgb(clamp(mapped, 0.0, 65504.0)), 1.0);
}
