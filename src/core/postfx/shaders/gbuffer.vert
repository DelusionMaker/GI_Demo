// G-buffer 顶点着色器（GLSL ES 3.00）。
//
// 以 RawShaderMaterial + glslVersion: GLSL3 加载：three 只注入 `#version 300 es`，
// 不注入内置矩阵/属性，故 position / normal / uv / 各矩阵都需自声明（与全屏 pass 一致）。
// three 仍会按 uniform 名自动上传 modelMatrix / modelViewMatrix / projectionMatrix /
// viewMatrix / normalMatrix / cameraPosition 的值，只要着色器里声明了它们。

precision highp float;

in vec3 position;
in vec3 normal;
in vec2 uv;

uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat3 normalMatrix;

out vec3 vWorldNormal;
out vec3 vWorldPos;
out vec2 vUv;

void main() {
  vUv = uv;

  // 世界空间法线：用 modelMatrix 的左上 3x3 近似（假设无非均匀缩放）。
  // TODO(S2 · 你来写)：非均匀缩放场景应改用 transpose(inverse(mat3(modelMatrix)))。
  vWorldNormal = normalize(mat3(modelMatrix) * normal);

  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;

  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
