import { Link } from 'react-router-dom'
import { DEMOS, LAYER_LABEL, PERF_LABEL, STATUS_LABEL, type DemoMeta, type Layer } from './demos'

const LAYER_ORDER: Layer[] = ['L1', 'L2', 'L3', 'L4']

const CRITERIA = [
  {
    title: '有可验证的正确性',
    body: '优先选能用参考解对照的方向：Cornell box 的 GI 收敛、能量守恒测试、白炉测试。能被验证的效果，才讲得清对错。',
  },
  {
    title: '有可视化的中间量',
    body: '能把 G-buffer、cascade 分层、探针图集、SDF 切片、方差图直接显示出来的方向，展示价值远高于只能看最终画面的方向。',
  },
  {
    title: '有真实的性能故事',
    body: '讲清「为什么掉帧、怎么优化、降级到什么档位」，比单纯惊艳的效果更能体现工程能力。',
  },
]

export function HomePage() {
  return (
    <div className="home">
      <section className="hero">
        <h1>光照与全局光照 · 技术作品集</h1>
        <p className="hero-sub">
          以「光照 / GI」为单一主题的深度作品集：从渲染方程出发，逐层做到烘焙 GI 与实时 GI。
          评价标准不是会多少种算法，而是能否把一个算法做对、做透、并诚实说明它的边界。
        </p>
      </section>

      <section className="criteria">
        {CRITERIA.map((item) => (
          <div className="card card-plain" key={item.title}>
            <h3 className="card-title">{item.title}</h3>
            <p className="card-line">{item.body}</p>
          </div>
        ))}
      </section>

      {LAYER_ORDER.map((layer) => {
        const items = DEMOS.filter((demo) => demo.layer === layer)
        if (items.length === 0) return null
        return (
          <section className="layer-section" key={layer}>
            <h2 className="layer-title">{LAYER_LABEL[layer]}</h2>
            <div className="card-grid">
              {items.map((demo) => (
                <DemoCard demo={demo} key={demo.id} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function DemoCard({ demo }: { demo: DemoMeta }) {
  return (
    <Link className="card" to={`/d/${demo.id}`}>
      <div className={`card-cover cover-${demo.layer}`}>
        <span className="card-cover-note">封面 GIF 待录制（3–5 秒循环，展示参数变化）</span>
      </div>
      <div className="card-body">
        <div className="card-title-row">
          <h3 className="card-title">{demo.title}</h3>
          <span className={`status status-${demo.status}`}>{STATUS_LABEL[demo.status]}</span>
        </div>
        <p className="card-line">{demo.oneLiner}</p>
        <div className="tag-row">
          <span className="pill">{demo.stack}</span>
          <span className={`pill pill-${demo.perf}`}>{PERF_LABEL[demo.perf]}</span>
          <span className="pill">工作量 {demo.effort}</span>
        </div>
        <div className="card-metric">{demo.metric}</div>
      </div>
    </Link>
  )
}
