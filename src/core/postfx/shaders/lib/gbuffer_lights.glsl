// gbuffer_lights.glsl —— p1-light-ssr S2：Clustered 多光源（cluster-fetch + 逐灯贡献）
//
// 由 gbuffer.frag 经 #include 拼入，且必须排在 gbuffer_debug.glsl 之前（调试视图会调用
// getClusterIndex）。只含函数定义，不重复声明 uniform / precision / out。
// 依赖编排器声明的 uLightData* / uClusterLightGrid / uClusterLightIndices / uClusterDims /
// uViewNear / uViewFar / uShadowLightIndex，以及 gbuffer_shadow.glsl 的 shadowFactor、
// gbuffer_brdf.glsl 的 distributionGGX / geometrySmith / fresnelSchlick。

const int CLUSTER_TILE_SIZE = 16;  // 必须与 clusterCulling.ts 的 CLUSTER_TILE_SIZE 一致
const int CLUSTER_TEX_WIDTH = 2048; // 必须与 clusterCulling.ts 的 CLUSTER_TEX_WIDTH 一致

// 线性 cluster / 灯号索引 → 数据纹理 2D 坐标（两张纹理同宽 CLUSTER_TEX_WIDTH）
ivec2 clusterTexCoord(int lin) {
  return ivec2(lin % CLUSTER_TEX_WIDTH, lin / CLUSTER_TEX_WIDTH);
}

// fragCoord（物理像素）+ 视图空间深度 → 线性 cluster 索引
// 与 clusterCulling.ts 的线性编号一致：idx = tileX + tileY*gridW + slice*gridW*gridH
int getClusterIndex(vec2 fragCoord, float viewZ, vec3 dims, float near, float far) {
  int gw = int(dims.x);
  int gh = int(dims.y);
  int zs = int(dims.z);
  ivec2 tile = ivec2(fragCoord.xy / float(CLUSTER_TILE_SIZE));
  tile = clamp(tile, ivec2(0), ivec2(gw - 1, gh - 1));
  float z = max(viewZ, near);
  float t = clamp(log(z / near) / log(far / near), 0.0, 1.0);
  int slice = clamp(int(floor(t * float(zs))), 0, zs - 1);
  return tile.x + tile.y * gw + slice * gw * gh;
}

// 单灯贡献（复用 D/G/F；与 S1 暴力路径逐字节等价，仅「循环来源」不同）
// TODO(作品集 · p1-light-ssr): 多灯能量守恒 / 逐灯 specular 重要性采样（当前朴素叠加）
vec3 lightContribution(int li, vec3 N, vec3 V, float NoV, vec3 albedo, float metalness, float roughness, vec3 F0, vec3 worldPos) {
  vec3 lPos = uLightData0[li].xyz;
  float lRange = uLightData0[li].w;
  vec3 lColor = uLightData1[li].rgb;
  float lType = uLightData1[li].w; // 0 = 平行光 / 1 = 点光 / 2 = 聚光
  vec3 lDir = uLightData2[li].xyz;
  float lCosIn = uLightData2[li].w;
  float lCosOut = uLightData3[li].x;

  vec3 L;
  float attenuation = 1.0;
  if (lType < 0.5) {
    // 平行光：方向恒定，无距离衰减
    L = normalize(lDir);
  } else {
    vec3 toLight = lPos - worldPos;
    float dist = length(toLight);
    L = toLight / max(dist, 1e-4);
    // TODO(作品集 · p1-light-ssr): 物理正确的点光/聚光衰减（inverse-square + 距离窗）
    float window = (lRange > 0.0)
      ? pow(clamp(1.0 - pow(dist / lRange, 4.0), 0.0, 1.0), 2.0)
      : 1.0;
    attenuation = window / (dist * dist + 1.0);
  }

  // 聚光锥角（方向从灯射出，与 -L 比较）
  if (lType > 1.5) {
    float cosAngle = dot(-L, normalize(lDir));
    attenuation *= smoothstep(lCosOut, lCosIn, cosAngle);
  }

  float NoL = max(dot(N, L), 0.0);
  if (NoL <= 0.0) return vec3(0.0);

  vec3 H = normalize(L + V);
  float NoH = max(dot(N, H), 0.0);
  float VoH = max(dot(V, H), 0.0);

  float D = distributionGGX(NoH, roughness);
  float G = geometrySmith(NoV, NoL, roughness);
  vec3 F = fresnelSchlick(VoH, F0);

  vec3 specular = (D * G * F) / (4.0 * NoV * NoL + 1e-4);
  vec3 kD = (vec3(1.0) - F) * (1.0 - metalness);
  vec3 diffuse = kD * albedo / PI;

  vec3 c = (diffuse + specular) * lColor * NoL * attenuation;

  // 阴影：仅主平行光（阴影投射光）生效
  if (li == uShadowLightIndex && lType < 0.5) {
    c *= shadowFactor(N, L, worldPos);
  }

  return c;
}
