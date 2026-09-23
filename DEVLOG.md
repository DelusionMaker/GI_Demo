# 开发日志 · 光照与全局光照作品集

> 用途：记录每个任务的**具体实施过程**，可审计、可回溯。
> 与 [TODO.md](TODO.md) 分工：TODO.md 管「做什么 + 勾选状态 + 已锁定决策」；本文件管「怎么做的、关键决策为什么、踩过什么坑、验证数据」。
>
> **追加规则**：最新条目放最上面（打开即见最新进展）。每条按统一模板：
> 目标 → 改动文件 → 关键决策 → 踩坑与修复 → 验证 → 遗留/下一步。
> 任务 ID 与 TODO.md 对齐（如 `p0-hdr`、`p1-pbr-ibl`）。

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
