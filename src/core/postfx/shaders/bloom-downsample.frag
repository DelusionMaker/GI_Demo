// Bloom 第 2 步：把阈值后的图逐级降采样（mip 链下采样）。
// 本文件以 RawShaderMaterial / GLSL3 加载。
precision highp float;

uniform sampler2D tInput;
uniform vec2 uTexel; // 1 / 源 mip 尺寸，用于展开多次 tap

in vec2 vUv;
out vec4 fragColor;

// ==========================================================================
// 算法段（自写 · Bloom 降采样）：下采样滤波器
//
// 建议 13-tap（COD）或简单的双线性 4-tap（Karis average）；
// 注意按源 mip 的 texel 尺寸做半纹素偏移，避免降采样漏掉中间样本。
// 这部分数学由你本人实现。
// ==========================================================================
vec3 downsample(vec2 uv, vec2 texel) {
  // TODO(S4 · 你来写)：返回对 tInput 在 uv 处的下采样结果
  return texture(tInput, uv).rgb; // 占位：先双线性取 1 次，待你替换为真正的滤波器
}

void main() {
  fragColor = vec4(downsample(vUv, uTexel), 1.0);
}
