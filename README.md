# GI Portfolio · WebGL2 实时 PBR / IBL 实验

![户外 HDRI IBL](docs/images/outdoor-ibl-on.png)

用 WebGL2 / three.js 自建 pass 链的实时渲染作品集。当前完成 **三附件 G-buffer MRT + 自写 Cook-Torrance 直接光 + split-sum IBL + HDR 后处理**，用 Cornell Box 做正确性参考、用 Poly Haven HDRI + LittlestTokyo 做真实资产验证。

> **状态边界**：当前是「直接光 + IBL」，不是完整 GI。阴影、SSR、SSGI、Sponza 室内场景在 roadmap 中，站点会明确标注；不把规划写成已完成。

## 演示入口

默认 `/d/hello-cube` 会进入 **演示模式**：只保留切场景、IBL 开关、白炉读数；右上角「技术模式」可展开完整 HDR / 性能 / G-buffer 面板。`/d/pbr-ibl` 默认就是 **户外 + IBL + ACES**，`/d/hello-cube` 保留 Cornell 参考场景；显式 query 可覆盖这两个默认值。

| 入口 | 用途 |
| --- | --- |
| `/d/pbr-ibl?scene=outdoor&env=1&tm=aces` | 户外 hero：1K HDRI + LittlestTokyo + IBL |
| `/d/pbr-ibl?scene=outdoor&env=0&presentation=1` | 同一机位的 IBL 关闭对照，打开后看金属球反射 |
| `/d/pbr-ibl?scene=cornell&furnace=1&presentation=1` | 白炉：环境纯白、直接光关闭、albedo 强制 1 |
| `/d/hello-cube?scene=outdoor&env=1&presentation=0` | 技术模式：G-buffer 调试 / HDR 链路 / 逐 pass 计时 |
| `?tm=aces` | 把默认线性输出切到 ACES；户外 hero 建议加上 |

截图中的机位：`城市`（hero）、`IBL 球列`（粗糙度扫掠特写）、`全景`、`低角度`，数字键 `1–4` 切换。

## 已实现

- **G-buffer MRT**：3 附件（gAlbedo / gNormal / gMRAO）+ 可采样深度；所有进入 beauty 的材质都写满 3 个 fragment output。
- **直接光 PBR**：GGX 法线分布 + Smith 几何遮蔽 + Schlick 菲涅尔；从真实 three.js 灯光同步主光参数。
- **IBL split-sum**：256² HalfFloat cube + mip 链；roughness→LOD、Karis EnvBRDFApprox；漫反射用高 LOD 平均 radiance × π 归一化。
- **真实资产**：Poly Haven CC0 HDRI（1K equirect）+ LittlestTokyo（CC BY 4.0，Draco，约 171k 三角形）；`SkeletonUtils` 克隆蒙皮、traverse 替换 `GBufferMaterial`、baseColor / alphaTest / side。
- **天空**：天空球直接采样 1K equirect HDR，显式写满 3 个 MRT 附件（不用 `scene.background`）。
- **白炉读数**：HUD 显示中心亮度 / 全帧几何均值 / 相对 1.000 的偏差；Playwright 在真实测光回读后校验。
- **演示模式**：默认隐藏调试 HUD；技术模式恢复 HDR 链路、性能面板、G-buffer 调试。
- **HDR 后处理**：RGBA16F → 自动曝光 / 直方图 / ACES / AgX / Bloom；旁路 A/B 与逐 pass 计时。
- **自动化验证**：11 个 Playwright 用例覆盖 HDR / G-buffer / 白炉 / 户外 IBL / 演示模式 / pbr-ibl 默认入口。

## 渲染链路

```text
three.js 场景（GBufferMaterial / SkyMaterial）
        │
        ▼
BeautyPass: 3× MRT（gAlbedo 最终着色 / gNormal / gMRAO）+ depth
        │                         │
        │                         └─ G-buffer 调试视图（原始附件）
        ▼
HDRPipeline: luminance（测光 / 白炉读数）→ bloom → tonemap-output
        │
        ▼
canvas（sRGB）
```

自建链与场景直出共用同一批 GBufferMaterial；旁路路径用于像素级 A/B，证明后处理没有改变画面语义。

## 验证数据

| 项目 | 结果 |
| --- | --- |
| Playwright | **11 passed** |
| 白炉中心亮度 | **0.978**（**-2.20%**，目标 ±2%，略超） |
| 白炉全帧几何均值 | HUD 实时显示（含天空 / 暗部，不是 ±% 判据） |
| 户外 IBL 关 / 开 亮度均值 | 123.76 / 134.78 |
| 户外 IBL A/B | 平均差 **12.166**，差异 > 8 像素 **≈59.03%** |
| 自建链 vs 直出（Cornell） | 线性域平均差 **≈0.25**，> 8 像素 **≈0.25%** |
| 构建 | 658 modules；1,346.45 kB / gzip 388.13 kB |

这些是**回归指标**，不是画质评分；白炉读数会随材质的 roughness 变化，HUD 会显示当前粗糙度。

## 性能

开发 / CI 的 headless Chromium 使用 SwiftShader，**不能作为作品集性能数据**。需要在真实 GPU 上运行技术模式，记录下表：

| 场景 | 分辨率 / DPR | Draw calls | 三角形 | GPU 总 ms | 备注 |
| --- | --- | --- | --- | --- | --- |
| Cornell | 待填 | 待填 | 待填 | 待填 | 8 个参考 mesh + 探针 |
| 户外 | 待填 | 约 79 | 约 171k | 待填 | IBL 开 / 关各一组 |
| Bloom / 后处理 | 待填 | — | — | 待填 | 开 / 关各一组 |

采集方式：`?presentation=0` 打开技术模式，看右上角 PerfPanel 的 GPU 计时（需要 `EXT_disjoint_timer_query_webgl2`），每项至少记录 3 次取中位数。首屏资产约 6.5 MB（HDR 1.17 MB + GLB 4.13 MB + Draco 解码器）。

## 资产与许可

- HDRI：**Poly Haven** `kloppenheim_06_puresky_1k.hdr`，CC0，<https://polyhaven.com/hdris>
- 模型：**LittlestTokyo**，Glen Fox / three.js，**CC BY 4.0**，<https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf>
- Draco 解码器：Apache 2.0，来自 three.js
- 完整来源与用途：`public/assets/CREDITS.md`

LittlestTokyo 与 HDRI 是第三方资产，**不能声称原创**；公开部署时请保留署名与许可链接。代码本身目前未附 LICENSE，作为作品集展示使用。

## 开发

```bash
npm install
npm run dev        # 本地开发
npm run typecheck
npm run smoke      # Playwright；截图写到 e2e/screenshots（不入库）
npm run build
```

`public/` 需要包含 `hdr/`、`assets/`、`draco/`；`docs/images/` 是 README / case study 用的整理稿截图。

浏览器要求：WebGL2；MRT / HDR 需要 `EXT_color_buffer_float`。不支持时降级单目标，G-buffer 选项隐藏；HDR cube 失败时 IBL 回退 RoomEnvironment，天空仍保留 equirect HDR。

## 目录

```text
src/core/postfx/        Pipeline、BeautyPass、HDR 链、GBufferMaterial / SkyMaterial、IBL 环境
src/core/scene/         CornellBox / OutdoorScene / GltfScene / SceneAsset
src/core/camera/        CameraRig（预设机位 / 数字键 / 巡航）
src/demos/hello-cube/   演示 Stage、HUD、演示模式、白炉读数
src/site/               demo 元数据与页面
e2e/                    冒烟、像素 A/B、白炉、演示模式测试
docs/images/            README 用截图
```

## 下一步

1. **Sponza 室内**：材质补 normal / metallicRoughness / emissive / 透明混合，贴图 1K + KTX2，控制 ~15–20 MB。
2. **阴影 / SSR**：`p1-shadow` 与 `p1-light-ssr`；当前 Cornel 顶灯仍是几何占位。
3. **性能**：真实 GPU 上补完上表；再决定是否需要 GGX 重要性采样预滤波。
4. **完整 GI**：SSGI / 探针 / 烘焙；到那一步才把「GI」作为主标题。

## Case study

实现细节、两个关键 debug 故事（`uEnvMap` 命名导致环境贴图静默失绑、相机 target 未收敛）、设计取舍与局限见 [CASE_STUDY.md](CASE_STUDY.md)。
