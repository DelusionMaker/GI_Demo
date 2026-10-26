import { observer } from 'mobx-react-lite'
import { capabilitiesStore } from '../capabilities'
import { Panel, Select, Slider, Toggle, type SelectOption } from '../controls/ControlPanel'
import type { TonemapMode } from './HDRPipeline'
import { hdrParams } from './hdrParams'
import { hdrStore } from './hdrStore'
import { ToneCurveGraph } from './ToneCurveGraph'
import { HistogramPanel } from './HistogramPanel'

const TONEMAP_OPTIONS: SelectOption<TonemapMode>[] = [
  { value: 'linear', label: '直通（无映射）' },
  { value: 'aces', label: 'ACES' },
  { value: 'agx', label: 'AgX' },
  { value: 'reinhard', label: 'Reinhard' },
]

/**
 * HDR 链路的公共控制面板：所有 demo 共用。
 *
 * 承载三项文档要求：
 * - 「交互控制面板」：EV 滑杆 / 曲线下拉 / 旁路开关，状态进 URL
 * - 「降级路径必须显式标注」：浮点目标不可用时标红
 * - 「中间量可视化」：调试视图下拉 + 曲线对照图
 */
export const HDRPanel = observer(function HDRPanel() {
  const runtime = hdrStore
  const knobs = hdrParams.params

  if (!runtime.pipelineActive) return null

  // G-buffer 三层是 MRT 的原始数据（S3）；无 MRT 的降级环境不提供，避免选到黑屏
  const gbufferOptions: SelectOption<string>[] = capabilitiesStore.mrt
    ? [
        { value: 'gbuffer:albedo', label: 'G-buffer · gAlbedo（原始值）' },
        { value: 'gbuffer:normal', label: 'G-buffer · gNormal' },
        { value: 'gbuffer:mrao', label: 'G-buffer · gMRAO' },
      ]
    : []

  // p1-shadow：深度图集 / cascade 分层。两者都不是「按 pass 截断」，
  // 由 HDRDriver 分流到 ShadowDebugPass 或 gbuffer.frag 的调试分支。
  const shadowOptions: SelectOption<string>[] = [
    { value: 'shadow:atlas', label: '阴影 · 深度图集' },
    { value: 'shadow:cascade', label: '阴影 · cascade 分层' },
  ]

  // p1-light-ssr S2：Clustered 网格可视化（在 gbuffer.frag 内渲染，非 pass 截断）。
  const clusterOptions: SelectOption<string>[] = [
    { value: 'cluster:tiles', label: 'Clustered · tile 叠加' },
    { value: 'cluster:heat', label: 'Clustered · 灯数热力' },
  ]

  const debugOptions: SelectOption<string>[] = [
    { value: 'none', label: '完整链路' },
    // 两个调试出口本身不作为「截断点」；shadow-map 是辅助 pass，
    // 截断到它没有可呈现的主链颜色（会得到黑屏）。
    ...runtime.passNames
      .filter((name) => name !== 'gbuffer-debug' && name !== 'shadow-debug' && name !== 'shadow-map')
      .map((name) => ({ value: name, label: `仅到 ${name} 为止` })),
    ...gbufferOptions,
    ...shadowOptions,
    ...clusterOptions,
  ]

  return (
    <Panel title="HDR 链路">
      <div className="ctl-row">
        <span className="ctl-label">RT 档位</span>
        <span className={`badge ${runtime.hdrActive ? 'badge-ok' : 'badge-warn'}`}>
          {runtime.hdrActive ? runtime.hdrFormat : `${runtime.hdrFormat}（已降级）`}
        </span>
      </div>

      <Slider
        label="曝光"
        min={-4}
        max={4}
        step={0.1}
        digits={1}
        unit=" EV"
        value={knobs.ev}
        onChange={(value) => hdrParams.set({ ev: value })}
      />

      <Select
        label="曲线"
        value={knobs.tm}
        options={TONEMAP_OPTIONS}
        onChange={(value) => hdrParams.set({ tm: value })}
      />

      <ToneCurveGraph />

      <Toggle
        label="自动曝光"
        hint="luminance 测光 pass 跨帧算 EV，手动 EV 转为补偿"
        value={knobs.autoexposure}
        onChange={(value) => hdrParams.set({ autoexposure: value })}
      />

      <Toggle
        label="过曝回收诊断"
        hint="任一通道 > 1 的像素染红，展示被 tonemap 救回的高光"
        value={knobs.clipView}
        onChange={(value) => hdrParams.set({ clipView: value })}
      />

      <HistogramPanel />

      <Toggle
        label="Bloom"
        hint="HDR 域内阈值 + mip 链，物理正确的高光光晕"
        value={knobs.bloom}
        onChange={(value) => hdrParams.set({ bloom: value })}
      />

      <Slider
        label="Bloom 强度"
        min={0}
        max={3}
        step={0.1}
        digits={1}
        value={knobs.bloomIntensity}
        onChange={(value) => hdrParams.set({ bloomIntensity: value })}
      />

      <Slider
        label="Bloom 阈值"
        hint="高于该亮度的像素才参与光晕，HDR 线性空间"
        min={0}
        max={4}
        step={0.1}
        digits={1}
        value={knobs.bloomThreshold}
        onChange={(value) => hdrParams.set({ bloomThreshold: value })}
      />

      <Slider
        label="Bloom Knee"
        hint="soft-knee 半宽：阈值附近的柔和过渡区间"
        min={0}
        max={2}
        step={0.05}
        digits={2}
        value={knobs.bloomKnee}
        onChange={(value) => hdrParams.set({ bloomKnee: value })}
      />

      <Toggle
        label="旁路整条链"
        hint="对比接入前的场景直出"
        value={knobs.bypass}
        onChange={(value) => hdrParams.set({ bypass: value })}
      />

      <Select
        label="调试视图"
        value={knobs.hdrDebug}
        options={debugOptions}
        onChange={(value) => hdrParams.set({ hdrDebug: value })}
      />
    </Panel>
  )
})
