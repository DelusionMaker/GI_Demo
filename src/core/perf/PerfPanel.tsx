import { useEffect, useRef } from 'react'
import { useCapabilities } from '../capabilities'
import { perfStats } from './perfStats'

const REFRESH_MS = 200

/**
 * 性能面板（文档「每个 demo 必备八块内容」第 6 条）。
 * 用 rAF 节流直接写 DOM，绕过 React 更新 —— 面板本身不允许影响被测对象。
 */
export function PerfPanel() {
  const caps = useCapabilities()
  const fpsRef = useRef<HTMLSpanElement>(null)
  const frameRef = useRef<HTMLSpanElement>(null)
  const drawRef = useRef<HTMLSpanElement>(null)
  const triRef = useRef<HTMLSpanElement>(null)
  const dprRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    let raf = 0
    let last = 0
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (now - last < REFRESH_MS) return
      last = now
      const set = (el: HTMLSpanElement | null, text: string) => {
        if (el && el.textContent !== text) el.textContent = text
      }
      set(fpsRef.current, perfStats.fps.toFixed(0))
      set(frameRef.current, `${perfStats.frameMs.toFixed(1)} ms`)
      set(drawRef.current, String(perfStats.drawCalls))
      set(triRef.current, formatCount(perfStats.triangles))
      set(dprRef.current, `×${perfStats.dpr.toFixed(2)}`)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="panel perf-panel">
      <div className="panel-head">
        <span className="panel-title">性能</span>
        <span className={`badge badge-${caps.backend}`}>{caps.backend === 'webgpu' ? 'WebGPU' : 'WebGL2'}</span>
      </div>
      <div className="perf-grid">
        <Metric label="FPS" valueRef={fpsRef} />
        <Metric label="帧时间" valueRef={frameRef} />
        <Metric label="Draw call" valueRef={drawRef} />
        <Metric label="三角形" valueRef={triRef} />
        <Metric label="DPR" valueRef={dprRef} />
        <Metric label="GPU 时间" value="—" hint="待接计时扩展" />
      </div>
      <div className="panel-note">
        浮点 RT {caps.colorBufferFloat ? '✓' : '✗'} · 浮点线性过滤{' '}
        {caps.floatLinear ? '✓' : '✗'} · 计时扩展 {caps.timerQuery ? '✓' : '✗'}
      </div>
    </div>
  )
}

function Metric({
  label,
  value,
  valueRef,
  hint,
}: {
  label: string
  value?: string
  valueRef?: React.RefObject<HTMLSpanElement | null>
  hint?: string
}) {
  return (
    <div className="perf-metric">
      <span className="perf-key">{label}</span>
      <span className="perf-val" ref={valueRef} title={hint}>
        {value ?? '0'}
      </span>
    </div>
  )
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}
