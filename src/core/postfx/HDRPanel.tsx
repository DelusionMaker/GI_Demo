import { observer } from 'mobx-react-lite'
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

  const debugOptions: SelectOption<string>[] = [
    { value: 'none', label: '完整链路' },
    ...runtime.passNames.map((name) => ({ value: name, label: `仅到 ${name} 为止` })),
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
