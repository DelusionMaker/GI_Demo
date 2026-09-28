import { observer } from 'mobx-react-lite'
import { useEffect, useRef } from 'react'
import { hdrParams } from './hdrParams'
import { CURVE_DOMAIN_MAX, isCurveImplemented, linearCurve, resolveCurve } from './toneCurves'

/**
 * 色调映射曲线对照图（文档要求的「曲线图」）。
 *
 * 画两条线：
 * - 虚线：直通参照 y = x
 * - 实线：当前选中的曲线（调用 toneCurves.ts 里的实现）
 *
 * 曲线未实现时用告警色并把提示画在图上 —— 让"还没做"这件事在界面上是可见的，
 * 而不是看起来像做坏了。
 *
 * 注意：这里画的是 CPU 版曲线，与 GPU 着色器是两份实现，
 * 同步策略见 toneCurves.ts 顶部说明。
 */

const WIDTH = 236
const HEIGHT = 132
const PAD = { left: 28, right: 8, top: 10, bottom: 16 }
/** 纵轴上限：略高于 1 以便看清 shoulder 的收敛过程 */
const Y_MAX = 1.25

export const ToneCurveGraph = observer(function ToneCurveGraph() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mode = hdrParams.params.tm

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(WIDTH * dpr)
    canvas.height = Math.round(HEIGHT * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, WIDTH, HEIGHT)

    const plotW = WIDTH - PAD.left - PAD.right
    const plotH = HEIGHT - PAD.top - PAD.bottom
    const toX = (x: number) => PAD.left + (Math.max(0, x) / CURVE_DOMAIN_MAX) * plotW
    // 不在这里 clamp：超出绘图区的部分交给 clip 处理，
    // 否则曲线会被折出一条假的"肩部"，看起来像已经压过平了
    const toY = (y: number) => PAD.top + plotH - (y / Y_MAX) * plotH

    // 网格
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'
    ctx.lineWidth = 1
    for (let i = 0; i <= 4; i += 1) {
      const y = PAD.top + (plotH / 4) * i
      ctx.beginPath()
      ctx.moveTo(PAD.left, y)
      ctx.lineTo(WIDTH - PAD.right, y)
      ctx.stroke()
      const x = PAD.left + (plotW / 4) * i
      ctx.beginPath()
      ctx.moveTo(x, PAD.top)
      ctx.lineTo(x, PAD.top + plotH)
      ctx.stroke()
    }

    // 曲线一律裁剪到绘图区内，超出的部分自然出界
    ctx.save()
    ctx.beginPath()
    ctx.rect(PAD.left, PAD.top, plotW, plotH)
    ctx.clip()

    // 直通参照（虚线）
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(toX(0), toY(0))
    ctx.lineTo(toX(CURVE_DOMAIN_MAX), toY(linearCurve(CURVE_DOMAIN_MAX)))
    ctx.stroke()
    ctx.setLineDash([])

    // 当前曲线
    const curve = resolveCurve(mode)
    const implemented = isCurveImplemented(mode)
    ctx.strokeStyle = implemented ? '#2f6bff' : 'rgba(217,138,75,0.9)'
    ctx.lineWidth = 1.6
    ctx.beginPath()
    const STEPS = 160
    for (let i = 0; i <= STEPS; i += 1) {
      const x = (i / STEPS) * CURVE_DOMAIN_MAX
      const y = curve(x)
      const px = toX(x)
      const py = toY(Number.isFinite(y) ? y : 0)
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.stroke()
    ctx.restore()

    // 轴标注
    ctx.fillStyle = 'rgba(255,255,255,0.34)'
    ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.fillText('in 0', PAD.left - 2, HEIGHT - 5)
    ctx.fillText(String(CURVE_DOMAIN_MAX), WIDTH - PAD.right - 8, HEIGHT - 5)
    ctx.fillText('out 1', 2, toY(1) + 3)

    if (!implemented) {
      ctx.fillStyle = 'rgba(217,138,75,0.95)'
      ctx.font = '10px sans-serif'
      ctx.fillText('曲线未实现（见 toneCurves.ts）', PAD.left + 4, PAD.top + 12)
    }
  }, [mode])

  return (
    <div className="curve-graph">
      <canvas
        ref={canvasRef}
        style={{ width: WIDTH, height: HEIGHT }}
        role="img"
        aria-label={`色调映射曲线对照图，当前 ${mode}`}
      />
      <div className="curve-graph-note">
        虚线为直通参照 · 横轴输入 0–{CURVE_DOMAIN_MAX} · 纵轴输出 0–{Y_MAX}
      </div>
    </div>
  )
})
