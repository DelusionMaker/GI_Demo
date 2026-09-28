import type { ReactNode } from 'react'

export interface HudProps {
  topLeft?: ReactNode
  topRight?: ReactNode
  bottomLeft?: ReactNode
  bottomRight?: ReactNode
}

/**
 * 统一 HUD 容器：覆盖在画布之上，左右两列 × 上下两端。
 *
 * 为什么是「两列」而不是「两行」：两行结构会让左右两侧的高度互相拖累
 * —— 右上角面板一变高，左下角面板就被推下去、盖出画布。
 * 两列结构下任一侧长高都不影响另一侧的底部对齐。
 *
 * 容器本身 pointer-events: none，只有插槽内容恢复交互，
 * 避免遮住画布的拖拽 / 缩放操作。插槽可收缩并内部滚动，
 * 因此面板数量增长不会撑破画布（e2e 有布局断言守着）。
 */
export function Hud({ topLeft, topRight, bottomLeft, bottomRight }: HudProps) {
  return (
    <div className="hud">
      <div className="hud-col">
        <div className="hud-slot">{topLeft}</div>
        <div className="hud-spacer" />
        <div className="hud-slot">{bottomLeft}</div>
      </div>
      <div className="hud-col hud-col-end">
        <div className="hud-slot">{topRight}</div>
        <div className="hud-spacer" />
        <div className="hud-slot">{bottomRight}</div>
      </div>
    </div>
  )
}

export function HudTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="hud-title">
      <div className="hud-title-main">{title}</div>
      {subtitle ? <div className="hud-title-sub">{subtitle}</div> : null}
    </div>
  )
}

export function HudHint({ children }: { children: ReactNode }) {
  return <div className="hud-hint">{children}</div>
}
