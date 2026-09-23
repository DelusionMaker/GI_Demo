import type { ReactNode } from 'react'

export interface HudProps {
  topLeft?: ReactNode
  topRight?: ReactNode
  bottomLeft?: ReactNode
  bottomRight?: ReactNode
}

/**
 * 统一 HUD 容器：覆盖在画布之上，四角插槽。
 * 容器本身 pointer-events: none，只有插槽内容恢复交互，
 * 避免遮住画布的拖拽/缩放操作。
 */
export function Hud({ topLeft, topRight, bottomLeft, bottomRight }: HudProps) {
  return (
    <div className="hud">
      <div className="hud-row hud-row-top">
        <div className="hud-slot">{topLeft}</div>
        <div className="hud-slot hud-slot-end">{topRight}</div>
      </div>
      <div className="hud-spacer" />
      <div className="hud-row hud-row-bottom">
        <div className="hud-slot">{bottomLeft}</div>
        <div className="hud-slot hud-slot-end">{bottomRight}</div>
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
