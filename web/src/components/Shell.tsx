import { useEffect, useRef, useState, type FormEvent } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api, type NotificationItem } from '../api';
import { portalPath, useAuth } from '../auth';
import { useZim, type CurrencyCode, type VernacularMode } from '../zimContext';
import { QuickTransferModal } from './QuickTransferModal';
import { Logo } from './Logo';

interface NavItem {
  to: string;
  label: string;
  short: string;
  keyHint: string;
  end: boolean;
  shona: string;
  ndebele: string;
}

function buildNavItems(base: string): NavItem[] {
  return [
    { to: `${base}`, label: '1. Dashboard', short: 'Dashboard', keyHint: 'Alt+1', end: true, shona: 'Mufananidzo Webhizinesi', ndebele: 'Isimo Sebhizimusi' },
    { to: `${base}/pos`, label: '2. POS Fast Counter', short: 'POS', keyHint: 'Alt+2', end: false, shona: 'Kutengesa Kwepakaunda', ndebele: 'Ukuthengisa Esitolo' },
    { to: `${base}/products`, label: '3. Products', short: 'Products', keyHint: 'Alt+3', end: false, shona: 'Zvinhu Zviri Muchitoro', ndebele: 'Impahla Yesitolo' },
    { to: `${base}/operations`, label: '4. Stock Movements', short: 'Movements', keyHint: 'Alt+4', end: false, shona: 'Kubuda Nekupinda', ndebele: 'Ukuphuma Lokungena' },
    { to: `${base}/procurement`, label: '5. Receiving (GRN)', short: 'Receiving', keyHint: 'Alt+5', end: false, shona: 'Kugamuchira Zvinhu', ndebele: 'Ukuthola Impahla' },
    { to: `${base}/transfers`, label: '6. Transfers & Yield', short: 'Transfers', keyHint: 'Alt+6', end: false, shona: 'Kufambisa & Kupatsanura', ndebele: 'Ukuthutha Impahla' },
    { to: `${base}/warehouses`, label: '7. Departments & Credit', short: 'Departments', keyHint: 'Alt+7', end: false, shona: 'Matura & Chikwereti', ndebele: 'Izigaba & Izikwelede' },
    { to: `${base}/reports`, label: '8. Reports & ZIMRA VAT', short: 'Reports', keyHint: 'Alt+8', end: false, shona: 'Magwaro eZIMRA', ndebele: 'Imibiko yeZIMRA' },
    { to: `${base}/users`, label: '9. Users & Fast PINs', short: 'Users', keyHint: 'Alt+9', end: false, shona: 'Vashandi & maPIN', ndebele: 'Izisebenzi & ama-PIN' },
    { to: `${base}/organisation`, label: '10. Settings & Reset', short: 'Settings', keyHint: 'Alt+0', end: false, shona: 'Mitemo & Kutanga Patsva', ndebele: 'Izilungiselelo' },
  ];
}

export function Shell({ portal }: { portal: 'executive' | 'inventory' }) {
  const { user, logout } = useAuth();
  const {
    currency,
    setCurrency,
    vernacular,
    setVernacular,
    easyMode,
    setEasyMode,
    roleView,
    setRoleView,
    zesaGridOnline,
    setZesaGridOnline,
    triggerOfflineSync,
  } = useZim();

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

  const base = user ? portalPath(user.role) : `/${portal}`;
  const navItems = buildNavItems(base);
  const portalTitle = portal === 'executive' ? 'Executive Portal' : 'Inventory Portal';

  const currentNav =
    navItems.find((i) => (i.end ? location.pathname === i.to : location.pathname.startsWith(i.to))) ?? navItems[0];

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

  // Global keyboard navigation (Alt+1..9 for pages, Alt+K for search, Alt+T for Quick Transfer)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput = target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA');

      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const num = Number(e.key);
        if (num >= 1 && num <= navItems.length) {
          e.preventDefault();
          navigate(navItems[num - 1].to);
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
  }, [navItems, navigate]);

  function handleGlobalSearch(e: FormEvent) {
    e.preventDefault();
    const q = quickSearch.trim();
    navigate(`${base}/products${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  }

  return (
    <div className={`shell${collapsed ? ' is-collapsed' : ''}${drawer ? ' drawer-open' : ''}`}>
      <a className="skip-link" href="#main">Skip to main content</a>

      {/* TIER 1: Collapsible Left Sidebar with 10 Core Modules + ZESA Load-Shedding Offline Status Widget */}
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand" style={{ padding: '0.75rem 1rem' }}>
          <Logo size={36} variant="full" />
        </div>
        <div className="denderedzwa-frieze sidebar-frieze" aria-hidden="true" />

        <nav aria-label="Main sections">
          {navItems.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} className="nav-link" title={`${i.label} — ${i.shona} / ${i.ndebele} (${i.keyHint})`}>
              <span className="nav-dot" aria-hidden="true" />
              <span className="nav-label">{i.label}</span>
              <kbd className="nav-kbd">{i.keyHint}</kbd>
            </NavLink>
          ))}
        </nav>

        {/* Bottom ZESA Load-Shedding Offline Status & Sync Widget */}
        <div className="zesa-widget" role="region" aria-label="ZESA Power and Offline Sync status">
          <div className="zesa-widget-top">
            <strong>⚡ ZESA / Solar UPS</strong>
            <span className={`zesa-status-pill ${zesaGridOnline ? 'online' : 'battery'}`}>
              {zesaGridOnline ? '● Grid Online' : '🔋 Inverter Backup'}
            </span>
          </div>
          <span style={{ fontSize: '0.71rem', opacity: 0.9 }}>
            {zesaGridOnline
              ? 'Local SQLite WAL ledger synced. Safe against power cuts.'
              : 'Load-shedding mode active — all sales & stock saved locally.'}
          </span>
          <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.15rem' }}>
            <button
              type="button"
              className="zesa-sync-btn"
              style={{ flex: 1 }}
              onClick={() => {
                triggerOfflineSync();
                setSyncFlash('Offline queue synced & verified');
                setTimeout(() => setSyncFlash(''), 3000);
              }}
            >
              ↻ Sync Now
            </button>
            <button
              type="button"
              className="zesa-sync-btn"
              onClick={() => setZesaGridOnline(!zesaGridOnline)}
              title="Simulate ZESA power cut / solar inverter switchover"
            >
              {zesaGridOnline ? 'Test Cut' : 'Restore'}
            </button>
          </div>
        </div>

        <div className="sidebar-help">
          <div className="sidebar-help-title">Keyboard Shortcuts</div>
          <div className="sidebar-help-row"><span>Jump pages</span><kbd>Alt+1..{navItems.length}</kbd></div>
          <div className="sidebar-help-row"><span>Quick search</span><kbd>Alt+K</kbd></div>
          <div className="sidebar-help-row"><span>Quick transfer</span><kbd>Alt+T</kbd></div>
          <div className="sidebar-help-row"><span>Switch tabs</span><kbd>← / →</kbd></div>
        </div>
      </aside>
      {drawer && <button className="scrim" aria-label="Close menu" onClick={() => setDrawer(false)} />}

      <div className="content">
        {/* Top 4px Ndebele Stepped Geometric Ribbon */}
        <div className="ndebele-ribbon" aria-hidden="true" />

        {/* TIER 2: Top Navigation & 1-Tap Store Action Bar */}
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
            <strong className="topbar-ops-title">StockRoom ZW</strong>
            <span className="live-pill" aria-label="Live ledger active">● LIVE</span>
          </div>

          <form className="topbar-search" onSubmit={handleGlobalSearch} role="search">
            <input
              ref={searchInputRef}
              type="search"
              value={quickSearch}
              onChange={(e) => setQuickSearch(e.target.value)}
              placeholder="Search SKU, Product, or Barcode… (Alt+K)"
              aria-label="Search SKU or product"
            />
          </form>

          <div className="topbar-actions">
            {/* 1. Role View Switcher */}
            <div className="topbar-seg-group" role="group" aria-label="Role view switcher">
              <button
                type="button"
                className={`topbar-seg-btn ${roleView === 'inventory' ? 'active' : ''}`}
                onClick={() => setRoleView('inventory')}
                title="Operational Storefloor Focus"
              >
                🏪 Storefloor View
              </button>
              <button
                type="button"
                className={`topbar-seg-btn ${roleView === 'executive' ? 'active' : ''}`}
                onClick={() => setRoleView('executive')}
                title="Capital Valuation, Margin & ZIMRA VAT Focus"
              >
                📊 Executive View
              </button>
            </div>

            {/* 2. Multi-Currency Switcher (USD $, ZiG, ZAR R) */}
            <div className="topbar-seg-group" role="group" aria-label="Multi-currency switcher">
              {(['USD', 'ZiG', 'ZAR'] as CurrencyCode[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`topbar-seg-btn ${currency === c ? 'active-gold' : ''}`}
                  onClick={() => setCurrency(c)}
                  title={`Display prices & valuation in ${c}`}
                >
                  {c === 'USD' ? 'USD $' : c === 'ZiG' ? 'ZiG' : 'ZAR R'}
                </button>
              ))}
            </div>

            {/* 3. Vernacular Language Helper Selector */}
            <select
              aria-label="Vernacular language helper"
              value={vernacular}
              onChange={(e) => setVernacular(e.target.value as VernacularMode)}
              style={{ minHeight: '34px', padding: '0.22rem 0.55rem', fontSize: '0.78rem', borderRadius: '999px', fontWeight: 700 }}
              title="Toggle plain-language Shona & Ndebele helper subtitles"
            >
              <option value="bilingual">🇿🇼 EN + Shona / Ndebele</option>
              <option value="shona">ChiShona Subtitles</option>
              <option value="ndebele">IsiNdebele Subtitles</option>
              <option value="english">English Only</option>
            </select>

            {/* 4. Visual Easy Mode Toggle */}
            <button
              type="button"
              className="btn btn-pill-action"
              onClick={() => setEasyMode(!easyMode)}
              aria-pressed={easyMode}
              title="Toggle larger touch buttons and zero-jargon visual helpers"
            >
              👁️ Easy Mode: <strong>{easyMode ? 'ON' : 'OFF'}</strong>
            </button>

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

        {/* Subtle Great Zimbabwe dry-stone chevron (denderedzwa) frieze strip under the header */}
        <div className="denderedzwa-frieze" aria-hidden="true" />

        <div className="subbar" aria-label="Breadcrumb and status">
          <div className="breadcrumb">
            <span>{portalTitle}</span>
            <span className="crumb-sep">/</span>
            <strong>{currentNav?.short ?? 'Stockroom'}</strong>
            {vernacular !== 'english' && currentNav && (
              <>
                <span className="crumb-sep">•</span>
                <span style={{ color: 'var(--zim-gold-700)', fontWeight: 600 }}>
                  {vernacular === 'shona'
                    ? currentNav.shona
                    : vernacular === 'ndebele'
                      ? currentNav.ndebele
                      : `${currentNav.shona} • ${currentNav.ndebele}`}
                </span>
              </>
            )}
          </div>
          {syncFlash && <span className="sync-toast" role="status">{syncFlash}</span>}
          <div className="subbar-shortcuts">
            <span>
              Active Currency: <strong>{currency}</strong> | Focus Mode: <strong>{roleView === 'executive' ? 'Executive (Margins & VAT)' : 'Storefloor (Fast Stepper)'}</strong>
            </span>
          </div>
        </div>

        <main id="main" className="main" tabIndex={-1}>
          {notifOpen && (
            <section className="card" aria-label="Live Notifications Drawer" style={{ marginBottom: '1.2rem', borderColor: 'var(--gold)' }}>
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
                <div className="empty-state-box">All clear — no low-stock, expiry, or approval alerts right now.</div>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
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
