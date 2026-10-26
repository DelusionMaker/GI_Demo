// gbuffer_debug.glsl —— G-buffer 调试视图
//
// 由 gbuffer.frag 经 #include 拼入；把 main 里的调试 early-return 分支抽成函数，
// 让主管线保持干净。命中调试视图时写 gAlbedo 并返回 true（main 据此提前结束）。
//
// 依赖编排器声明的 out 变量 gAlbedo、uniform uDebugNormals / uShadowDebugCascade，
// 以及 gbuffer_shadow.glsl 的 shadowCascadeIndex（故本模块须在其后 #include）。

bool applyGbufferDebug(vec3 N, vec3 worldPos) {
  // ── 调试：法线视图（demo 的「法线（中间量）」档位）──
  // MRT 下帧缓冲有 3 个活动 draw buffer，任何材质都必须写满 3 个 out，
  // 因此调试视图也不能换回 three 内建材质（只写 1 个 out 会直接
  // GL_INVALID_OPERATION 且该 draw 被丢弃）。这里让 gAlbedo 输出编码法线，
  // 经下游 HDR 链呈现即得法线图。gNormal/gMRAO 在 main 里已写满，可提前返回。
  if (uDebugNormals == 1) {
    gAlbedo = vec4(N * 0.5 + 0.5, 1.0);
    return true;
  }

  // ── 调试：cascade 分层着色（中间量视图）──
  // 每个级联一个颜色，超出阴影距离的像素压暗；用于检查 CSM 覆盖范围与接缝。
  if (uShadowDebugCascade == 1) {
    int ci = shadowCascadeIndex(worldPos);
    vec3 tint = vec3(0.08, 0.09, 0.11);
    if (ci == 0) tint = vec3(0.98, 0.42, 0.30);
    else if (ci == 1) tint = vec3(0.35, 0.78, 0.98);
    else if (ci == 2) tint = vec3(0.52, 0.90, 0.45);
    else if (ci == 3) tint = vec3(0.95, 0.86, 0.35);
    gAlbedo = vec4(tint, 1.0);
    return true;
  }

  return false;
}
