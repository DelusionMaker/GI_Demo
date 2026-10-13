// Bloom 第 1 步：从 HDR 场景里提取「够亮」的部分。
// 本文件以 RawShaderMaterial / GLSL3 加载，precision / in / out 自声明。
precision highp float;

uniform sampler2D tInput;
uniform float uThreshold; // 亮度阈值（HDR 线性空间，通常 ~1.0）
uniform float uKnee;      // soft-knee 半宽：阈值附近的柔和过渡区间

in vec2 vUv;
out vec4 fragColor;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

// ==========================================================================
// 算法段（自写 · Bloom 阈值提取）：soft-knee 亮度提取
//
// 经典做法（Jimenez / Call of Duty 风格）：
//   lum = dot(c, LUMA)
//   soft-knee 在 [threshold - knee, threshold + knee] 做平滑过渡，
//   超过的部分按亮度比例提取：提取量 = max(lum - t, 0) 处用 knee 缓和。
// 这部分数学由你本人实现并能在 demo 文案里讲清。
// ==========================================================================
vec3 extractBright(vec3 c) {
  // 返回高于阈值的亮度（带 soft-knee 过渡），其余压到 0
  float lum = dot(c, LUMA);
  float softKnee = clamp(lum - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  softKnee = softKnee * softKnee / (4.0 * uKnee + 1e-4); // 二次曲线平滑过渡
  float contribution = max(lum - uThreshold, softKnee);
  c = c * contribution / max(lum, 1e-4); // 归一化为 0..1 缩放因子，保留色相
  return c;
}

void main() {
  vec3 c = texture(tInput, vUv).rgb;
  fragColor = vec4(extractBright(c), 1.0);
}
