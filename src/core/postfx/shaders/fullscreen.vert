#version 100
// 全屏 pass 的通用顶点着色器。
// 刻意忽略所有矩阵：顶点位置直接解释为裁剪空间坐标，
// uv 由位置推导，因此不需要 uv 属性，也不需要相机参与运算。
// 本文件以 RawShaderMaterial 加载（自建管线，不引 three 的内置前缀），
// 因此 position 必须自己声明；three 会从几何的 'position' 属性绑定上来。
precision highp float;

attribute vec3 position;

varying vec2 vUv;

void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
