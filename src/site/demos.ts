export type Layer = 'L1' | 'L2' | 'L3' | 'L4'
export type PerfKind = 'realtime' | 'baked' | 'hybrid'
export type DemoStatus = 'scaffold' | 'wip' | 'done' | 'planned'

export interface DemoSource {
  label: string
  href: string
}

export interface DemoMeta {
  id: string
  title: string
  /** 一句话问题陈述：解决什么、为什么难（两行以内） */
  oneLiner: string
  layer: Layer
  stack: string
  perf: PerfKind
  /** 一个关键指标，首页卡片展示，如「1 spp 起始 · 收敛至 512 spp」 */
  metric: string
  effort: string
  status: DemoStatus
  problem?: string
  algorithm?: string[]
  formulas?: string[]
  limitations?: string[]
  sources?: DemoSource[]
}

export const LAYER_LABEL: Record<Layer, string> = {
  L1: '层级一 · 实时直接光照',
  L2: '层级二 · 烘焙 GI',
  L3: '层级三 · 实时 GI',
  L4: '层级四 · 进阶效果',
}

export const PERF_LABEL: Record<PerfKind, string> = {
  realtime: '实时',
  baked: '烘焙',
  hybrid: '半实时',
}

export const STATUS_LABEL: Record<DemoStatus, string> = {
  scaffold: '骨架',
  wip: '进行中',
  done: '完成',
  planned: '规划中',
}

/**
 * 推荐主线（6 个成品）。status 为 planned 的条目只提供元数据，
 * 页面会明确标注「规划中」，不伪装成已完成。
 */
export const DEMOS: DemoMeta[] = [
  {
    id: 'hello-cube',
    title: 'hello-cube',
    oneLiner: '骨架冒烟测试：一条最小链路串通画布、相机装置、控制面板、URL 状态与性能面板。',
    layer: 'L1',
    stack: 'R3F + three.js',
    perf: 'realtime',
    metric: '模板复用 · 0 行 shader 起步',
    effort: '0.5 天',
    status: 'scaffold',
    problem:
      'p0-base 的验收物：任何后续 demo 只需实现自己的 Scene 与控制项，就能直接获得预设视角、巡航、参数序列化与性能采集。',
    algorithm: [
      '渲染器工厂集中分叉后端（当前 WebGL2），其余代码不感知后端差异。',
      'CameraRig 统一管理 2 个预设视角 + 绕轴巡航 + 轨道操作，键盘 1..n / 空格。',
      'createDemoStore 把参数写入 URL query，只记录与默认值不同的项。',
      'PerfProbe 在画布内每帧采集，PerfPanel 在 DOM 侧用 rAF 节流读取，避免每帧重渲染。',
    ],
    limitations: [
      '尚未接入自写色调映射与 HDR 渲染目标（见 p0-hdr）。',
      'GPU 时间未采集：renderer.info 不含 GPU 时间，需接 EXT_disjoint_timer_query_webgl2（见 p0-gbuffer-hud）。',
      '场景为程序化占位，真实资产待 p0-assets 补齐。',
      '材质使用 three 内置 PBR，自写 GGX BRDF 待 p1-pbr-ibl 替换。',
    ],
    sources: [
      { label: 'react-three-fiber 文档', href: 'https://r3f.docs.pmnd.rs/' },
      { label: 'three.js 文档', href: 'https://threejs.org/docs/' },
    ],
  },
  {
    id: 'hdr',
    title: 'HDR 管线与色调映射',
    oneLiner: '在 8bit 后缓冲里塞不进真实亮度范围，需要 HDR 缓冲 + 一条可验证的映射曲线。',
    layer: 'L1',
    stack: 'WebGL2 / WebGPU',
    perf: 'realtime',
    metric: 'ACES / AgX 可切换 · EV 滑杆',
    effort: '2–3 天',
    status: 'planned',
    algorithm: [
      '场景渲到 RGBA16F 目标，避免高光在进入映射前就被截断。',
      'ACES / AgX / Reinhard 三种曲线切换，附曲线图对照。',
      '自动曝光：亮度直方图统计 + 异步回读，曝光以 EV 为单位。',
      '物理 bloom：mip 链下采样再上采样，按亮度阈值提取。',
    ],
    formulas: ['ACES: (x(2.51x+0.03))/(x(2.43x+0.59)+0.14)', 'AgX: 3x3 原色变换 + 对数编码 + 曲线 sigmoid'],
    limitations: ['自动曝光在场景突变时会有 1–2 帧迟滞。', '半精度 HDR 目标在极暗部会出现条带。'],
    sources: [{ label: 'ACES 规范', href: 'https://github.com/ampas/aces-dev' }],
  },
  {
    id: 'pbr-ibl',
    title: 'PBR 直接光 + IBL',
    oneLiner: '金属看起来像塑料，通常是 BRDF 不守恒或环境光只用了一个常数。',
    layer: 'L1',
    stack: 'three.js + 自写 shader',
    perf: 'realtime',
    metric: '白炉测试 ±2% 能量误差',
    effort: '3–4 天',
    status: 'planned',
    algorithm: [
      'GGX 法线分布 + Smith height-correlated 遮蔽 + Schlick 菲涅耳。',
      '金属/非金属按 F0 分支，分母 (n·l)(n·v) 做除零保护。',
      'IBL split-sum：辐照度图 + 按粗糙度预滤波 radiance + BRDF LUT。',
      '白炉测试验证能量守恒（半球积分 ≤ 1）。',
    ],
    formulas: ['fr = F·D·G / (4(n·l)(n·v))', 'D_GGX = α² / (π((n·h)²(α²−1)+1)²)'],
    limitations: ['单次散射 GGX 在强粗糙度下损失多次散射能量，暗部偏黑。', 'split-sum 对掠射角近似较差。'],
    sources: [{ label: 'PBRT', href: 'https://pbr-book.org/' }],
  },
  {
    id: 'shadows',
    title: '阴影全家桶',
    oneLiner: 'shadow map 只是用深度比较粗暴替代可见性积分，于是所有伪影都来自这一替换。',
    layer: 'L1',
    stack: 'WebGL2',
    perf: 'realtime',
    metric: '5 种算法 A/B · acne 与 peter-panning 演示',
    effort: '5–8 天',
    status: 'planned',
    algorithm: [
      'SM / PCF / PCSS / CSM / VSM 五种实现，下拉切换与参数暴露。',
      'PCSS 用 blocker search 估计半影宽度，半影 ≈ 遮挡距离 × 光源张角。',
      'CSM 按视锥切分并做级联间混合，cascade 分层着色可视化。',
      'bias / slope-scale / normal-offset 三种补偿对照。',
    ],
    limitations: ['PCSS 采样数随光源尺寸上升，需半分辨率加速。', 'VSM 在重叠遮挡处漏光。'],
    sources: [{ label: 'Real-Time Shadows', href: 'https://www.realtimeshadows.com/' }],
  },
  {
    id: 'bake-gi',
    title: '烘焙 Lightmap + SH 探针',
    oneLiner: '移动端与低配的兜底方案，价值在可预测的运行时成本而非画质上限。',
    layer: 'L2',
    stack: 'Node CLI 烘焙器 + WebGL2',
    perf: 'baked',
    metric: '烘焙耗时 / 产物体积 / 运行时开销 三个数字',
    effort: '7–11 天',
    status: 'planned',
    algorithm: [
      'UV2 无重叠展开 + 半球/射线采样烘焙，可选出方向性（每像素 SH）。',
      '探针布点后每探针烘 L1/L2 球谐系数，运行时四面体插值。',
      '动态物体通过 SH 探针接入静态 GI。',
      '烘焙器做成 Node CLI，产物入库、可复现、带版本号。',
    ],
    formulas: ['L = Σₖ Tᵏ·Le', 'SH L1 插值：E(n) ≈ Σ cᵢ Yᵢ(n)'],
    limitations: ['动态光照与动态几何无法响应。', '探针密度不足时出现漏光与梯度断层。'],
    sources: [{ label: 'Lightmap 综述', href: 'https://en.wikipedia.org/wiki/Lightmap' }],
  },
  {
    id: 'ssgi',
    title: 'GTAO / SSGI + 降噪',
    oneLiner: '屏幕空间拿不到屏幕外的信息，所以它的失效案例比它的效果更值得展示。',
    layer: 'L3',
    stack: 'WebGL2 / WebGPU',
    perf: 'hybrid',
    metric: '半分辨率 ray march · 时域累积 1→64 帧',
    effort: '8–13 天',
    status: 'planned',
    algorithm: [
      'GTAO：沿视线做水平角积分，多次弹射近似，AO 只是漫反射 GI 的副产物。',
      'SSGI：G-buffer ray march，命中处复用上一帧屏幕颜色作为一次间接光。',
      '降噪：时域重投影 + 法线/深度/亮度三权重拒绝 + 空域边缘保持滤波。',
      '半分辨率求解 + 双边上采样控制成本。',
    ],
    limitations: ['屏幕外物体完全不参与贡献，相机转动时出现明显能量跳变。', '时域累积在 disocclusion 处产生残影。'],
    sources: [{ label: 'GTAO 论文', href: 'https://www.activision.com/cdn/research/ground_truth_ambient_occlusion.pdf' }],
  },
  {
    id: 'deep-gi',
    title: '深水区（四选一）',
    oneLiner: 'VXGI / SDF GI / DDGI / 实时 PT —— 只选一条做深，其余以对比 demo 轻量呈现。',
    layer: 'L3',
    stack: 'WebGPU compute',
    perf: 'realtime',
    metric: '收敛过程动画 · 探针/体素中间量可视化',
    effort: '8–20 天',
    status: 'planned',
    algorithm: [
      '四者都需要世界空间辐照度缓存，先抽象出这一层再二选一，避免重复造轮子。',
      'WebGL2 无 compute：体素化、探针更新、BVH 重建必须上 WebGPU。',
      '启用 WebGPU 时在 createRenderer 单点分叉，避免两套 demo 代码。',
    ],
    limitations: ['Web 端无硬件光追，路径追踪必须靠累积或离线烘焙。', 'WebGPU 覆盖需逐版本实测，必须配降级路径。'],
    sources: [{ label: 'WebGPU 规范', href: 'https://www.w3.org/TR/webgpu/' }],
  },
]

export const DEMO_BY_ID = new Map(DEMOS.map((demo) => [demo.id, demo]))
