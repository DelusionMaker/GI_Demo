import { observer } from 'mobx-react-lite'
import { BrowserRouter, Link, NavLink, Route, Routes } from 'react-router-dom'
import { capabilitiesStore } from '@/core/capabilities'
import { DEMOS } from '@/site/demos'
import { DemoPage } from '@/site/DemoPage'
import { HomePage } from '@/site/HomePage'

export function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <SiteHeader />
        <main className="app-main">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/d/:id" element={<DemoPage />} />
            <Route path="*" element={<HomePage />} />
          </Routes>
        </main>
        <footer className="app-footer">
          <span>光照与全局光照 · Web 端技术作品集</span>
          <span className="app-footer-note">
            工作量为估算值，实际受资产准备与调试时间影响较大。
          </span>
        </footer>
      </div>
    </BrowserRouter>
  )
}

const SiteHeader = observer(function SiteHeader() {
  const caps = capabilitiesStore
  return (
    <header className="app-header">
      <Link className="brand" to="/">
        GI<span className="brand-dot">·</span>Portfolio
      </Link>
      <nav className="app-nav">
        {DEMOS.map((demo) => (
          <NavLink
            key={demo.id}
            to={`/d/${demo.id}`}
            className={({ isActive }) => `nav-link${isActive ? ' nav-link-active' : ''}`}
          >
            {demo.title}
          </NavLink>
        ))}
      </nav>
      <div className="app-header-meta">
        {/* 文档要求：降级路径必须在页面显式标注当前档位 */}
        <span className={`badge badge-${caps.backend}`}>{caps.label}</span>
        {caps.webgpuAvailable ? <span className="badge badge-muted">GPU 可用</span> : null}
      </div>
    </header>
  )
})
