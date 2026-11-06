import { observer } from 'mobx-react-lite'
import { useEffect } from 'react'
import { capabilitiesStore } from '../capabilities'
import { clusterStore } from '../postfx/clusterStore'
import { hdrStore } from '../postfx/hdrStore'
import { perfStore } from './perfStore'

/**
 * 性能面板（文档「每个 demo 必备八块内容」第 6 条）。
 *
 * 数据来源全部是 5Hz 采样的 observable：
 * - PerfStore ← 画布内 PerfProbe 每帧写入的 perfStats
 * - HdrStore ← HDRPipeline 每帧写入的各 pass 计时
 * 因此本组件可以写成普通 observer 组件，不会随帧率重渲染。
 */
export const PerfPanel = observer(function PerfPanel() {
  useEffect(() => {
    perfStore.startSampling()
    clusterStore.startSampling()
    return () => {
      perfStore.stopSampling()
      clusterStore.stopSampling()
    }
  }, [])

  const caps = capabilitiesStore
  const passTimes = hdrStore.passTimes
  const cluster = clusterStore

  // 整帧 GPU 时间 = 各启用 pass 的实测之和（没有一条可用时显示「—」）
  const gpuSamples = passTimes.filter((pass) => pass.gpuMs !== null)
  const gpuTotalMs =
    gpuSamples.length > 0 ? gpuSamples.reduce((sum, pass) => sum + (pass.gpuMs ?? 0), 0) : null

  // 压缩比：clustered 平均每 cluster 灯数 / 实际灯数，越小说明剔除越有效
  const savedRatio =
    cluster.enabled && cluster.activeLights > 0
      ? 1 - cluster.avgLightsPerCluster / cluster.activeLights
      : null
  const lightTruncated = cluster.activeLights < cluster.requestedLights

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
          value={gpuTotalMs === null ? '—' : `${gpuTotalMs.toFixed(2)} ms`}
          hint={
            gpuTotalMs === null
              ? '设备不支持 EXT_disjoint_timer_query_webgl2'
              : '各启用 pass 的 GPU 实测之和'
          }
        />
      </div>

      {passTimes.length > 0 ? (
        <div className="perf-passes">
          {passTimes.map((pass) => (
            <div className="perf-pass-row" key={pass.name}>
              <span className="perf-key">{pass.name}</span>
              <span className="perf-val-sm">
                {pass.cpuMs.toFixed(2)} ms CPU
                {pass.gpuMs !== null && ` · ${pass.gpuMs.toFixed(2)} ms GPU`}
              </span>
            </div>
          ))}
          <div className="perf-pass-row perf-pass-total">
            <span className="perf-key">链路合计</span>
            <span className="perf-val-sm">{hdrStore.totalMs.toFixed(2)} ms</span>
          </div>
          {passTimes.some((p) => p.gpuMs !== null) ? (
            <div className="perf-pass-note">CPU 侧提交耗时 · GPU 时间为实测（EXT_disjoint_timer_query_webgl2）</div>
          ) : (
            <div className="perf-pass-note">CPU 侧提交耗时 · GPU 计时不可用（设备不支持 EXT_disjoint_timer_query_webgl2）</div>
          )}

          {/* p1-light-ssr S3-d：多光源 / 剔除的归因。5Hz 采样，不随帧重渲染 */}
          <div className="panel-note perf-cluster">
            Clustered 剔除 ·{' '}
            {cluster.enabled ? '已启用' : cluster.requestedLights > 0 ? '已关闭（暴力前向）' : '无额外光源'}
          </div>
          <div className="perf-pass-row">
            <span className="perf-key">光源</span>
            <span className="perf-val-sm">
              {cluster.activeLights} / {cluster.requestedLights} 盏
            </span>
          </div>
          {cluster.enabled ? (
            <>
              <div className="perf-pass-row">
                <span className="perf-key">平均每 cluster</span>
                <span className="perf-val-sm">{cluster.avgLightsPerCluster.toFixed(2)} 盏</span>
              </div>
              <div className="perf-pass-row">
                <span className="perf-key">每 cluster 峰值</span>
                <span className="perf-val-sm">{cluster.maxLightsPerCluster} 盏（热力分母）</span>
              </div>
              <div className="perf-pass-row">
                <span className="perf-key">循环节省</span>
                <span className="perf-val-sm">
                  {savedRatio === null ? '—' : `${(savedRatio * 100).toFixed(1)}%`}
                </span>
              </div>
              <div className="perf-pass-row">
                <span className="perf-key">剔除 CPU</span>
                <span className="perf-val-sm">{cluster.cullCpuMs.toFixed(2)} ms</span>
              </div>
              <div className="perf-pass-row">
                <span className="perf-key">有灯 cluster</span>
                <span className="perf-val-sm">
                  {formatCount(cluster.litClusters)} / {formatCount(cluster.totalClusters)}
                </span>
              </div>
            </>
          ) : null}
          {lightTruncated || cluster.truncatedClusters > 0 ? (
            <div className="perf-pass-note">
              灯数已达上限：请求 {cluster.requestedLights} 盏，只生效 {cluster.activeLights} 盏
              {cluster.truncatedClusters > 0
                ? `；${cluster.truncatedClusters} 个 cluster 被截断（会漏光）`
                : ''}
            </div>
          ) : null}
        </div>
      ) : null}

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
