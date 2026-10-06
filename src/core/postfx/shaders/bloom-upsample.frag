// Bloom 第 3 步：把更粗的 mip 上采样并与「更细的 mip」累加（级联回叠）。
// 本文件以 RawShaderMaterial / GLSL3 加载。
precision highp float;

uniform sampler2D tInput; // 更粗的 mip（待上采样）
uniform sampler2D tAccum; // 当前更细的 mip（要被累加）
uniform vec2 uTexel;      // 1 / 更粗 mip 尺寸

in vec2 vUv;
out vec4 fragColor;

// ==========================================================================
// 算法段（自写 · Bloom 上采样）：上采样并与已有累加相加
//
// 标准做法：对 tInput 做双线性（或 9-tap）上采样，与 tAccum 直接相加，
// 写回更细的 mip（Pipeline 里本 pass 直接渲到 tAccum 对应的 RT）。
// 这部分数学由你本人实现。
// ==========================================================================
vec3 upsample(vec2 uv, vec2 texel) {
  // TODO(S4 · 你来写)：返回 tInput 在 uv 处的上采样结果
  return texture(tInput, uv).rgb; // 占位：先双线性取 1 次，待你替换为真正的上采样
}

void main() {
  vec3 base = texture(tAccum, vUv).rgb;
  vec3 up = upsample(vUv, uTexel);
  fragColor = vec4(base + up, 1.0);
}
