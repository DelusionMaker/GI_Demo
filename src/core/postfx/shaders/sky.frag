precision highp float;

// 户外天空：用 1K equirect HDR 直接填充 MRT 的 3 个附件。
// 不能直接用 three 的 scene.background：background pass 只写 1 个 output，
// 在 3 附件 MRT 下会被驱动丢弃。这里用天空球 + 本材质，显式写满 gAlbedo/gNormal/gMRAO。
uniform sampler2D uSkyMap;
uniform int uHasSkyMap;
uniform float uEnvIntensity;
uniform int uFurnace;

uniform vec3 cameraPosition;

in vec3 vWorldPos;
in vec3 vWorldNormal;
in vec2 vUv;

layout(location = 0) out vec4 gAlbedo;
layout(location = 1) out vec4 gNormal;
layout(location = 2) out vec4 gMRAO;

const float PI = 3.14159265359;

vec2 equirectUv(vec3 dir) {
  float u = atan(dir.z, dir.x) / (2.0 * PI) + 0.5;
  float v = asin(clamp(dir.y, -1.0, 1.0)) / PI + 0.5;
  return vec2(u, v);
}

void main() {
  // 天空球以相机为中心观察；方向 = 片元 - 相机。
  // 球半径远大于场景尺度，方向近似等于视线方向。
  vec3 dir = normalize(vWorldPos - cameraPosition);
  vec3 color = vec3(0.0);
  if (uFurnace == 1) {
    // 白炉：环境视为纯白，天空也必须参与能量守恒测试
    color = vec3(1.0);
  } else if (uHasSkyMap == 1) {
    color = texture(uSkyMap, equirectUv(dir)).rgb;
  }

  gAlbedo = vec4(color * uEnvIntensity, 1.0);
  // 天空不是可着色表面；写入中性值，避免 G-buffer 调试视图里出现 NaN / 伪法线。
  gNormal = vec4(0.5, 0.5, 1.0, 1.0);
  gMRAO = vec4(0.0, 1.0, 1.0, 0.0);
}
