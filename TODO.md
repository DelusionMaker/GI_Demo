# 光照与全局光照 · Web 端作品集 任务清单

> 来源：`ref_file/gi-lighting-handbook.html`（理论体系 + 规划 + 技术栈选型）、`ref_file/gi-portfolio-plan.html`（各方向实现细节）
> 工作量为估算值（已有 WebGL 基础、每天 4–6 小时），单位为工作日。完整主线排期 14–20 周。

---

## 一、已锁定技术决策

| 项 | 决定 | 说明 |
| --- | --- | --- |
| 前端栈 | **R3F + Vite + three.js + React + TypeScript + MobX** | 用户指定并锁定 |
| 实现路线 | **混合实现** | three.js 管底座与资源；光照算法全部自写 shader；另加一个体量很小的原生 WebGL2 原理复现页作加分项 |
| 职责边界 | 框架负责：场景图与相机、资源与纹理、后处理链、PMREM 与内置阴影。自写：GGX BRDF、PCSS/CSM、Clustered 剔除、SSR ray march、SSGI、降噪 | 评审真正看的是自写部分 |
| 渲染姿势 | **自建 pass**：自管 `WebGLRenderTarget` 与后处理链，不依赖 EffectComposer 一把梭 | 多光源剔除、deferred、SSGI、降噪都在此姿势下做 |
| 后端 | 当前 WebGL2。**后端分叉只在 `src/core/renderer/createRenderer.ts` 一处** | 阶段 4 若确定要 compute（VXGI/DDGI/实时 PT），只改这一个文件切 `three/webgpu`，避免「WebGL2 版 + WebGPU 版两套代码」 |
| 色调映射 | `renderer.toneMapping = NoToneMapping`，后续在 `PostFX` 插槽自写 ACES/AgX 可切换 | 否则会与后处理链重复映射，画面发灰 |
| DPR | 上限 2 | 移动端瓶颈在带宽 |
| 状态共享 | **MobX 7**（`mobx` + `mobx-react-lite`）：store 用类 + `makeObservable` 显式注解，组件用 `observer()` 订阅 | 承载能力档位、demo 参数（含 URL 序列化）、性能面板采样 |
| 状态管理注意 | 注解值必须是 `Annotation` 对象（不接受字符串）；v6 的 `action.bound` 已移除，改用 `actionBound` | 见 README「状态管理」一节 |
| 每帧数据 | `perfStats` 刻意保持非响应式，由 `perfStore` 按 5Hz 采样成 observable | 否则每帧写 observable 会引发每帧重渲染 |
| 随机 | 固定 seed（`src/core/utils/random.ts`） | 服务 Playwright 视觉回归的确定性 |
| 目录组织 | 单包：`src/core`（共享基建）/ `src/demos`（各 demo）/ `src/site`（首页与模板） | monorepo 拆分推迟到 eng-shared |

### 风险与已知偏差

- **与手册建议的偏差**：手册 3.5 建议「复杂多 pass 页用 vanilla three」。本项目按用户要求统一走 R3F。缓解方式：渲染核心保持与 React 无关的 module/class，React 只负责挂载与 UI，避免 reconciler 与自建多 pass 管线互相打架。**该缓解方案在 p0-hdr 落地时正式执行，见「三」的方案 A。**
- **`onBeforeCompile` 脆弱**：依赖 three 内部 chunk 命名，必须锁 three 版本、集中管理注入点、加冒烟测试（手册 3.7）。
- **构建体积**：当前产物 1.29 MB（gzip 368 kB，含 MobX）。后续用 `manualChunks` 拆出 three，并按需对 demo 做 code-split。
- **MobX 7 是新主版本**：注解值必须是 `Annotation` 对象（v6 允许的 `"action.bound"` 字符串写法已失效），绑定动作改用 `actionBound`。新增 store 时不要照抄 v6 示例。
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
  - [x] `@/core` 共享基建：capabilities / createRenderer（后端单点分叉）/ CanvasRoot / PostFX 插槽 / MobX store 层
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
- [ ] **p0-hdr** HDR 管线与色调映射（ACES / AgX、自动曝光、物理 bloom）　**← 下一步，拆解见「三」**
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

## 三、p0-hdr 拆解（下一步）

### 3.0 目标与验收定位

**这一轮的目标不是「画面变好看」，而是让项目最核心的技术主张落地：自建 pass + 自写 shader。**

现状事实（动手前先认清）：

| 已就位 | 仍然是零 |
| --- | --- |
| 工程脚手架、构建部署、R3F 封装 | **自建多 pass 管线**（全项目零 `WebGLRenderTarget` / `setRenderTarget`） |
| 相机装置、控制面板、URL 序列化、MobX store 层 | **一行自写 shader**（`hello-cube` 用的是内置 `meshStandardMaterial` + 内置灯） |
| 能力探测（`colorBufferFloat` / `floatLinear` / `timerQuery` 已在探测） | `PostFX.tsx` 定义了但从未被挂载（纯 stub） |

**为什么先做这一项：**

1. 它是文档推荐主线的第 1 环（HDR/色调映射底座 → PBR+IBL → 阴影 → 烘焙 → SSGI → 深水区）。
2. 它是唯一一个**能强制把 pass 框架带出来**的任务。后面所有东西（G-buffer、Clustered、SSGI、降噪、VXGI）都要挂在这条链上；现在建对，比阶段 3 重构便宜百倍。
3. **可独立验证**（命中筛选标准第 1 条）：曲线可画出来对照、过曝回收可用 EV 阶梯验证、直方图可回读。
4. 工作量小（2–3 天），架构收益最大。

**前置依赖已就绪**：能力探测、`PostFX` 插槽、`perfStore` 5Hz 采样都已具备。**本轮不需要改动 store 层**（除给 HDR 参数加一个 `createDemoStore`）。

---

### 3.1 动手前必须先定的架构决策：Pipeline 与 React 的边界

手册 3.5 / 3.7 警告过「R3F 的 reconciler 与顺序敏感的自建多 pass 管线容易打架」，`p0-hdr` 正是这个矛盾第一次爆发的地方（要在一个 `useFrame` 里接管渲染顺序）。

- **方案 A（采纳）**：pass 链写成**与 React 无关的模块** —— `Pipeline` 类，只依赖 `WebGLRenderer` / `Scene` / `Camera`，暴露 `render()`；React 侧仅用 `useFrame(..., priority)` 驱动它，并把参数同步进去。
  - 收益：可脱离 React 单测；阶段 4 切 WebGPU 时不用动；`onBeforeCompile` 类脆弱注入能集中管理。
- 方案 B（否决）：用 `@react-three/postprocessing` / `postprocessing` 生态库。快，但与「自写 shader」诉求冲突，且多 pass 顺序不好控 —— 会削弱作品集最该展示的部分。

**硬约束：`src/core/renderer/Pipeline.ts` 及其 passes 目录下不得 `import` 任何 React 相关模块。**

---

### 3.2 Pipeline 接口签名（目标形态）

```ts
// src/core/renderer/Pipeline.ts —— 与 React 完全无关
import type * as THREE from 'three'

export type TargetFormat = 'RGBA16F' | 'RGBA8'

export interface PassContext {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.Camera
  /** 已按 DPR 换算的像素尺寸 */
  width: number
  height: number
  /** 帧序号：供时域抖动 / 蓝噪声 / 隔帧异步回读使用 */
  frame: number
  /** 上一帧生效的曝光值（EV）。自动曝光有 1 帧延迟，这是有意为之 */
  exposure: number
}

export interface Pass {
  readonly name: string
  /** 由控制面板 / URL 参数驱动 */
  enabled: boolean
  /** 分辨率缩放：1 = 全分辨率，0.5 = 半分辨率（ray march / bloom 用） */
  scale: number
  /** 'scene' = 把场景直接渲进本环；'prev' = 取上一环输出 */
  source: 'scene' | 'prev'
  /** 对 RenderTarget 的格式需求，由 Pipeline 按需分配并复用 */
  target: { format: TargetFormat; filter: 'linear' | 'nearest' }
  setup?(ctx: PassContext): void
  /** 渲进 target 并返回本环输出纹理（通常是 target.texture） */
  render(ctx: PassContext, target: THREE.WebGLRenderTarget): THREE.Texture
  /** GPU 计时归因，由 p0-gbuffer-hud 接入后填充 */
  lastGpuMs?: number
  dispose(): void
}

export class Pipeline {
  constructor(renderer: THREE.WebGLRenderer)

  addPass(pass: Pass, index?: number): void
  removePass(name: string): void
  getPass<T extends Pass = Pass>(name: string): T | undefined

  /** 按注册顺序执行。内部 ping-pong 复用 RenderTarget，禁止每帧新建 */
  render(scene: THREE.Scene, camera: THREE.Camera): void
  /** 尺寸 / DPR 变化时重建 RenderTarget；由 CanvasRoot 的 resize 事件驱动 */
  resize(width: number, height: number, dpr: number): void

  /** 中间量可视化：直接显示某个 pass 的输出；null = 走完整链 */
  debugPass: string | null
  /** 整条链旁路，用于 A/B 对比「改造前」的 8bit 直出路径 */
  bypass: boolean

  /** 各环耗时，供性能面板消费 */
  readonly stats: { passes: Array<{ name: string; ms: number }>; totalMs: number }
  dispose(): void
}
```

配套文件：`src/core/renderer/FullscreenQuad.ts`（自写全屏三角/四边形 + `RawShaderMaterial` 基类，不引 three 的 pass 基类）、`src/core/renderer/passes/*.ts`。

---

### 3.3 Pass 顺序（p0-hdr 阶段）

```
scene ──► ① scene      HDR RT (RGBA16F, scale 1.0)   ← 不做任何色调映射
       ──► ② luminance  ↓ 降采样 (scale 0.25) ──► 异步回读 → EV（1 帧延迟）
       ──► ③ bloom      HDR 域内：阈值提取 → mip 链下采样 → 上采样相加 (scale 0.5)
       ──► ④ tonemap    ACES / AgX / Reinhard 可切换 + EV → LDR RT (RGBA8, scale 1.0)
       ──► ⑤ output     sRGB 编码 + 抖动 → 屏幕
```

| # | pass | source | scale | 目标格式 | 说明 |
| --- | --- | --- | --- | --- | --- |
| ① | `scene` | scene | 1.0 | RGBA16F | `renderer.toneMapping` 必须保持 `NoToneMapping` |
| ② | `luminance` | prev | 0.25 | RGBA16F | log 平均亮度 → 自动曝光；**必须隔帧异步回读**，不得每帧 `readPixels` |
| ③ | `bloom` | prev | 0.5 | RGBA16F | **在 tonemap 之前**（HDR 域内做才物理正确）；6–8 级 mip |
| ④ | `tonemap` | prev | 1.0 | RGBA8 | 曲线 + 曝光，只做一次映射 |
| ⑤ | `output` | prev | 1.0 | — | sRGB 编码 + 抖动，直接出屏 |

**已知取舍（写进 demo 的 limitations）：** bloom 放在 tonemap 之前物理正确但更贵；若移动端吃紧，可挪到 tonemap 之后并如实标注这是 LDR 近似。

---

### 3.4 落地步骤（含每步验收点）

| 步骤 | 内容 | 验收点 | 状态 |
| --- | --- | --- | --- |
| **S1** | `Pipeline` + `Pass` + `FullscreenQuad` 抽象；场景渲进 RGBA16F；`PostFX` 从直通改为挂载 Pipeline；`CanvasRoot` 接上 `flat` 与 resize | 画面与直出路径一致；HUD 显示 HDR 档位；不支持浮点时回落 RGBA8 并在 HUD 标注 | ✅ **代码完成**（浏览器内验证待补，见 3.4.1） |
| **S2** | 曝光滑杆 / 曲线下拉 / URL 序列化 / 曲线对照图已接通；**曲线数学已实现**（Reinhard 本来正确；ACES 修正公式 + 去 `f` 后缀；AgX 补成完整 Sobotka 拟合，含原色变换矩阵）；**过曝回收诊断视图**（映射前 >1 像素染红，采用 shader 方案 a） | 三条曲线形状正确（Reinhard 无 shoulder、ACES 有 toe/shoulder、AgX 更陡）；EV 变化时整体亮度单调 | ✅ 完成（曲线 + 过曝回收诊断） |
| **S3** | `passes/LuminancePass.ts`（降采样 + log 平均 + 隔帧异步回读，旁路透传不截断主链）；直方图面板；自动曝光（middle-gray 补偿 + 指数平滑）；「过曝回收」A/B 对比开关 | EV 从 −4 扫到 +4 时高光**不截断**（对比 8bit 路径的死白/色块）；直方图随 EV 平移；自动曝光 1–2 帧收敛、无可见振荡 | ✅ 代码完成（浏览器内验证待补，见 DEVLOG 2026-10-06） |
| **S4** | `passes/BloomPass.ts`（HDR 域内阈值 + 6 级 mip 下采样 + 上采样合成，框架已搭）；`bloom` / `bloomIntensity` 旋钮已接 | mip 链各级可缩略图可视化；关闭时高光边界硬、开启后柔和不糊；给出 bloom 的耗时占比 | ✅ 框架就绪（阈值 soft-knee / 降采样 / 上采样三个算法段待你实现，见 DEVLOG 2026-10-06 p0-hdr S4） |
| **S5** | 收尾：`src/site/demos.ts` 的 `hdr` 条目 status → `done`，如实补 limitations（自动曝光迟滞、半精度暗部条带） | 站点上该 demo 不再显示「规划中」 | 0.5 天 |

#### 3.4.1 S1 完成记录

**交付物**

| 文件 | 来源 | 职责 |
| --- | --- | --- |
| `postfx/HDRPipeline.ts` | 步骤 1 既有，保留为门面 | 选 RT 格式 / 组装链路 / 对外公开 API（`hdrSupported`、`passTimes`、`setExposureEV`、`setTonemap`、`setSize`、`render`、`dispose`）。**无 React 依赖** |
| `postfx/Pipeline.ts` | 本次新增 | 通用多 pass 调度、RT 池化复用（按 format/filter/samples/depth/尺寸 分池）、`info` 手工重置、调试截断、bypass；`dispose` 刻意非终结（原因见踩坑 2） |
| `postfx/Pass.ts` | 本次新增 | `Pass` / `PassContext` / `PassTargetSpec` / `PassTiming` 类型契约 |
| `postfx/FullscreenQuad.ts` | 本次新增 | 全屏单三角形 + 通用顶点着色器（uv 由位置推导，忽略矩阵）；材质 `toneMapped = false` |
| `postfx/passes/BeautyPass.ts` | 步骤 1 的 beauty 段 | 链首：场景 → HDR 目标（`samples: 4` + `DepthTexture`，沿用既有决策） |
| `postfx/passes/TonemapOutputPass.ts` | 步骤 1 的输出段 | 链尾：EV + 曲线占位 + **手写分段**线性→sRGB（不依赖 three 内部 chunk 名） |
| `postfx/hdrStore.ts` | 本次新增 | 链路 UI 侧状态（MobX，5Hz 采样），承载档位标注与旁路 / 调试开关 |
| `postfx/HDRPanel.tsx` | 本次新增 | HUD 面板：RT 档位 / 旁路 / 调试视图 |
| `postfx/HDRDriver.tsx` | 步骤 1 既有，最小增补 | 尺寸 / 帧驱动 / 开关同步 / 统计回传 |
| `renderer/PostFX.tsx` | 步骤 1 既有 | 后处理插槽：渲染 children + `<HDRDriver />` |
| `renderer/CanvasRoot.tsx`（改） | 步骤 1 既有 | 加 **`flat`**（必需，见踩坑 1） |
| `perf/PerfProbe.tsx` | 步骤 1 既有 | priority 2，保证在链路之后采样 |
| `perf/PerfPanel.tsx`（改） | 本次新增 | 各 pass 计时分解（CPU 侧） |
| `e2e/smoke.spec.ts` | 本次新增 | Playwright 冒烟：无 console error / 画面非空 / 档位标注 / 自建链与直出的像素 A/B |

**关于「同一任务被实现两次」**

步骤 1 在 2026-09-23 已完成并推送（`ea6e5f3`），随后在 09-28 被独立重做了一遍（`1d16b20`，在 `renderer/` 下另起了一套抽象，并覆盖了 `PostFX.tsx` / `CanvasRoot.tsx` / `PerfProbe.tsx`）。
经确认采用「以 `postfx/HDRPipeline.ts` 为基线原地重构」：抽象层迁入 `postfx/`，`renderer/` 那套删除，`HDRPipeline` 的公开 API 与 `DEVLOG.md` 的记录全部保留。

**教训：动手前先 `git log` / `git ls-files` 确认现状，不要只凭一次代码搜索就断言「某能力为零」。**

**动手时核实过的 5 个运行时事实**（后续改动不要再重新踩）

1. **R3F 会覆盖 `toneMapping`**：内部执行 `gl.toneMapping = flat ? NoToneMapping : ACESFilmicToneMapping`。因此必须在 `<Canvas>` 上传 `flat`，否则色调映射会与自建链重复。
2. **`useFrame` 的 priority > 0 会关闭 R3F 自动渲染**：判据是 `if (!state.internal.priority && state.gl.render) state.gl.render(...)`，且订阅者按 priority **升序**执行 —— 所以链路用 1、`PerfProbe` 用 2。
3. **`renderer.info.autoReset` 默认 true**，而 three 在**每次** `render()` 调用里都会重置统计。多 pass 下必须改为 `false` + 每帧手动重置一次，否则性能面板只能看到最后一个全屏 pass 的 1 个 draw call。
4. **渲到 RenderTarget 时输出色彩空间被强制为 `LinearSRGBColorSpace`**（源码：`currentRenderTarget === null ? renderer.outputColorSpace : LinearSRGBColorSpace`），即写入的是**未编码的线性值** —— 这正是 HDR 链需要的输入。
5. **MSAA 不会自动作用于 RenderTarget**，需显式 `samples`；three 在 `render()` 尾部自动 resolve 多重采样目标，所以下一环采样到的是已解析纹理。这也意味着渲染器的 `antialias: true` 在自建链下已无作用。

**行为变更（预期内，需知悉）**

加了 `flat` 之后，R3F 不再施加 `ACESFilmic` 色调映射，因此画面会比改造前**更亮、高光无 filmic 滚降**。这是「色调映射改由自建 pass 负责」这一锁定决策的直接结果 —— S2 把色调映射拿回自己手里后即恢复可控状态。`bypass` 开关对比的是「场景直出」与「自建链」，两者都是无色调映射，因此 A/B 是有意义的（预期仅有 16F 量化带来的亚像素差异）。

#### 3.4.2 S2 框架就绪记录

**已接通（管线部分）**

| 能力 | 落点 |
| --- | --- |
| EV 滑杆（−4…+4，每帧推进管线） | `postfx/HDRPanel.tsx` + `postfx/HDRDriver.tsx` |
| 曲线下拉（直通 / ACES / AgX / Reinhard） | 同上 |
| URL 序列化（`?ev=-2&tm=aces` 打开即复现） | `postfx/hdrParams.ts`（复用 `createDemoStore`） |
| 曲线对照图（含直通虚线参照、未实现水印） | `postfx/ToneCurveGraph.tsx` |
| GPU 侧三条曲线的分支结构 | `postfx/passes/TonemapOutputPass.ts` 的 `tonemap()` |

**S2 三条曲线已实现**

1. ✅ **实现三条曲线**：`postfx/toneCurves.ts` 的 `reinhardCurve` / `acesCurve` / `agxCurve`（Reinhard 本就正确；ACES 去掉非法 `f` 后缀并修正 `x(ax+b)/(x(cx+d)+e)` 漏 `x`；AgX 修正符号并补完整原色变换，详见 DEVLOG 2026-10-06）
2. ✅ **写对应 GLSL**：`postfx/passes/TonemapOutputPass.ts` 的 `tonemap()`，三个分支均已实现
3. ✅ **决定「过曝回收」怎么呈现**：采用方案 a（`uClipView` 开关，改动最小）——映射前把任一通道 > 1 的像素染红（保留 40% 已映射结果），直观展示被 tonemap 救回的高光；理由与实现见 DEVLOG 2026-10-06（p0-hdr S3）。该开关同时覆盖 S3 的「过曝回收 A/B 对比」。

每处 TODO 都写了形状要求与自查点；曲线未实现时界面会显示「曲线未实现」而不是静默无效。

**本轮顺带修掉的布局问题**：HUD 原为「上下两行」，右上角性能面板长高会把左下面板推出画布（实测溢出 455px）。已重构为**左右两列** + 插槽收缩滚动，并在 e2e 里加了布局断言守住这条不变量。

---

### 3.5 验收清单

- [ ] `PostFX` 不再是直通，`CanvasRoot` 实际挂载了 `Pipeline`
- [ ] 场景渲进 RGBA16F 目标；`colorBufferFloat` 为 false 时回落 RGBA8，且 HUD 显式标注当前档位
- [ ] `renderer.toneMapping` 仍是 `NoToneMapping`，映射只在 pass 里发生**一次**（不得重复映射）
- [ ] ACES / AgX / Reinhard 可切换，切换后画面变化与曲线形状一致
- [ ] EV 滑杆生效，范围至少 −4 … +4
- [ ] 「过曝回收」对比可演示：EV 阶梯下高光不截断
- [ ] 直方图面板随 EV 平移（关闭自动曝光时）
- [ ] 自动曝光可开关，1–2 帧收敛，无可见振荡
- [ ] Bloom 可开关，mip 链各级可可视化，并给出耗时占比
- [ ] `Pipeline` / passes 目录下**没有任何 React import**
- [ ] 所有参数进 URL（`?ev=&tm=&autoexposure=&clipView=&bloom=&bloomIntensity=`），链接可直接复现
- [ ] 性能面板仍是 5Hz 采样 —— 加了 pass 之后**不允许**退化成每帧重渲染
- [ ] `npm run typecheck` 与 `npm run build` 通过
- [ ] demo 元数据 status 改 `done`，limitations 如实填写

---

### 3.6 风险与注意事项

- **R3F 与 pass 顺序**：严格按方案 A，`Pipeline` 与 React 解耦；React 只负责 `useFrame(priority)` 驱动与参数同步。
- **`readPixels` 会 stall 管线**：直方图 / 自动曝光必须隔帧异步回读（WebGL2 无 PBO 时至少降低回读频率），否则帧率会被拉出周期性尖刺 —— 这本身就是一个可展示的性能故事。
- **半精度条带**：RGBA16F 在极暗部会出现条带 → 在 `output` pass 加抖动（dither）缓解。
- **浮点线性过滤**：`floatLinear` 为 false 时，mip 链下采样需手写双线性或改用 `NEAREST` 降采样策略；`capabilities` 已在探测该位。
- **颜色空间**：不要把色调映射与 sRGB 编码混在同一个 pass 里调试 —— 这是画面发灰/过曝最常见的来源。`tonemap` 出 LDR，`output` 只做编码。
- **移动端降级**：bloom mip 级数减半、luminance 降到 64×64 或更小、必要时整条链旁路回 8bit 直出，并在 HUD 标注。

---

### 3.7 配套建议（与本轮并行，半天）

本会话已两次暴露同一个洞：MobX 迁移与 R3F `gl` 工厂签名都**只能验证到类型与构建层面，无法确认浏览器里真能跑**（环境无 Playwright，未擅自安装浏览器内核）。而 pass 重构恰恰是最容易「改完白屏」的改动。

建议补一条 `npm run smoke`：启 dev server → 打开 `/d/hello-cube` → 断言无 console error + canvas 非空白（读像素）→ 存一张基线截图。它同时是：

- 后续所有改动的安全网；
- 文档「视觉回归与性能门禁」加分项的雏形（固定 seed 已有 `src/core/utils/random.ts`）。

---

### 3.8 本轮明确不做

- **GPU 计时**：现在只有 1 个 pass，**没有可归因的对象**；等 pass 数 ≥ 3 时再做才有意义（推迟到 `p0-gbuffer-hud`）。
- **PBR / 阴影 / SSGI**：底座没打通，做了还要返工。
- **切 WebGPU**：阶段 4 定了深水区方向再在 `createRenderer.ts` 单点切。
- **原生 WebGL2 原理复现页**：加分项，等主线有内容之后再做。

---

## 四、参考：规划约束

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
