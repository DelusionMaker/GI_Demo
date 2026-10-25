import { observer } from 'mobx-react-lite'
import { Panel, Select, Slider, Toggle, type SelectOption } from '../controls/ControlPanel'
import { shadowParams } from './shadowParams'
import type { ShadowBiasMode, ShadowMode } from './shadowTypes'

const MODE_OPTIONS: SelectOption<ShadowMode>[] = [
  { value: 'hard', label: 'SM（硬阴影）' },
  { value: 'pcf', label: 'PCF' },
  { value: 'pcss', label: 'PCSS' },
]

const BIAS_OPTIONS: SelectOption<ShadowBiasMode>[] = [
  { value: 'none', label: '不做补偿' },
  { value: 'constant', label: '常数深度偏移' },
  { value: 'normal', label: '法线偏移' },
  { value: 'slope', label: '斜率缩放' },
]

type CascadeValue = '1' | '2' | '3' | '4'
const CASCADE_OPTIONS: SelectOption<CascadeValue>[] = [
  { value: '1', label: '1 级（单张）' },
  { value: '2', label: '2 级' },
  { value: '3', label: '3 级' },
  { value: '4', label: '4 级 CSM' },
]

type MapSizeValue = '1024' | '2048' | '4096'
const MAP_SIZE_OPTIONS: SelectOption<MapSizeValue>[] = [
  { value: '1024', label: '1024²' },
  { value: '2048', label: '2048²' },
  { value: '4096', label: '4096²' },
]

/**
 * p1-shadow 控制面板。
 *
 * 这里负责「把原料参数化」：图集由 ShadowMapPass 生成，
 * 可见性计算在 gbuffer.frag 的 shadowFactor()（SM / PCF / PCSS + 三种 bias 已实现）。
 *
 * 调试视图入口在 HDR 面板的「调试视图」下拉：
 * - 阴影 · 深度图集（shadow:atlas）
 * - 阴影 · cascade 分层（shadow:cascade）
 */
export const ShadowPanel = observer(function ShadowPanel() {
  const p = shadowParams.params

  return (
    <Panel title="阴影" onReset={() => shadowParams.reset()}>
      <Toggle
        label="实时阴影"
        hint="自写 shadowFactor：SM / PCF / PCSS + 三种 bias"
        value={p.shadow}
        onChange={(value) => shadowParams.set({ shadow: value })}
      />

      <Select
        label="算法"
        value={p.shadowMode}
        options={MODE_OPTIONS}
        onChange={(value) => shadowParams.set({ shadowMode: value })}
      />

      <Select
        label="级联"
        value={String(p.shadowCascades) as CascadeValue}
        options={CASCADE_OPTIONS}
        onChange={(value) => shadowParams.set({ shadowCascades: Number(value) })}
      />

      <Select
        label="阴影贴图"
        value={String(p.shadowMapSize) as MapSizeValue}
        options={MAP_SIZE_OPTIONS}
        onChange={(value) => shadowParams.set({ shadowMapSize: Number(value) })}
      />

      <Select
        label="Bias 补偿"
        value={p.shadowBiasMode}
        options={BIAS_OPTIONS}
        onChange={(value) => shadowParams.set({ shadowBiasMode: value })}
      />

      <Slider
        label="深度偏移"
        min={0}
        max={0.005}
        step={0.0001}
        digits={4}
        value={p.shadowBias}
        onChange={(value) => shadowParams.set({ shadowBias: value })}
      />

      <Slider
        label="法线偏移"
        min={0}
        max={0.1}
        step={0.002}
        digits={3}
        value={p.shadowNormalBias}
        onChange={(value) => shadowParams.set({ shadowNormalBias: value })}
      />

      <Slider
        label="PCF 半径"
        min={0}
        max={5}
        step={0.1}
        digits={1}
        value={p.shadowPCFRadius}
        onChange={(value) => shadowParams.set({ shadowPCFRadius: value })}
      />

      <Slider
        label="PCSS 光源尺寸"
        min={0.002}
        max={0.2}
        step={0.002}
        digits={3}
        value={p.shadowLightSize}
        onChange={(value) => shadowParams.set({ shadowLightSize: value })}
      />

      <Slider
        label="阴影强度"
        min={0}
        max={1}
        step={0.05}
        digits={2}
        value={p.shadowStrength}
        onChange={(value) => shadowParams.set({ shadowStrength: value })}
      />

      <Slider
        label="阴影距离"
        min={10}
        max={120}
        step={5}
        digits={0}
        unit=" u"
        value={p.shadowDistance}
        onChange={(value) => shadowParams.set({ shadowDistance: value })}
      />
    </Panel>
  )
})
