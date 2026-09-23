# 光照与全局光照 · Web 端作品集 任务清单

> 来源：`ref_file/gi-lighting-handbook.html`（理论体系 + 规划 + 技术栈选型）、`ref_file/gi-portfolio-plan.html`（各方向实现细节）
> 工作量为估算值（已有 WebGL 基础、每天 4–6 小时），单位为工作日。完整主线排期 14–20 周。

---

## 一、已锁定技术决策

| 项 | 决定 | 说明 |
| --- | --- | --- |
| 前端栈 | **R3F + Vite + three.js + React + TypeScript** | 用户指定并锁定 |
| 实现路线 | **混合实现** | three.js 管底座与资源；光照算法全部自写 shader；另加一个体量很小的原生 WebGL2 原理复现页作加分项 |
| 职责边界 | 框架负责：场景图与相机、资源与纹理、后处理链、PMREM 与内置阴影。自写：GGX BRDF、PCSS/CSM、Clustered 剔除、SSR ray march、SSGI、降噪 | 评审真正看的是自写部分 |
| 渲染姿势 | **自建 pass**：自管 `WebGLRenderTarget` 与后处理链，不依赖 EffectComposer 一把梭 | 多光源剔除、deferred、SSGI、降噪都在此姿势下做 |
| 后端 | 当前 WebGL2。**后端分叉只在 `src/core/renderer/createRenderer.ts` 一处** | 阶段 4 若确定要 compute（VXGI/DDGI/实时 PT），只改这一个文件切 `three/webgpu`，避免「WebGL2 版 + WebGPU 版两套代码」 |
| 色调映射 | `renderer.toneMapping = NoToneMapping`，后续在 `PostFX` 插槽自写 ACES/AgX 可切换 | 否则会与后处理链重复映射，画面发灰 |
| DPR | 上限 2 | 移动端瓶颈在带宽 |
| 状态共享 | 自写极简 store（`src/core/store.ts`），不引状态管理库 | 承载能力档位与 demo 参数 |
| 随机 | 固定 seed（`src/core/utils/random.ts`） | 服务 Playwright 视觉回归的确定性 |
| 目录组织 | 单包：`src/core`（共享基建）/ `src/demos`（各 demo）/ `src/site`（首页与模板） | monorepo 拆分推迟到 eng-shared |

### 风险与已知偏差

- **与手册建议的偏差**：手册 3.5 建议「复杂多 pass 页用 vanilla three」。本项目按用户要求统一走 R3F。缓解方式：渲染核心保持与 React 无关的 module/class，React 只负责挂载与 UI，避免 reconciler 与自建多 pass 管线互相打架。
- **`onBeforeCompile` 脆弱**：依赖 three 内部 chunk 命名，必须锁 three 版本、集中管理注入点、加冒烟测试（手册 3.7）。
- **构建体积**：当前产物 1.24 MB（gzip 355 kB）。后续用 `manualChunks` 拆出 three，并按需对 demo 做 code-split。
- **性能归因**：不要只看 `renderer.info`（不含 GPU 时间），需接 `EXT_disjoint_timer_query_webgl2` / WebGPU timestamp-query 自己测每个 pass。

### 验收命令

```bash
npm run dev        # 本地开发
npm run typecheck  # 类型检查
npm run build      # 生产构建
```

---

## 二、任务总览（按阶段）

### 阶段 0 · 底座（1–1.5 周）

- [~] **p0-base** 搭建渲染框架 + 构建部署 + 可复用 demo 模板 —— **骨架已落地**
  - [x] Vite + TS + React + R3F 工程与构建部署配置（含 `@/*` 别名、DPR 上限、sourcemap）
  - [x] `@/core` 共享基建：store / capabilities / createRenderer（后端单点分叉）/ CanvasRoot / PostFX 插槽
  - [x] **CameraRig**：2 个预设视角 + 自动巡航 + 轨道操作 + 键盘（数字键切预设、空格切巡航）
  - [x] **控制面板**组件：Panel（可折叠）/ Slider / Toggle / Select / Button
  - [x] **demoStore**：参数序列化进 URL query，只记录与默认值不同的项（可直接分享复现）
  - [x] **性能面板**：FPS / 帧时间 / draw call / 三角形 / DPR / 能力位（GPU 时间待接）
  - [x] **Hud** 四角插槽 + 全站能力档位徽标（降级路径显式标注）
  - [x] **SceneAsset**：统一场景加载入口（GLTF + Draco）+ 程序化占位回落
  - [x] **站点**：首页卡片（按层级分组、3 标签、关键指标）、DemoPage（八块内容模板）、导航
  - [x] **hello-cube** 冒烟 demo（验证全链路：画布 / 相机 / 面板 / URL / 性能）
  - [ ] 多级降级路径骨架（WebGPU → WebGL2 → 烘焙结果 → 视频）→ p5-final 补完
  - [ ] 截图 / 录制工具接口（封面 GIF + 视觉回归）→ eng-shared 接入
  - [ ] monorepo 拆分 → eng-shared
- [ ] **p0-hdr** HDR 管线与色调映射（ACES / AgX、自动曝光、物理 bloom）
- [ ] **p0-gbuffer-hud** G-buffer MRT + 性能 HUD（帧时间 / 各 pass 耗时 / GPU 计时）
- [ ] **p0-assets** 准备 3 个场景资产（Cornell box / 室内 / 户外）

### 阶段 1 · 直接光照（2–3 周）

- [ ] **p1-pbr-ibl** PBR（Cook-Torrance / GGX + Smith + Schlick）+ IBL（split-sum / PMREM）+ 白炉测试
- [ ] **p1-shadow** 阴影全家桶（SM / PCF / PCSS / CSM / VSM + 三种 bias 补偿）
- [ ] **p1-light-ssr** 多光源与剔除（Forward / Deferred / Clustered 三档）+ SSR

### 阶段 2 · 观感增量（2–3 周）

- [ ] **p2-gtao** GTAO / HBAO（水平角积分 + 多次弹射近似）
- [ ] **p2-vfx** SSS 次表面散射 / 体积光雾 / 折射色散玻璃

### 阶段 3 · GI 主线（3–4 周） ⚠️ 烘焙先做，保证兜底

- [ ] **p3-bake** 烘焙 lightmap + SH 探针（先做兜底）+ 烘焙器 Node CLI
- [ ] **p3-ssgi** SSGI + 降噪器（SVGF / à-trous）

### 阶段 4 · 深水区（4–6 周） ⚠️ 四选一，只做深一条

- [ ] **p4-deep** VXGI / SDF GI / DDGI / 实时 PT（四选一，需 WebGPU；届时在 `createRenderer.ts` 单点切后端）

### 阶段 5 · 收尾（2 周）

- [ ] **p5-final** 移动端适配 + 多级降级路径 + 视觉 / 性能回归

### 工程加分项（贯穿全程）

- [ ] **eng-shared** 共享基建完善（monorepo / 统一 HUD / 控制面板 / 截图工具 / shader 变体管理）+ 资产脚本化流水线
- [ ] **eng-webgpu** WebGPU 覆盖实测 + 降级路径标注（每个 demo 显式档位）

---

## 三、参考：规划约束

### 推荐主线组合（6 个成品）

HDR/色调映射底座 → PBR + IBL → 阴影全家桶 → 烘焙 lightmap + SH 探针 → GTAO / SSGI → 一条深水方向（VXGI / SDF / DDGI / 实时 PT 四选一）

### 三条筛选标准（挑选方向时反复对照）

1. **有可验证的正确性**：能用参考解对照（Cornell box 收敛、能量守恒、白炉测试）。
2. **有可视化的中间量**：G-buffer、cascade 分层、探针图集、SDF 切片、方差图。
3. **有真实的性能故事**：讲清为什么掉帧、怎么优化、降级到什么档位。

### Web 端可行性红线（影响技术栈选型）

- WebGL2 无 compute shader → VXGI / DDGI / 实时 PT 直接上 WebGPU。
- 无硬件光线追踪 → 路径追踪都需 compute + 累积 / 离线烘焙。
- 3D 纹理可用但代价高 → 分辨率保守（64³–128³）。
- 移动端瓶颈在带宽 → ray march 半分辨率、MRT 2–3 张、KTX2/ASTC 压缩、DPR 上限 2。
- WebGPU 覆盖要实测，每个 demo 配降级路径并显式标注。
- 精度与噪声：半精度累积会引入条带，TAA / 累积类优先 WebGPU，用抖动 + 蓝噪声缓解。

### 每个 Demo 必备 8 块内容

1. 一句话问题陈述
2. 算法概要 + 关键公式
3. 实时画布（2 预设视角 + 1 自动巡航，鼠标/触控/键盘均可）
4. 交互控制面板（状态序列化进 URL query）
5. 中间量可视化（调试视图下拉）
6. 性能面板（帧时间 / pass 分解 / draw call / 显存 / 分辨率缩放）
7. 局限与已知问题（诚实列出失效案例）
8. 源码与参考（shader 片段、论文出处、资产来源）

### 三个常见坑

1. 同时追 VXGI 和 DDGI —— 二者都需要世界空间辐照度缓存，应先抽象出这一层再二选一。
2. 低估场景资产工作量 —— 先用现成场景（Sponza、Cornell、Bistro）验证算法，再自制场景。
3. 只放最终画面不放中间量 —— 损失掉大部分说服力。
