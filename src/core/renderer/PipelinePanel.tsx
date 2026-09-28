import { observer } from 'mobx-react-lite'
import { Panel, Select, Toggle, type SelectOption } from '../controls/ControlPanel'
import { renderStore } from './renderStore'

/**
 * 渲染链路的公共控制面板：所有 demo 共用。
 * 承载「降级路径必须显式标注」与「中间量可视化」两项文档要求。
 */
export const PipelinePanel = observer(function PipelinePanel() {
  const store = renderStore
  if (!store.pipelineActive) return null

  const options: SelectOption<string>[] = [
    { value: 'none', label: '完整链路' },
    ...store.passNames.map((name) => ({ value: name, label: `仅到 ${name} 为止` })),
  ]

  return (
    <Panel title="渲染链路">
      <div className="ctl-row">
        <span className="ctl-label">HDR 目标</span>
        <span className={`badge ${store.hdrActive ? 'badge-ok' : 'badge-warn'}`}>
          {store.hdrActive ? store.hdrFormat : `${store.hdrFormat}（已回落）`}
        </span>
      </div>
      <Toggle
        label="旁路整条链"
        hint="对比改造前的场景直出"
        value={store.bypass}
        onChange={store.setBypass}
      />
      <Select
        label="调试视图"
        value={store.debugPass ?? 'none'}
        options={options}
        onChange={(value) => store.setDebugPass(value === 'none' ? null : value)}
      />
    </Panel>
  )
})
