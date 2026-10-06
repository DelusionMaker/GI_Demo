// 自动曝光测光：把 HDR 线性输入降采样成一个小图，逐纹素写「归一化 log 亮度」。
// 这个图仅供 CPU 隔帧回读（算出平均亮度 → 自动 EV + 直方图），不参与主色彩流。
//
// 本文件以 RawShaderMaterial 加载（glslVersion: GLSL3），precision / in / out 自声明。
precision highp float;

uniform sampler2D tColor;
uniform vec2 uTexel;   // 1 / 源尺寸，用于展开多次 tap 覆盖整块区域
uniform float uLogMin; // 归一化区间下限（EV，通常 -8）
uniform float uLogMax; // 归一化区间上限（EV，通常 +8）

in vec2 vUv;
out vec4 fragColor;

// 感知亮度权重（Rec.709 luma），用于把 RGB 压成单通道亮度
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

// ==========================================================================
// 算法段（自写 · 自动曝光测光）：log 平均亮度的区域采样
//
// 单 pass 双线性降采样从全分辨到 64×64 会严重欠采样（每个目标纹素覆盖 ~30×17
// 个源纹素，却只 bilinear 取 4 个），高光会被平均掉、auto-EV 易抖。
// 这里用 TAPS×TAPS 的网格 tap 近似覆盖该区域，取「平均 log 亮度」——
// 正好是几何平均曝光要的量（exp(mean(log L))）。
// 这部分数学必须由你本人讲清楚，不要交给工具代笔。
// ==========================================================================
const int TAPS = 4;

void main() {
  float sumLog = 0.0;
  float wsum = 0.0;
  // 网格跨度：覆盖「本目标纹素对应的源区域」的约 8 个源纹素，避免只取正中心 4 个
  vec2 stride = uTexel * 8.0;

  for (int y = 0; y < TAPS; y++) {
    for (int x = 0; x < TAPS; x++) {
      vec2 off = (vec2(float(x), float(y)) - (float(TAPS) - 1.0) * 0.5) * stride;
      vec3 c = texture(tColor, vUv + off).rgb;
      // 防 log(0)；极小亮度≈黑，不影响几何平均
      float l = max(dot(c, LUMA), 1e-4);
      sumLog += log2(l);
      wsum += 1.0;
    }
  }

  float logL = sumLog / wsum;
  // 归一化到 [0,1] 存进 8bit RT（CPU 回读后反归一化）。
  // 用 RGBA8 存而不是 RGBA16F：绕开 half-float 回读的兼容性问题（见 LuminancePass.ts）。
  float n = clamp((logL - uLogMin) / (uLogMax - uLogMin), 0.0, 1.0);
  fragColor = vec4(n, n, n, 1.0);
}
