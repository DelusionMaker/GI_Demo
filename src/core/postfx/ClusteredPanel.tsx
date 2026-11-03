import { observer } from 'mobx-react-lite'
import { Panel, Select, Toggle, type SelectOption } from '../controls/ControlPanel'
import { clusterParams, LIGHT_COUNT_STEPS } from './clusterParams'

/**
 * 多光源 / 剔除面板（p1-light-ssr S3-a）。
 *
 * 面板是评审唯一会读的说明文字 —— 文案属于作品集内容，不是随手写的标签。
 *
 * TODO(作品集 · 你来定稿)：
 * 1. 标题与控件文案：现在用的是中性描述，改成你自己的说法（要让人不看代码也知道在验证什么）。
 * 2. 「一句话问题陈述」：放在 Panel 上方的 panel-note 里（见下方 TODO 位置）。
 * 3. S3-d 的统计行（平均每 cluster 灯数 / 压缩比 / 剔除耗时）接上后补在这里 ——
 *    那行数字比任何曲线都更能说明问题。
 */

const LIGHT_OPTIONS: SelectOption<string>[] = LIGHT_COUNT_STEPS.map((count) => ({
  value: String(count),
  label: count === 0 ? '0（仅场景原有灯光）' : `${count} 盏点光`,
}))

export const ClusteredPanel = observer(function ClusteredPanel() {
  const knobs = clusterParams.params

  return (
    <Panel title="多光源 / 剔除" onReset={() => clusterParams.reset()}>
      {/* TODO(作品集 · 你来写)：一句话问题陈述，例如「一帧 60 盏灯时，每个像素要跑多少次 BRDF？」 */}
      <div className="panel-note">
        逐像素遍历全部光源 vs 按 cluster 取本块灯列表；关闭上面开关即为对照组。
      </div>

      <Toggle
        label="Clustered 剔除"
        value={knobs.clustered}
        onChange={(value) => clusterParams.set({ clustered: value })}
        hint="关闭 = 暴力遍历全部灯"
      />

      <Select
        label="点光数量"
        value={String(knobs.lightCount)}
        options={LIGHT_OPTIONS}
        onChange={(value) => clusterParams.set({ lightCount: Number(value) })}
      />

      <Toggle
        label="灯阵旋转"
        value={knobs.lightSpin}
        onChange={(value) => clusterParams.set({ lightSpin: value })}
        hint="验证每帧重建；A/B 截图时请关闭"
      />

      {/* TODO(作品集 · S3-d)：统计行 —— 见 docs/TODO 7.3.3.3 的 S3-d */}
    </Panel>
  )
})
