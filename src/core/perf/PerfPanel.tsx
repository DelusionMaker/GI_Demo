import { observer } from 'mobx-react-lite'
import { useEffect } from 'react'
import { capabilitiesStore } from '../capabilities'
import { perfStore } from './perfStore'

/**
 * 性能面板（文档「每个 demo 必备八块内容」第 6 条）。
 * 数据源是 PerfStore（5Hz 采样），因此这里可以写成普通 observer 组件 ——
 * 每帧采集发生在画布内的 PerfProbe，不会引发这里的重渲染。
 */
export const PerfPanel = observer(function PerfPanel() {
  useEffect(() => {
    perfStore.startSampling()
    return () => perfStore.stopSampling()
  }, [])

  const caps = capabilitiesStore

  return (
    <div className="panel perf-panel">
      <div className="panel-head">
        <span className="panel-title">性能</span>
        <span className={`badge badge-${caps.backend}`}>{caps.label}</span>
      </div>
      <div className="perf-grid">
        <Metric label="FPS" value={perfStore.fps.toFixed(0)} />
        <Metric label="帧时间" value={`${perfStore.frameMs.toFixed(1)} ms`} />
        <Metric label="Draw call" value={String(perfStore.drawCalls)} />
        <Metric label="三角形" value={formatCount(perfStore.triangles)} />
        <Metric label="DPR" value={`×${perfStore.dpr.toFixed(2)}`} />
        <Metric
          label="GPU 时间"
          value={perfStore.gpuMs === null ? '—' : `${perfStore.gpuMs.toFixed(2)} ms`}
          hint={perfStore.gpuMs === null ? '待接计时扩展' : undefined}
        />
      </div>
      <div className="panel-note">
        浮点 RT {caps.colorBufferFloat ? '✓' : '✗'} · 浮点线性过滤{' '}
        {caps.floatLinear ? '✓' : '✗'} · 计时扩展 {caps.timerQuery ? '✓' : '✗'}
      </div>
    </div>
  )
})

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="perf-metric">
      <span className="perf-key">{label}</span>
      <span className="perf-val" title={hint}>
        {value}
      </span>
    </div>
  )
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}
