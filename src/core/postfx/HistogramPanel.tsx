import { observer } from 'mobx-react-lite'
import { useEffect, useRef } from 'react'
import { hdrStore } from './hdrStore'
import { HIST_BINS, LOG_MAX, LOG_MIN } from './passes/LuminancePass'

/**
 * 亮度直方图面板（文档筛选标准 #2「有可视化的中间量」）。
 *
 * 横轴是 log2 亮度（EV），范围 [LOG_MIN, LOG_MAX]；纵轴是分桶计数（归一化到最高桶）。
 * 直方图按当前生效曝光平移，所以拖动 EV 滑杆 / 自动曝光收敛时，整条分布会左右平移，
 * 肉眼即可验证「曝光变了，亮部/暗部分布随之移动」。
 */

const WIDTH = 236
const HEIGHT = 96
const PAD = { left: 8, right: 8, top: 8, bottom: 14 }

export const HistogramPanel = observer(function HistogramPanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

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

    const bins = hdrStore.histogram
    const plotW = WIDTH - PAD.left - PAD.right
    const plotH = HEIGHT - PAD.top - PAD.bottom

    // 纵轴按最高桶归一化，避免单帧噪声把整图压扁
    let maxCount = 1
    for (let i = 0; i < bins.length; i += 1) maxCount = Math.max(maxCount, bins[i])

    const barW = plotW / HIST_BINS
    for (let i = 0; i < HIST_BINS; i += 1) {
      const h = (bins[i] / maxCount) * plotH
      const x = PAD.left + i * barW
      // 中灰（displayEV≈0 时 log 亮度≈0，即偏左半区）附近略提亮，便于定位
      ctx.fillStyle = 'rgba(47,107,255,0.75)'
      ctx.fillRect(x, PAD.top + plotH - h, Math.max(1, barW - 0.5), h)
    }

    // 中灰参考线（log 亮度 = 0 → 居中的位置）
    const midX = PAD.left + ((0 - LOG_MIN) / (LOG_MAX - LOG_MIN)) * plotW
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'
    ctx.setLineDash([2, 2])
    ctx.beginPath()
    ctx.moveTo(midX, PAD.top)
    ctx.lineTo(midX, PAD.top + plotH)
    ctx.stroke()
    ctx.setLineDash([])

    // 轴标注
    ctx.fillStyle = 'rgba(255,255,255,0.34)'
    ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.fillText(`${LOG_MIN} EV`, PAD.left - 2, HEIGHT - 3)
    ctx.fillText(`+${LOG_MAX}`, WIDTH - PAD.right - 22, HEIGHT - 3)
  }, [hdrStore.histogram])

  return (
    <div className="curve-graph">
      <canvas
        ref={canvasRef}
        style={{ width: WIDTH, height: HEIGHT }}
        role="img"
        aria-label="亮度直方图（log2 亮度轴）"
      />
      <div className="curve-graph-note">亮度直方图 · 虚线为 0 EV 中灰参考 · 随曝光平移</div>
    </div>
  )
})
