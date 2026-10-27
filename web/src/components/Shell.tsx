import { useEffect, useRef, useState, type FormEvent } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api, type NotificationItem } from '../api';
import { portalPath, useAuth } from '../auth';
import { QuickTransferModal } from './QuickTransferModal';

const NAV = {
  executive: {
    title: 'Executive Portal',
    items: [
      { to: '/executive', label: '1. Overview & Live Feed', short: 'Overview', keyHint: 'Alt+1', end: true },
      { to: '/executive/products', label: '2. Products & Catalogue', short: 'Products', keyHint: 'Alt+2', end: false },
      { to: '/executive/warehouses', label: '3. Warehouses & Depts', short: 'Warehouses', keyHint: 'Alt+3', end: false },
      { to: '/executive/procurement', label: '4. Suppliers & POs', short: 'Procurement', keyHint: 'Alt+4', end: false },
      { to: '/executive/operations', label: '5. Movements & Stocktakes', short: 'Operations', keyHint: 'Alt+5', end: false },
      { to: '/executive/reports', label: '6. Reports & Exports', short: 'Reports', keyHint: 'Alt+6', end: false },
      { to: '/executive/organisation', label: '7. Governance & System', short: 'Governance', keyHint: 'Alt+7', end: false },
    ],
  },
  inventory: {
    title: 'Inventory Portal',
    items: [
      { to: '/inventory', label: '1. Overview & Live Feed', short: 'Overview', keyHint: 'Alt+1', end: true },
      { to: '/inventory/products', label: '2. Products & Catalogue', short: 'Products', keyHint: 'Alt+2', end: false },
      { to: '/inventory/warehouses', label: '3. Warehouses & Depts', short: 'Warehouses', keyHint: 'Alt+3', end: false },
      { to: '/inventory/procurement', label: '4. Suppliers & POs', short: 'Procurement', keyHint: 'Alt+4', end: false },
      { to: '/inventory/operations', label: '5. Movements & Stocktakes', short: 'Operations', keyHint: 'Alt+5', end: false },
      { to: '/inventory/reports', label: '6. Reports & Alerts', short: 'Reports', keyHint: 'Alt+6', end: false },
    ],
  },
};

export function Shell({ portal }: { portal: keyof typeof NAV }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar') === 'collapsed');
  const [drawer, setDrawer] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (localStorage.getItem('stockroom_theme') === 'dark' ? 'dark' : 'light'));
  const [quickSearch, setQuickSearch] = useState('');
  const [transferOpen, setTransferOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [syncFlash, setSyncFlash] = useState('');
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const cfg = NAV[portal];
  const base = user ? portalPath(user.role) : `/${portal}`;
  const currentNav =
    cfg.items.find((i) => (i.end ? location.pathname === i.to : location.pathname.startsWith(i.to))) ?? cfg.items[0];

  function loadNotifications() {
    api
      .notifications()
      .then((res) => setNotifications(res.items ?? []))
      .catch(() => {});
  }

  useEffect(() => {
    setDrawer(false);
    setNotifOpen(false);
    loadNotifications();
  }, [location.pathname]);

  useEffect(() => {
    const onSync = () => loadNotifications();
    window.addEventListener('stockroom:sync', onSync);
    return () => window.removeEventListener('stockroom:sync', onSync);
  }, []);

  useEffect(() => localStorage.setItem('sidebar', collapsed ? 'collapsed' : 'open'), [collapsed]);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('stockroom_theme', theme);
  }, [theme]);

  // Global keyboard navigation (Alt+1..7 for pages, Alt+K for search, Alt+T for Quick Transfer)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput = target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA');

      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const num = Number(e.key);
        if (num >= 1 && num <= cfg.items.length) {
          e.preventDefault();
          navigate(cfg.items[num - 1].to);
          return;
        }
        if (e.key.toLowerCase() === 'k') {
          e.preventDefault();
          searchInputRef.current?.focus();
          return;
        }
        if (e.key.toLowerCase() === 't') {
          e.preventDefault();
          setTransferOpen(true);
          return;
        }
      }
      if (!inInput && e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cfg.items, navigate]);

  function handleGlobalSearch(e: FormEvent) {
    e.preventDefault();
    const q = quickSearch.trim();
    navigate(`${base}/products${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  }

  return (
    <div className={`shell${collapsed ? ' is-collapsed' : ''}${drawer ? ' drawer-open' : ''}`}>
      <a className="skip-link" href="#main">Skip to main content</a>
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div className="brand-text-col">
            <span className="brand-name">STOCKROOM</span>
            <span className="brand-sub">{cfg.title}</span>
          </div>
        </div>
        <nav aria-label="Main sections">
          {cfg.items.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} className="nav-link" title={`${i.label} (${i.keyHint})`}>
              <span className="nav-dot" aria-hidden="true" />
              <span className="nav-label">{i.label}</span>
              <kbd className="nav-kbd">{i.keyHint}</kbd>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-help">
          <div className="sidebar-help-title">Keyboard Shortcuts</div>
          <div className="sidebar-help-row"><span>Jump pages</span><kbd>Alt+1..{cfg.items.length}</kbd></div>
          <div className="sidebar-help-row"><span>Quick search</span><kbd>Alt+K</kbd></div>
          <div className="sidebar-help-row"><span>Quick transfer</span><kbd>Alt+T</kbd></div>
          <div className="sidebar-help-row"><span>Switch tabs</span><kbd>← / →</kbd></div>
        </div>
        <div className="sidebar-pattern" aria-hidden="true" />
      </aside>
      {drawer && <button className="scrim" aria-label="Close menu" onClick={() => setDrawer(false)} />}

      <div className="content">
        <header className="topbar">
          <button
            type="button"
            className="btn btn-ghost"
            aria-label="Toggle navigation"
            aria-expanded={drawer || !collapsed}
            onClick={() => (window.matchMedia('(max-width: 860px)').matches ? setDrawer((d) => !d) : setCollapsed((c) => !c))}
          >
            ☰
          </button>
          <div className="topbar-brand-group">
            <strong className="topbar-ops-title">STOCKROOM OPERATIONS</strong>
            <span className="live-pill" aria-label="Live ledger active">● LIVE</span>
          </div>

          <form className="topbar-search" onSubmit={handleGlobalSearch} role="search">
            <input
              ref={searchInputRef}
              type="search"
              value={quickSearch}
              onChange={(e) => setQuickSearch(e.target.value)}
              placeholder="Search SKU, Product, or Zone… (Alt+K)"
              aria-label="Search SKU or product"
            />
          </form>

          <div className="topbar-actions">
            <button
              type="button"
              className="btn btn-pill-action"
              onClick={() => setTransferOpen(true)}
              title="Open Quick-Transfer Modal (Alt+T)"
            >
              <span className="dot-green" aria-hidden="true" /> Quick Transfer
            </button>
            <button
              type="button"
              className="btn btn-pill-action"
              onClick={() => {
                setSyncFlash('Synced live ledger');
                setTimeout(() => setSyncFlash(''), 2500);
                window.dispatchEvent(new CustomEvent('stockroom:sync'));
              }}
              title="Refresh live data"
            >
              ↻ System Sync
            </button>
            <button
              type="button"
              className="btn btn-pill-action"
              onClick={() => setNotifOpen((o) => !o)}
              aria-label={`Notifications (${notifications.length})`}
              aria-expanded={notifOpen}
              title="Live System Notifications"
            >
              🔔 Alerts
              {notifications.length > 0 && (
                <span className="badge badge-warn" style={{ marginLeft: '0.25rem' }}>
                  {notifications.length}
                </span>
              )}
            </button>
            <button
              type="button"
              className="btn btn-pill-action"
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              title="Toggle Light / Dark theme"
            >
              {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
            </button>
            <span className="user-chip" title={user?.email}>
              <span className="user-avatar" aria-hidden="true">{user?.name?.slice(0, 1) ?? 'U'}</span>
              <span>{user?.name}</span>
            </span>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={async () => {
                await logout();
                navigate('/login', { replace: true });
              }}
            >
              Sign out
            </button>
          </div>
        </header>

        <div className="subbar" aria-label="Breadcrumb and status">
          <div className="breadcrumb">
            <span>Dashboard</span>
            <span className="crumb-sep">/</span>
            <span>{cfg.title}</span>
            <span className="crumb-sep">/</span>
            <strong>{currentNav?.short ?? 'Stockroom'}</strong>
          </div>
          {syncFlash && <span className="sync-toast" role="status">{syncFlash}</span>}
          <div className="subbar-shortcuts">
            <span>Navigate by mouse or keyboard (<kbd>Tab</kbd>, <kbd>←/→</kbd>, <kbd>Alt+T</kbd>)</span>
          </div>
        </div>

        <main id="main" className="main" tabIndex={-1}>
          {notifOpen && (
            <section className="card" aria-label="Live Notifications Drawer" style={{ marginBottom: '1rem', borderColor: 'var(--gold)' }}>
              <div className="section-head">
                <div>
                  <h2>🔔 Live System Notifications ({notifications.length})</h2>
                  <p className="muted" style={{ margin: 0, fontSize: '0.84rem' }}>
                    Real-time alerts computed from stock balances, batch expiry dates, approval queues, and system security.
                  </p>
                </div>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setNotifOpen(false)}>
                  Close
                </button>
              </div>
              {notifications.length === 0 ? (
                <div className="empty-state">All clear — no low-stock, expiry, or approval alerts right now.</div>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Severity</th>
                        <th>Alert</th>
                        <th>Details</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {notifications.map((n) => (
                        <tr key={n.id}>
                          <td>
                            <span className={`badge ${n.severity === 'critical' ? 'badge-danger' : n.severity === 'warning' ? 'badge-warn' : 'badge-info'}`}>
                              {n.severity.toUpperCase()}
                            </span>
                          </td>
                          <td><strong>{n.title}</strong></td>
                          <td>{n.message}</td>
                          <td>
                            <button
                              type="button"
                              className="btn btn-outline btn-sm"
                              onClick={() => {
                                setNotifOpen(false);
                                navigate(n.link);
                              }}
                            >
                              Open →
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
          <Outlet />
        </main>
      </div>

      <QuickTransferModal
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        onSuccess={(message) => {
          setSyncFlash(message);
          setTimeout(() => setSyncFlash(''), 4000);
          window.dispatchEvent(new CustomEvent('stockroom:sync'));
        }}
      />
    </div>
  );
}
