import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';

const NAV = {
  executive: {
    title: 'Executive Portal',
    items: [
      { to: '/executive', label: 'Overview', end: true },
      { to: '/executive/products', label: 'Products & Stock', end: false },
      { to: '/executive/operations', label: 'Movements & Counts', end: false },
      { to: '/executive/organisation', label: 'Org & Users', end: false },
    ],
  },
  inventory: {
    title: 'Inventory Portal',
    items: [
      { to: '/inventory', label: 'Overview', end: true },
      { to: '/inventory/products', label: 'Products & Stock', end: false },
      { to: '/inventory/operations', label: 'Movements & Counts', end: false },
    ],
  },
};

export function Shell({ portal }: { portal: keyof typeof NAV }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar') === 'collapsed');
  const [drawer, setDrawer] = useState(false);
  const cfg = NAV[portal];

  useEffect(() => setDrawer(false), [location.pathname]);
  useEffect(() => localStorage.setItem('sidebar', collapsed ? 'collapsed' : 'open'), [collapsed]);

  return (
    <div className={`shell${collapsed ? ' is-collapsed' : ''}${drawer ? ' drawer-open' : ''}`}>
      <a className="skip-link" href="#main">Skip to content</a>
      <aside className="sidebar" aria-label="Primary">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">Stockroom</span>
        </div>
        <nav>
          {cfg.items.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} className="nav-link">
              <span className="nav-dot" aria-hidden="true" />
              <span className="nav-label">{i.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-pattern" aria-hidden="true" />
      </aside>
      {drawer && <button className="scrim" aria-label="Close menu" onClick={() => setDrawer(false)} />}

      <div className="content">
        <header className="topbar">
          <button
            className="btn btn-ghost"
            aria-label="Toggle navigation"
            aria-expanded={drawer || !collapsed}
            onClick={() => (window.matchMedia('(max-width: 860px)').matches ? setDrawer((d) => !d) : setCollapsed((c) => !c))}
          >
            ☰
          </button>
          <strong className="topbar-title">{cfg.title}</strong>
          <span className="spacer" />
          <span className="user-chip">{user?.name}</span>
          <button
            className="btn btn-outline"
            onClick={async () => {
              await logout();
              navigate('/login', { replace: true });
            }}
          >
            Sign out
          </button>
        </header>
        <main id="main" className="main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
