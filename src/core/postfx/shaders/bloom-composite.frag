// Bloom 第 4 步：把 bloom 叠加回原始 HDR 场景，输出全分辨率 HDR。
// 本文件以 RawShaderMaterial / GLSL3 加载。
precision highp float;

uniform sampler2D tScene;  // 原始 HDR 场景（beauty 输出）
uniform sampler2D tBloom;  // 级联后的 bloom 图（半分辨率 mip0）
uniform float uIntensity;  // bloom 强度

in vec2 vUv;
out vec4 fragColor;

void main() {
  vec3 scene = texture(tScene, vUv).rgb;
  vec3 bloom = texture(tBloom, vUv).rgb;
  // 线性空间直接相加（bloom 必须在 tonemap 之前，物理正确），再乘强度
  fragColor = vec4(scene + bloom * uIntensity, 1.0);
}
