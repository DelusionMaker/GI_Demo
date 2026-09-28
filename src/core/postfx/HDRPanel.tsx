import { observer } from 'mobx-react-lite'
import { Panel, Select, Toggle, type SelectOption } from '../controls/ControlPanel'
import { hdrStore } from './hdrStore'

/**
 * HDR 链路的公共控制面板：所有 demo 共用。
 *
 * 承载两项文档要求：
 * - 「降级路径必须显式标注」：hdrSupported=false 时标红提示高光会截断
 * - 「中间量可视化」：把链路截断到某个 pass 直接看其输出
 */
export const HDRPanel = observer(function HDRPanel() {
  const store = hdrStore
  if (!store.pipelineActive) return null

  const options: SelectOption<string>[] = [
    { value: 'none', label: '完整链路' },
    ...store.passNames.map((name) => ({ value: name, label: `仅到 ${name} 为止` })),
  ]

  return (
    <Panel title="HDR 链路">
      <div className="ctl-row">
        <span className="ctl-label">RT 档位</span>
        <span className={`badge ${store.hdrActive ? 'badge-ok' : 'badge-warn'}`}>
          {store.hdrActive ? store.hdrFormat : `${store.hdrFormat}（已降级）`}
        </span>
      </div>
      <Toggle
        label="旁路整条链"
        hint="对比接入前的场景直出"
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
