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

  // ── 调试：Clustered（p1-light-ssr S2 中间量视图）──
  // 0=关 / 1=tile 叠加 / 2=每 cluster 灯数热力
  if (uClusterDebug != 0) {
    float viewZ = -(viewMatrix * vec4(worldPos, 1.0)).z; // 视图空间深度（正）
    int cidx = getClusterIndex(gl_FragCoord.xy, viewZ, uClusterDims, uViewNear, uViewFar);
    int count = int(texelFetch(uClusterLightGrid, clusterTexCoord(cidx), 0).g);
    if (uClusterDebug == 1) {
      // tile 叠加：橙色边框（与 ShadowDebugPass 同款 overlay 风格）
      vec2 tileF = gl_FragCoord.xy / float(CLUSTER_TILE_SIZE);
      vec2 f = fract(tileF);
      float border = max(
        max(step(0.94, f.x), step(f.x, 0.06)),
        max(step(0.94, f.y), step(f.y, 0.06))
      );
      vec3 base = vec3(0.02, 0.02, 0.03);
      gAlbedo = vec4(mix(base, vec3(0.98, 0.60, 0.20), clamp(border, 0.0, 1.0)), 1.0);
    } else {
      // 热力：灯数映射到蓝→红
      float t = clamp(float(count) / 16.0, 0.0, 1.0);
      vec3 cool = vec3(0.10, 0.30, 0.90);
      vec3 hot = vec3(0.95, 0.20, 0.15);
      gAlbedo = vec4(mix(cool, hot, t), 1.0);
    }
    return true;
  }

  return false;
}
