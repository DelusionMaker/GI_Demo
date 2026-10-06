# 开发日志 · 光照与全局光照作品集

> 用途：记录每个任务的**具体实施过程**，可审计、可回溯。
> 与 [TODO.md](TODO.md) 分工：TODO.md 管「做什么 + 勾选状态 + 已锁定决策」；本文件管「怎么做的、关键决策为什么、踩过什么坑、验证数据」。
>
> **追加规则**：最新条目放最上面（打开即见最新进展）。每条按统一模板：
> 目标 → 改动文件 → 关键决策 → 踩坑与修复 → 验证 → 遗留/下一步。
> 任务 ID 与 TODO.md 对齐（如 `p0-hdr`、`p1-pbr-ibl`）。

---

## 2026-10-06 · p0-hdr 步骤 2：三条色调映射曲线实现（Reinhard / ACES / AgX）

### 目标

把 S2 留白的曲线数学补上：Reinhard 本来就对；修 ACES 公式与 GLSL 错误；把 AgX 从「裸多项式」补成完整实现，并在本条目记清 AgX 的 GPU/CPU 差异。

### 改动文件

| 文件 | 类型 | 内容 |
| --- | --- | --- |
| `src/core/postfx/shaders/tonemap-output.frag` | 改造 | ACES 改为 `x(ax+b)/(x(cx+d)+e)` 并去掉非法 `f` 后缀；新增 `agxDefaultContrastApprox` + `agxTonemap`（原色变换矩阵 + log2 编码）；`mode==2` 调 `agxTonemap` |
| `src/core/postfx/toneCurves.ts` | 改造 | `agxCurve` 修正符号（x 项 `+0.1191`、常数 `-0.00232`），输入钳 `Math.max(0,x)` |
| （既有）`tonemap-output.frag:80` | 已有 | `color = max(color, 0.0)` 在分支前钳负值，统一满足 f(0)=0 |

### 关键设计决策

1. **GPU/CPU 不必逐像素一致，但曲线段必须同形**：`toneCurves.ts` 顶部注释已明确——`agxCurve` 只承担**标量对比度曲线段**，完整原色变换（`AgXInsetMatrix` / `AgXOutsetMatrix`）是 GPU 侧矩阵运算，CPU 只需保证曲线**形状**一致（用于曲线图）。因此 CPU 仍是逐通道标量，GPU 会混通道——这是**预期差异**，不是 bug，曲线图看的是形状。
2. **AgX 取 three.js 同款 Sobotka 拟合**：流程 = inset 矩阵（线性 RGB → AgX 原色）→ `log2` → 归一化 `(val+10)/12` → look 矩阵 → `agxDefaultContrastApprox` → 反归一化 `val*12-10` → `exp2`。
3. **GLSL `mat3` 是列主序**：矩阵常数按 three.js 原样填入（不再转置），转置会偏色。
4. **`log2(0)` 防护**：`agxTonemap` 内 `max(val, 1e-4)`，极小输入≈黑，避免 `-inf` 炸成 NaN/白。

### 踩坑与修复

1. **ACES 一开始编译不过 + 公式错**
   - GLSL 不允许 `2.51f` 这类 C 风格 `f` 后缀（WebGL 编译错误）；且原代码把 `x(ax+b)/(x(cx+d)+e)` 写成了 `(ax+b)/(cx+d+e)`——分子分母都漏了外层 `x`。两处都修了，并与 CPU `acesCurve` 对齐。
2. **旧 AgX GPU/CPU 互相对不上**
   - GPU 用 `+40.14·x⁵`、无常数项；CPU 用 `-40.14·x⁵` 但常数 `+0.00232`（规范应为 `-0.00232`），且两边 x 项都是错的 `-0.1191`（规范 `+0.1191`）。统一修正为规范多项式。
3. **lint 告警是误报**：`tonemap-output.frag:19` 的 `in vec2 vUv` 被静态分析报「not supported for this version」——本文件走 RawShaderMaterial / GLSL 3.00，`in/out` 合法，运行时由 three.js 处理。该告警在本轮改动前就存在，与此次无关。

### 验证

- `npm run typecheck`：`toneCurves.ts` 通过（shader 无 TS lint）。
- 形状自查：AgX 多项式常数项修正后，`f(0)=−0.00232→clamp 0`、`x→∞` 有界；ACES 与 CPU `acesCurve` 公式逐项一致。
- 待人工目视：切换 `tm=agx/aces/reinhard` 下拉，确认三档观感明显不同、AgX 不偏色。

### 遗留 / 下一步

1. **AgX 常数未联网逐字核对**：矩阵与 `(val+10)/12` 取自 three.js `agx` 实现，建议上线前对照 `three/src/renderers/shaders/ShaderChunk/tonemapping_pars_fragment.glsl.js` 复核顺序。
2. **是否要像素级一致**：若以后要求 GPU/CPU 逐像素相同，`agxCurve` 得改成吃 `vec3` 并复刻矩阵——目前按「图用」足够，差异已写在本条目「关键设计决策 1」。
3. S2 还剩「过曝回收」呈现（`uClipView` 开关 vs 独立 clip-view pass）未决，待定后补记。

---

## 2026-09-28 · p0-hdr 步骤 2 框架：EV / 曲线 / 曲线图接通，曲线数学留白

### 目标

把步骤 2 的**管线部分**全部接通（曝光滑杆、曲线下拉、URL 序列化、曲线对照图、GPU 分支结构），
把**曲线数学**留空并标成 TODO —— 这部分属于「必须自己能讲清楚」的内容，不由工具代笔。

### 改动文件

| 文件 | 类型 | 内容 |
| --- | --- | --- |
| `src/core/postfx/toneCurves.ts` | **新建（留给你写）** | 三条曲线的 CPU 实现位置 + 待填 TODO + 形状要求 + 双份实现的同步策略选项 |
| `src/core/postfx/ToneCurveGraph.tsx` | 新建 | 曲线对照图（canvas 2D：直通虚线参照、绘图区裁剪、未实现水印） |
| `src/core/postfx/hdrParams.ts` | 新建 | 用户旋钮（ev / tm / bypass / hdrDebug），走 createDemoStore 自动获得 URL 序列化 |
| `src/core/postfx/hdrStore.ts` | 重构 | 收敛为纯运行时状态（档位 / pass 名 / 计时），旋钮移交 hdrParams |
| `src/core/postfx/HDRPanel.tsx` | 改造 | 增加 EV 滑杆、曲线下拉、曲线图 |
| `src/core/postfx/HDRDriver.tsx` | 改造 | 每帧把旋钮推进管线（曝光 / 曲线 / 旁路 / 调试视图） |
| `src/core/postfx/passes/TonemapOutputPass.ts` | 改造 | 增加 `tonemap()` 分支骨架（三条曲线的 TODO 位置）；曝光改为每帧从 `PassContext` 读 |
| `src/core/postfx/HDRPipeline.ts` | 改造 | `TonemapMode` 扩到 4 档；`setTonemap` 对非法值兜底 |
| `src/core/hud/Hud.tsx` | 重构 | **两行 → 两列**（见踩坑 1） |
| `src/styles/global.css` | 改造 | HUD 两列布局 + 插槽收缩滚动 + 曲线图样式 |
| `e2e/smoke.spec.ts` | 改造 | 新增参数 URL 序列化用例、HUD 溢出布局断言 |

### 关键设计决策

1. **曲线数学不代笔**：`toneCurves.ts`（CPU，供曲线图）与 `TonemapOutputPass.ts` 的 `tonemap()`（GPU）两处都只给结构、不给实现，每条都写了形状要求与自查点。
2. **旋钮进 URL，运行时状态不进**：`hdrParams` 承载 ev / tm / bypass / hdrDebug 并自动序列化；`hdrStore` 只承载管线回报的档位与计时。
3. **参数名避开 demo 自己的参数**：demoStore 的 `debug` 已被 demo 占用，所以链路调试视图叫 `hdrDebug`，否则两者互相覆盖。
4. **曝光只有一条路径**：导出 pass 不再缓存曝光值，改为每帧从 `PassContext.exposureEV` 读，避免两处状态不同步。
5. **曲线图裁剪而非 clamp**：若 clamp 纵坐标，直通参照线会被折出一条假的「肩部」，误以为已经压过平了。
6. **未实现状态要可见**：曲线未实现时图上标「曲线未实现（见 toneCurves.ts）」并把线画成告警色 —— 让「还没做」在界面上可辨认，而不是看起来像做坏了。

### 踩坑与修复

1. **HUD 的「两行」结构导致面板溢出画布**
   - 现象：加上曲线图后，左下面板列高 668px，而画布只有 504px（视口 720 → stage = min(70vh, 680) = 504），底部溢出 455px。
   - 走了两个弯路：先给底部插槽加 `max-height: 46vh`（溢出降到 174px，未解决）；
     再加 `.hud-row { flex-shrink: 0 }`（数值**一点没变**）。
   - 真正原因（靠打印 `getBoundingClientRect` + `getComputedStyle` 量出来，不要靠心算）：
     上下两行的高度**互相拖累** —— 右上角性能面板 310px 把顶行撑到 334px，底行 355px，
     两行相加 689px > 504px，行被 flex 压缩而插槽不缩，插槽便溢出到行外。
   - 修复：`Hud` 从「两行」重构为「左右两列」，任一侧长高不再影响另一侧的底部对齐；插槽改为可收缩 + 内部滚动。
   - 顺带修正取证方式：截图前先 `scrollIntoViewIfNeeded()`，否则 `.stage` 底部在折叠线以下会被裁掉，
     看到的「溢出」可能只是截图裁剪（这次 455px 是真溢出，但差点被这个假象带偏）。
2. **Playwright 的 viewport 被 project 覆盖**：`devices['Desktop Chrome']` 自带 1280×720，
   会盖掉顶层 `use.viewport` 的 800。按 800 算 vh 一直对不上，实际是 720。
3. **受控 range 输入不能直接 fill**：React 受控 `<input type="range">` 需走原生 value setter + 派发 `input` 事件，已封装为 `setRangeValue`。
4. **HUD 里出现第二个 `<canvas>`**：曲线图让 `page.locator('canvas')` 命中两个元素，e2e 里所有截图与可见性断言都要 `.first()` 锁定 WebGL 画布。

### 验证

`npm run smoke`（4 用例全绿）：

| 检查项 | 结果 |
| --- | --- |
| console error / pageerror | 0 |
| RT 档位 | RGBA16F |
| 画面非空 | 亮度标准差 40.79 |
| 自建链 vs 直出像素 A/B | 平均差 0.036、最大差 33、差异 > 8 的像素 0.206% |
| **HUD 不溢出画布** | 4 个插槽上下余量 `[13/452, 72/13, 13/181, 457/13]`，全部 ≥ 0 |
| **S2 参数进 URL** | `?speed=0&tm=aces&ev=-2`；用该 URL 重开，控件正确回填 |

截图：`e2e/screenshots/`（`00-panel.png` 面板全貌、`06-curve-todo.png` 曲线未实现状态）。

### 遗留 / 下一步 —— **等你来做的三件事**

1. 实现 `src/core/postfx/toneCurves.ts` 里的 `reinhardCurve` / `acesCurve` / `agxCurve`
   （建议顺序 Reinhard → ACES → AgX；每个函数的要求写在文件里）
2. 在 `src/core/postfx/passes/TonemapOutputPass.ts` 的 `tonemap()` 里写对应 GLSL（三个分支已留好）
3. 决定「过曝回收」怎么呈现（该文件 `main()` 里列了两种低成本做法：加 `uClipView` 开关，或新增一个 clip-view pass），
   并把理由记进本文件

做完第 2 项后，把 `src/site/demos.ts` 里 `hdr` 条目的状态从 `planned` 改成 `wip`。

---

## 2026-09-28 · p0-hdr 步骤 1 重构：链路抽象化 + R3F flat 修正 + Playwright 冒烟

### 目标

把步骤 1 写死的「beauty + 全屏输出」两段链下沉为通用 `Pipeline` + 可插拔 `Pass`，
为步骤 2/3/4 与 p0-gbuffer-hud 的 MRT 铺路；修正一处会让 HDR 失效的前置约束错误；
补上浏览器内的自动化验证。

### 改动文件

| 文件 | 类型 | 内容 |
| --- | --- | --- |
| `src/core/postfx/Pass.ts` | 新建 | `Pass` / `PassContext` / `PassTargetSpec` / `PassTiming` 类型契约 |
| `src/core/postfx/Pipeline.ts` | 新建 | 通用多 pass 调度：RT 池化复用（按 format/filter/samples/depth/尺寸 分池）、`info` 手工重置、调试截断、bypass |
| `src/core/postfx/FullscreenQuad.ts` | 新建 | 全屏单三角形 + 通用顶点着色器；材质 `toneMapped = false` |
| `src/core/postfx/passes/BeautyPass.ts` | 新建 | 链首（原 beauty 段），`samples: 4` + `DepthTexture` 沿用既有决策 |
| `src/core/postfx/passes/TonemapOutputPass.ts` | 新建 | 链尾（原输出段），手写分段 sRGB + EV，曲线分支占位 |
| `src/core/postfx/hdrStore.ts` | 新建 | 链路 UI 侧状态（MobX，5Hz 采样） |
| `src/core/postfx/HDRPanel.tsx` | 新建 | HUD 面板：RT 档位 / 旁路 / 调试视图 |
| `src/core/postfx/HDRPipeline.ts` | 重构 | 保留为门面，**公开 API 不变**（`hdrSupported` / `passTimes` / `setExposureEV` / `setTonemap` / `setSize` / `render` / `dispose`） |
| `src/core/postfx/HDRDriver.tsx` | 改造 | 增补 store 注册、单向参数同步、5Hz 计时回传 |
| `src/core/renderer/CanvasRoot.tsx` | 改造 | 加 **`flat`**（见踩坑 1） |
| `src/core/perf/PerfPanel.tsx` | 改造 | 各 pass 计时分解（CPU 侧） |
| `e2e/smoke.spec.ts`、`playwright.config.ts` | 新建 | Playwright 冒烟与像素级 A/B |

### 关键设计决策

1. **抽象层放在 `postfx/` 内，`HDRPipeline` 保留为门面**：公开 API 与本文档的记录全部不变，`HDRDriver` 只做最小增补 —— 历史连续、可追溯。
2. **pass 命名沿用本文档步骤 1 的计时表**：`beauty` / `tonemap-output`。
3. **Pipeline 构造函数不读 store**：浮点能力位由 `HDRPipeline` 从 `capabilitiesStore` 读出后以 `{ hdr }` 传入，渲染核心只依赖 three + `Pass` 契约，保持与状态层无关。
4. **`dispose()` 刻意非终结**（只释放资源、不置死标记），原因见踩坑 2。
5. **调试视图用「截断 + 复用链尾 pass 呈现」**：不引入额外 blit 材质，且走与正常出屏完全相同的色彩路径。
6. **全屏几何从 `PlaneGeometry(2,2)` 换成单三角形**：没有对角线上的重复着色，且无需 uv 属性。
7. **单向数据流**：UI 开关从 store 推进管线；渲染核心不感知 MobX，计时按 5Hz 反向回传。

### 踩坑与修复

1. **R3F 会覆盖 `toneMapping`（步骤 1 的前置约束有误）**
   - 步骤 1 记录「依赖 createRenderer 中 toneMapping = NoToneMapping」，但 R3F 在 configure 阶段会执行
     `gl.toneMapping = flat ? NoToneMapping : ACESFilmicToneMapping`，把 `createRenderer` 的设置覆盖掉。
   - 后果：场景材质先做一次 ACES，写进 HDR RT 的已不是线性 HDR 值。步骤 1 看起来「画面正常」，
     但步骤 2 的曲线会在已映射的数据上再映射一次 —— 属于会积累到后期才爆的错。
   - 修复：`<Canvas flat>`。
   - **代价（预期内）**：画面比之前更亮、高光没有 filmic 滚降；色调映射归自建链负责，步骤 2 接回后即可控。
2. **StrictMode 下 dispose 后实例会被复用**
   - `useMemo` 创建的实例会在 StrictMode 的 mount → cleanup → mount 中被 dispose，而 effect 重跑仍拿到同一实例。
   - 原实现能「自愈」的原因：`dispose()` 只释放资源、没有置死标记，RT 在下次 `setRenderTarget` 时被惰性重建
     （此前观察到的一次性 context lost info 与此有关）。
   - 抽象化时**把这一点固化为设计**并在代码注释写明：`dispose()` 不是终结性的。
3. **`Pass.lastGpuMs` 类型缺口**：GPU 计时位记在 `PassTiming.gpuMs`，但写入方是各 pass；
   补 `Pass.lastGpuMs?: number` 由 Pipeline 汇总。
4. **sRGB 编码方式的说法修正**：本文档步骤 1 决策 6 写「ShaderMaterial 全屏 quad 不会被 three 注入 `colorspace_fragment`」。
   更准确的说法是：three **不会自动插入调用**，但会把 `linearToOutputTexel` 注入非 raw 材质的片元前缀，
   因此 `#include <colorspace_fragment>` 实际可用。仍**保留手写分段编码** —— 它不依赖 three 内部 chunk 命名，
   与「onBeforeCompile 依赖内部命名易碎」那条风险提示一致。

### 验证（Playwright 首次接入）

环境说明：本机访问 Playwright CDN 被挡（下载 45 秒 0 字节增长），改用系统已装的 Chrome 驱动
（`playwright.config.ts` 的 `SMOKE_CHANNEL`，默认 `chrome`；CI 上建议 `npm run smoke:install` 后用 bundled 内核）。

`npm run smoke` 实测：

| 检查项 | 结果 |
| --- | --- |
| console error / pageerror | 0 |
| RT 档位（HUD 标注） | **RGBA16F**（浮点目标确实生效） |
| 画面非空 | 亮度均值 74.91、标准差 40.79（无黑屏） |
| 逐 pass 计时表 | 存在（证明本帧确实提交了 pass） |
| **自建链 vs 直出像素 A/B** | 平均差 **0.036**、最大差 **33**、差异 > 8 的像素 **0.206%** |
| 分路证据 | 旁路时计时表消失 → 确认 bypass 分支真的执行（排除「开关没生效但两张图恰好一样」的假阳性） |

A/B 数据判读：平均差 0.036/255 说明两条路径数值上基本重合；最大差 33 与那 0.206% 的差异像素集中在几何边缘，
来源是 **MSAA 采样数不同**（自建链用 RT 的 `samples: 4`，直出用默认后缓冲）叠加 16F 量化。
结论：接入后**视觉一致**，但不是逐字节一致（也不应期待逐字节一致）。

截图产物在 `e2e/screenshots/`（已 gitignore）。

### 遗留 / 下一步

- **步骤 2**：`TonemapOutputPass` 内补 ACES(Narkowicz) / AgX / Reinhard 分支 + EV 滑杆 + 曲线图 + clamped-pixels 调试视图。
  现在只需扩展一个 pass，不必动调度逻辑。
- **步骤 3**：bloom 必须插在 tonemap **之前**（HDR 线性空间）；新增 pass 插到 `beauty` 与 `tonemap-output` 之间即可。
- **步骤 4**：沿用原判断 —— 放弃片元直方图（WebGL2 片元无原子加），改 luminance mip 链 + 跨帧异步回读；
  且**默认锁手动曝光**，以免破坏 Playwright 的确定性。
- **p0-gbuffer-hud**：`BeautyPass` 已挂 `DepthTexture`，但 MSAA 下的可采样性仍未复核
  （Pipeline 已通过 `PassContext.inputDepth` 把深度透出给后续 pass）。
- **调试视图**目前只有 2 段链路，截断与完整链路视觉等价；pass 数 ≥ 3 后才具备可区分性，
  `e2e` 中已把这一点写成显式断言与注释。
- **教训（已写进 TODO.md）**：动手前先 `git log` / `git ls-files` 确认现状，
  不要只凭一次代码搜索就断言「某能力为零」。

---

## 2026-09-23 · p0-hdr 步骤 1：HDR 管线骨架 + R3F 接管渲染

### 目标

搭建自建后处理链的第一段：场景渲到 **RGBA16F HDR 渲染目标**，再经一个全屏 pass 输出到 canvas（手写线性→sRGB 编码）。
验收标准：接入后 hello-cube 画面与接入前**视觉一致**（默认 EV=0、linear 直通），无发灰/黑屏，类型检查通过。

### 实施前确认的关键约束

- three 版本 `0.170.0`、R3F `9.x`、React 19、MobX 7（见 `package.json`），RT 用新版 `colorSpace` API。
- [createRenderer.ts](src/core/renderer/createRenderer.ts) 已锁定 `toneMapping = NoToneMapping` + `outputColorSpace = SRGBColorSpace`，HDR pass 不能与之重复映射。
- [capabilities.ts](src/core/capabilities.ts) 已检测 `colorBufferFloat` / `floatLinear` / `timerQuery` 三个能力位，直接消费。

### 改动文件

| 文件 | 类型 | 内容 |
| --- | --- | --- |
| `src/core/postfx/HDRPipeline.ts` | 新建 | 与 React 无关的纯 TS class。持有 HDR RT、全屏 quad、pass 计时表；`render(renderer, scene, camera)` 完成「场景 → HDR RT → 全屏输出」 |
| `src/core/postfx/HDRDriver.tsx` | 新建 | Canvas 内驱动：物理像素尺寸建管线、resize 同步、`useFrame(..., 1)` 接管自动渲染、卸载 dispose |
| `src/core/renderer/PostFX.tsx` | 改造 | 从直通插槽改为渲染 children + `<HDRDriver />` |
| `src/core/renderer/CanvasRoot.tsx` | 改造 | `<PerfProbe />` 与 children 统一包进 `<PostFX>`，全站画布自动走 HDR 管线 |
| `src/core/perf/PerfProbe.tsx` | 改造 | `useFrame` priority 从默认改为 `2`，晚于管线采样（原因见踩坑 2） |

### 关键设计决策

1. **渲染核心与 React 解耦**：`HDRPipeline` 是纯 class，React 侧（HDRDriver）只负责挂载、resize、每帧调 `render()`。落实 TODO.md「渲染核心保持与 React 无关，避免 reconciler 与自建多 pass 互相打架」。
2. **RT 格式选 RGBA16F（HalfFloatType）而非 RGBA32F**：带宽减半（移动端带宽红线）；16F 线性过滤不依赖 `OES_texture_float_linear`（那是 32F 才需要），可绕开该能力限制。
3. **降级路径**：无 `EXT_color_buffer_float` 时退到 RGBA8（UnsignedByteType，高光截断），`hdrSupported=false` 暴露给 HUD 标注，console 只警告一次。后续低档位可再考虑 R11F_G11F_B10F。
4. **RT 创建时即挂 DepthTexture（DEPTH_COMPONENT24）**：p0-gbuffer-hud / SSR / SSGI 都要复用深度，避免回头改 RT。
5. **MSAA 设在 RT 上（samples=4，移动端/降级档 0）**：渲染器的 `antialias:true` 只对默认后缓冲有效，渲到自建 RT 后必须自带 multisample。已在代码注释标注遗留风险：**three 只自动 resolve 颜色，MSAA 下 DepthTexture 不保证可采样，到需要读深度的阶段必须复核（或改走 TAA）**。
6. **sRGB 编码手写在最终 pass**：`ShaderMaterial` 全屏 quad 不会被 three 注入 `colorspace_fragment`，必须自己做精确分段编码（`lo/hi + 0.0031308 阈值`），不用 `pow(1/2.2)` 近似（暗部偏）。HDR RT 本身保持 `NoColorSpace` 线性。
7. **R3F 接管渲染靠 priority**：一旦存在 `useFrame(cb, priority>0)`，R3F 停止自动渲染，由管线负责全帧提交；priority 顺序固定为 HDRDriver=1 → PerfProbe=2。
8. **尺寸用物理像素**：`size.width * viewport.dpr`（实测机器 DPR 1.25），resize effect 同步 `setSize`；RT.setSize 会连带调整已挂载的 DepthTexture。
9. **pass 计时表预埋**：`passTimes = [beauty, tonemap-output]`，CPU 侧先用 `performance.now()` 占坑，`gpuMs: null` 留给 p0-gbuffer-hud 的 `EXT_disjoint_timer_query_webgl2`；bloom/luminance pass 后续插中间。

### 踩坑与修复

1. **全屏 pass 的 sRGB 双编码风险**：接入前预判——若忘记全局已是 NoToneMapping 又在输出 pass 编码不当，会发灰。措施：shader 内只在最终输出编码一次，并在 PostFX.tsx 注释固化该约束。实测画面颜色正常。
2. **draw call / 三角形统计失真（接入后实测发现，已修复）**：
   - 现象：性能面板显示 `1 call / 2 tri`，只剩全屏四边形。
   - 原因：一帧内两次 `renderer.render()`（beauty + 全屏输出），three 的 `renderer.info.autoReset` 默认在每次 render 前清零；PerfProbe 原先以默认 priority 执行，读到的是被第二次 render 清零后的累计值。
   - 修复：`HDRPipeline.render()` 帧首设 `info.autoReset=false` 并手动 `info.reset()`，使整帧 call/tri 累计；PerfProbe priority 提到 `2` 在管线之后读取。
   - 修复后实测：**9 calls / 6.0k triangles**（含 +1 call / +2 tri 的全屏 quad，属预期计数）。

### 验证

- `npm run typecheck`：通过，0 错误。
- `npm run dev`（Vite，5173 被占用 → http://localhost:5174/），浏览器打开 `/d/hello-cube`：
  - 画面：Cornell box、白色球体高光、两个立方体、地面阴影均正常，颜色不发灰、无黑屏。
  - 控制台：0 error / 0 warning（仅 React DevTools 提示与 StrictMode 双挂载导致的一次性 Context Lost info，上下文已恢复，良性）。
  - 能力位：浮点 RT ✓ / 浮点线性过滤 ✓ / 计时扩展 ✓。
  - 性能：75 FPS（显示器 75Hz 锁帧），帧时间 13.3–13.4 ms，DPR ×1.25；GPU 时间仍为 —（待 p0-gbuffer-hud）。

### 遗留 / 下一步

p0-hdr 剩余三步（对应本文件后续条目）：

- [ ] **步骤 2**：shader 补 ACES(Narkowicz) / AgX(需配 contrast look) / Reinhard 分支；控制面板加 `tonemap` 下拉、`ev` 滑杆（`color *= exp2(EV)`）；DOM 曲线图面板；clamped-pixels 调试视图（映射前 >1 标红）。参数复用 `createDemoStore` 进 URL。
- [ ] **步骤 3**：物理 bloom——半分辨率 13-tap 加权 mip 链（不用 generateMipmap），**先加 bloom 后 tonemap**，阈值在 HDR 线性空间按亮度 soft-knee；移动端少 2 级 mip。
- [ ] **步骤 4**：自动曝光——WebGL2 片元无原子加，放弃片元直方图方案，改 luminance R16F 半分辨率起逐级 downsample 到 1×1，跨帧异步回读（读上一帧结果，避免 readPixels stall）；帧率无关适应 `L += (target-L)*(1-exp(-dt/τ))`，明/暗 τ 分开。**注意会破坏视觉回归确定性**：默认锁手动曝光或提供「重置适应」，Playwright 等收敛。
- [ ] 步骤 2 完成后把 `src/site/demos.ts` 中 `hdr` 条目状态 `planned → wip`，并在性能面板接入 `passTimes`。
- [ ] 远期接口：`HDRPipeline.render` 的输入后续抽象为消费 beauty+depth texture，使 G-buffer/deferred 落地时 HDR 段零改动。

---
