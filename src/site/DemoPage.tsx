import { Link, useParams } from 'react-router-dom'
import { DEMO_MODULES } from '@/demos'
import { DEMO_BY_ID, LAYER_LABEL, PERF_LABEL, STATUS_LABEL, type DemoMeta } from './demos'

export function DemoPage() {
  const { id } = useParams<{ id: string }>()
  const meta = id ? DEMO_BY_ID.get(id) : undefined

  if (!meta) {
    return (
      <div className="missing">
        <h1>找不到这个方向</h1>
        <p className="hero-sub">没有 id 为「{id}」的 demo。</p>
        <Link className="btn" to="/">
          返回首页
        </Link>
      </div>
    )
  }

  const module = DEMO_MODULES[meta.id]

  return (
    <article className="demo-page">
      <header className="demo-header">
        <Link className="backlink" to="/">
          ← 全部方向
        </Link>
        <h1 className="demo-title">{meta.title}</h1>
        <p className="hero-sub">{meta.oneLiner}</p>
        <div className="tag-row">
          <span className="pill">{LAYER_LABEL[meta.layer]}</span>
          <span className="pill">{meta.stack}</span>
          <span className={`pill pill-${meta.perf}`}>{PERF_LABEL[meta.perf]}</span>
          <span className="pill">工作量 {meta.effort}</span>
          <span className={`status status-${meta.status}`}>{STATUS_LABEL[meta.status]}</span>
        </div>
        {meta.problem ? <p className="demo-problem">{meta.problem}</p> : null}
      </header>

      {module ? <module.Stage /> : <PlannedStage meta={meta} />}

      {meta.algorithm?.length ? (
        <section className="doc-section">
          <h2>算法概要</h2>
          <ul className="doc-list">
            {meta.algorithm.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {meta.formulas?.length ? (
            <div className="formula-list">
              {meta.formulas.map((formula) => (
                <code className="formula" key={formula}>
                  {formula}
                </code>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {meta.limitations?.length ? (
        <section className="doc-section">
          <h2>局限与已知问题</h2>
          <ul className="doc-list doc-list-warn">
            {meta.limitations.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {meta.sources?.length ? (
        <section className="doc-section">
          <h2>源码与参考</h2>
          <ul className="doc-list">
            {meta.sources.map((source) => (
              <li key={source.href}>
                <a href={source.href} target="_blank" rel="noreferrer">
                  {source.label}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  )
}

function PlannedStage({ meta }: { meta: DemoMeta }) {
  return (
    <div className="stage stage-planned">
      <div className="stage-planned-inner">
        <div className="stage-planned-badge">规划中</div>
        <p className="stage-planned-title">{meta.title} 尚未实现</p>
        <p className="stage-planned-body">
          当前页面已具备完整的元数据（问题陈述 / 算法概要 / 局限 / 参考）。实现后只需在
          <code>src/demos/</code> 下新增模块并在 <code>src/demos/index.ts</code> 登记，
          即可直接复用统一 HUD、控制面板、URL 序列化与性能面板。
        </p>
      </div>
    </div>
  )
}
