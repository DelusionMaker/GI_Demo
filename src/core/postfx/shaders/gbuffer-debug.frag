// G-buffer 调试视图：把 MRT 附件直接呈现在屏幕上（p0-gbuffer-hud S3）。
//
// 这些是**数据**而不是线性光：
// - gNormal 存的是 normal * 0.5 + 0.5（编码方向），按原始值显示才是标准法线图观感；
// - gMRAO 的 rgb 分别是 metal / roughness / ao（a = emissive）；
// - gAlbedo 是前向 PBR 的最终 HDR 颜色，这里 clamp 到 [0,1] 看缓冲里的原始值；
//   带 tonemap / 曝光的版本请用「仅到 beauty 为止」。
// 因此本 pass 不做 tonemap、不乘曝光、也不做 sRGB 编码（raw 输出）。
// 本文件以 RawShaderMaterial / GLSL3 加载。
precision highp float;

uniform sampler2D tAlbedo;
uniform sampler2D tNormal;
uniform sampler2D tMRAO;
uniform int uAttachment; // 0 = gAlbedo / 1 = gNormal / 2 = gMRAO

in vec2 vUv;
out vec4 fragColor;

void main() {
  if (uAttachment == 0) {
    fragColor = vec4(clamp(texture(tAlbedo, vUv).rgb, 0.0, 1.0), 1.0);
  } else if (uAttachment == 1) {
    fragColor = vec4(texture(tNormal, vUv).rgb, 1.0);
  } else {
    fragColor = vec4(texture(tMRAO, vUv).rgb, 1.0);
  }
}
