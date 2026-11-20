import { Link, Outlet } from 'react-router-dom';

export function AppShell() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-title">NestCloudWeb</div>
          <div className="brand-subtitle">统一前端基座</div>
        </div>
        <nav className="nav">
          <Link to="/">控制台</Link>
          <Link to="/login">登录页</Link>
        </nav>
      </aside>
      <main className="content">
        <header className="topbar">
          <div>
            <div className="topbar-title">NestCloudWeb</div>
            <div className="topbar-subtitle">系统管理与未来前台、移动端的统一入口</div>
          </div>
        </header>
        <section className="page-body">
          <Outlet />
        </section>
      </main>
    </div>
  );
}
