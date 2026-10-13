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
// TODO: 13-tap (提升画质)
// ==========================================================================
vec3 downsample(vec2 uv, vec2 texel) {
  // 返回对 tInput 在 uv 处的下采样结果
  vec2 offset = texel * 0.5; // 采样偏移: 半纹素偏移，吃到相邻 2×2 的双侧
  vec4 sum = texture(tInput, uv + vec2(-offset.x, -offset.y))
  + texture(tInput, uv + vec2(offset.x, -offset.y))
  + texture(tInput, uv + vec2(-offset.x, offset.y))
  + texture(tInput, uv + vec2(offset.x, offset.y));

  return (sum * 0.25).rgb;
}

void main() {
  fragColor = vec4(downsample(vUv, uTexel), 1.0);
}
