import type { ReactNode } from 'react'
import { useState } from 'react'

export interface PanelProps {
  title: string
  children: ReactNode
  onReset?: () => void
  defaultOpen?: boolean
}

/** 可折叠参数面板。移动端默认提供折叠能力，避免盖满画布。 */
export function Panel({ title, children, onReset, defaultOpen = true }: PanelProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">{title}</span>
        <div className="panel-actions">
          {onReset ? (
            <button type="button" className="btn btn-ghost" onClick={onReset}>
              重置
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost"
            aria-expanded={open}
            aria-label={open ? '收起面板' : '展开面板'}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? '收起' : '展开'}
          </button>
        </div>
      </div>
      {open ? <div className="panel-body">{children}</div> : null}
    </div>
  )
}

export interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  digits?: number
  unit?: string
  onChange: (value: number) => void
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  digits = 2,
  unit = '',
  onChange,
}: SliderProps) {
  return (
    <label className="ctl-row">
      <span className="ctl-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="ctl-value">
        {value.toFixed(digits)}
        {unit}
      </span>
    </label>
  )
}

export interface ToggleProps {
  label: string
  value: boolean
  onChange: (value: boolean) => void
  hint?: string
}

export function Toggle({ label, value, onChange, hint }: ToggleProps) {
  return (
    <label className="ctl-row ctl-row-inline">
      <input
        type="checkbox"
        checked={value}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="ctl-label ctl-label-wide">{label}</span>
      {hint ? <span className="ctl-hint">{hint}</span> : null}
    </label>
  )
}

export interface SelectOption<V extends string> {
  value: V
  label: string
}

export interface SelectProps<V extends string> {
  label: string
  value: V
  options: SelectOption<V>[]
  onChange: (value: V) => void
}

/** 也是「中间量可视化」下拉项的载体：G-buffer / cascade 分层 / 探针图集 / 方差图 */
export function Select<V extends string>({ label, value, options, onChange }: SelectProps<V>) {
  return (
    <label className="ctl-row">
      <span className="ctl-label">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as V)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function Button({
  children,
  onClick,
  active = false,
}: {
  children: ReactNode
  onClick: () => void
  active?: boolean
}) {
  return (
    <button type="button" className={`btn${active ? ' btn-active' : ''}`} onClick={onClick}>
      {children}
    </button>
  )
}
