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
    title: 'G-buffer MRT + 前向 PBR',
    oneLiner:
      '先把延迟渲染的原料层铺好：三附件 G-buffer（着色 / 法线 / MRAO）+ 自写 Cook-Torrance 直接光，并把这些中间量直接可视化。',
    layer: 'L1',
    stack: 'WebGL2 · MRT',
    perf: 'realtime',
    metric: 'G-buffer MRT · 自写 GGX BRDF · 三层调试视图',
    effort: '2–3 天',
    status: 'wip',
    problem:
      'G-buffer 是 SSR / SSGI / 阴影等屏幕空间特效的原料层；本 demo 验证自建 pass 链能承载 MRT，并把各附件可视化以便逐层核对正确性。',
    algorithm: [
      '场景渲进 3 附件 G-buffer（gAlbedo / gNormal / gMRAO）+ 可采样深度，下游 HDR 链以 gAlbedo 为 beauty。',
      '自写前向 Cook-Torrance 直接光：GGX 法线分布 + Smith 几何遮蔽 + Schlick 菲涅尔。',
      '法线以 world-space 编码进 gNormal（RGBA16F），MRAO 分通道存 metal / roughness / ao / emissive。',
      '调试视图可切 gAlbedo / gNormal / gMRAO，直接查看 MRT 原始数据（不经过 tonemap / 曝光）。',
    ],
    limitations: [
      '自写 BRDF 的光照仍是硬编码单主光 + 占位环境项，多光源与 IBL 待 p1-pbr-ibl。',
      'MSAA 在 MRT 下暂关闭（samples: 0），边缘锯齿依赖后续 MSAA / TAA 方案。',
      'MRT 需要 EXT_color_buffer_float；不支持的设备降级为单目标，G-buffer 选项自动隐藏。',
      '场景为程序化占位，真实资产待 p0-assets 补齐。',
      'GPU 计时仅在支持 EXT_disjoint_timer_query_webgl2 的设备显示，软件渲染器下不可用。',
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
    metric: 'ACES / AgX 可切换 · EV 滑杆 · Bloom 阈值/强度/soft-knee',
    effort: '2–3 天',
    status: 'done',
    algorithm: [
      '场景渲到 RGBA16F 目标，避免高光在进入映射前就被截断。',
      'ACES / AgX / Reinhard 三种曲线切换，附曲线图对照。',
      '自动曝光：亮度直方图统计 + 异步回读，曝光以 EV 为单位。',
      '物理 bloom：soft-knee 亮度阈值提取 → mip 链降采样 → 上采样累加 → 合成回 HDR。',
    ],
    formulas: ['ACES: (x(2.51x+0.03))/(x(2.43x+0.59)+0.14)', 'AgX: 3x3 原色变换 + 对数编码 + 曲线 sigmoid'],
    limitations: [
      '自动曝光在场景突变时会有 1–2 帧迟滞。',
      '半精度 HDR 目标在极暗部会出现条带。',
      'Bloom 在 tonemap 之前叠加于线性 HDR（物理正确），但当前为单帧无时域累积，动画高光会有轻微闪烁。',
      'soft-knee 的 knee 是阈值附近的过渡半宽，需与场景亮度尺度匹配手动调参。',
      'mip 链固定 6 级、起始 0.5 分辨率，极亮小光源的光晕偏粗；移动端可下调 BASE_SCALE。',
    ],
    sources: [{ label: 'ACES 规范', href: 'https://github.com/ampas/aces-dev' }],
  },
  {
    id: 'pbr-ibl',
    title: 'PBR 直接光 + IBL',
    oneLiner: '金属看起来像塑料，通常是 BRDF 不守恒或环境光只用了一个常数。',
    layer: 'L1',
    stack: 'three.js + 自写 shader',
    perf: 'realtime',
    metric: '白炉能量守恒 · split-sum IBL',
    effort: '3–4 天',
    status: 'wip',
    algorithm: [
      'GGX 法线分布 + Smith 几何遮蔽 + Schlick 菲涅耳（前向直接光，已实现）。',
      '直接光参数从场景真实灯光同步（主平行光 + 环境兜底），替代硬编码常量。',
      'IBL split-sum：预滤波环境（CubeCamera + mipmap 近似）+ DFG 近似 + 漫反射辐照度；算法段由本人实现（gbuffer.frag 的 iblDiffuse / iblSpecular）。',
      '白炉测试：环境视为纯白、关闭直接光，验证半球积分能量守恒。',
    ],
    formulas: ['fr = F·D·G / (4(n·l)(n·v))', 'D_GGX = α² / (π((n·h)²(α²−1)+1)²)'],
    limitations: [
      'IBL 算法段（iblDiffuse / iblSpecular）尚未实现：环境光开关暂不产生能量贡献，白炉模式会得到黑屏（占位状态，避免误导已默认关闭）。',
      '环境贴图用 CubeCamera 的 box-filter mip 链近似，非 GGX 重要性采样预滤波；split-sum 对掠射角近似较差。',
      '单次散射 GGX 在强粗糙度下损失多次散射能量，白炉测试会偏暗。',
      '当前为单主平行光；多光源与剔除属 p1-light-ssr 的范围。',
    ],
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
