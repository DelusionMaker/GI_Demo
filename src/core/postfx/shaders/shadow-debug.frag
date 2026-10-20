// 阴影深度图集调试视图（p1-shadow 的「中间量可视化」）。
//
// 显示的是 DepthTexture 的原始值：1.0 = 远平面（没有投影物），
// 越近的遮挡越亮。不做 tonemap / 曝光 / sRGB 编码，方便直接观察。
// 图集分块用橙色边框标出；未使用的 tile 压暗。
// 本文件以 RawShaderMaterial / GLSL3 加载。

precision highp float;

uniform sampler2D uShadowAtlas;
uniform vec2 uAtlasGrid;   // cols, rows
uniform int uCascadeCount;

in vec2 vUv;
out vec4 fragColor;

void main() {
  float depth = texture(uShadowAtlas, vUv).r;
  vec3 color = vec3(1.0 - depth);

  // UV 原点在左下角，与 ShadowMapPass 的 tile row 排布一致
  vec2 tile = vUv * uAtlasGrid;
  vec2 cell = floor(tile);
  vec2 local = fract(tile);
  int index = int(cell.y * uAtlasGrid.x + cell.x);

  if (index >= uCascadeCount) color *= 0.12;

  float border = 0.0;
  if (local.x < 0.004 || local.y < 0.004 || local.x > 0.996 || local.y > 0.996) {
    border = 1.0;
  }
  color = mix(color, vec3(1.0, 0.55, 0.1), border);

  fragColor = vec4(color, 1.0);
}
