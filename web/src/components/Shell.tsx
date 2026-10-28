import { useEffect, useRef, useState, type FormEvent } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api, type NotificationItem } from '../api';
import { portalPath, useAuth } from '../auth';
import { useZim, type CurrencyCode } from '../zimContext';
import { QuickTransferModal } from './QuickTransferModal';
import { ProfileModal } from './ProfileModal';
import { Logo } from './Logo';
import { StorefloorIcon, ExecutiveIcon, BellIcon, SunIcon, MoonIcon } from './Icons';

interface NavItem {
  to: string;
  label: string;
  short: string;
  keyHint: string;
  end: boolean;
  shona: string;
  ndebele: string;
}

function buildNavItems(portal: 'executive' | 'inventory', base: string): NavItem[] {
  if (portal === 'inventory') {
    return [
      { to: `${base}`, label: '1. Dashboard', short: 'Dashboard', keyHint: 'Alt+1', end: true, shona: 'Mufananidzo Webhizinesi', ndebele: 'Isimo Sebhizimusi' },
      { to: `${base}/products`, label: '2. Product Manager', short: 'Product Manager', keyHint: 'Alt+2', end: false, shona: 'Mufananidzo weZvinhu', ndebele: 'Umphathi Wempahla' },
      { to: `${base}/intake`, label: '3. Stock Intake', short: 'Intake', keyHint: 'Alt+3', end: false, shona: 'Kugamuchira Zvinhu', ndebele: 'Ukungena Kwempahla' },
      { to: `${base}/transfers`, label: '4. Transfers', short: 'Transfers', keyHint: 'Alt+4', end: false, shona: 'Kufambisa Zvinhu', ndebele: 'Ukuthutha Impahla' },
      { to: `${base}/departments`, label: '5. Departments', short: 'Departments', keyHint: 'Alt+5', end: false, shona: 'Mathipatimendi', ndebele: 'Izigaba Zesitolo' },
      { to: `${base}/count`, label: '6. Stock Count', short: 'Stock Count', keyHint: 'Alt+6', end: false, shona: 'Kuverenga Zvinhu', ndebele: 'Ukubala Impahla' },
      { to: `${base}/layby-and-change`, label: '7. Lay-by & Customer Change', short: 'Lay-by & Change', keyHint: 'Alt+7', end: false, shona: 'Paid Stock & Mari yeChange', ndebele: 'I-Layby & Inthshintshi' },
    ];
  }

  return [
    { to: `${base}`, label: '1. Executive Overview', short: 'Overview', keyHint: 'Alt+1', end: true, shona: 'Mufananidzo weManeja', ndebele: 'Isimo Somphathi' },
    { to: `${base}/reports`, label: '2. Reports & ZIMRA VAT', short: 'Reports', keyHint: 'Alt+2', end: false, shona: 'Magwaro eZIMRA', ndebele: 'Imibiko yeZIMRA' },
    { to: `${base}/users`, label: '3. User Management', short: 'Users', keyHint: 'Alt+3', end: false, shona: 'Vashandi & maPIN', ndebele: 'Izisebenzi & ama-PIN' },
    { to: `${base}/audit`, label: '4. Audit Logs & Ledger', short: 'Audit Logs', keyHint: 'Alt+4', end: false, shona: 'Gwaro reKufamba Kwezvinhu', ndebele: 'Ukulandelela Izinto' },
    { to: `${base}/settings`, label: '5. Settings & Backups', short: 'Settings', keyHint: 'Alt+5', end: false, shona: 'Mitemo & Backups', ndebele: 'Izilungiselelo' },
    { to: `${base}/layby-and-change`, label: '6. Lay-by & Customer Change', short: 'Lay-by & Change', keyHint: 'Alt+6', end: false, shona: 'Paid Stock & Mari yeChange', ndebele: 'I-Layby & Inthshintshi' },
  ];
}

export function Shell({ portal }: { portal: 'executive' | 'inventory' }) {
  const { user } = useAuth();
  const {
    currency,
    setCurrency,
    vernacular,
    roleView,
    setRoleView,
  } = useZim();

  const navigate = useNavigate();
  const location = useLocation();

  // Navigation Retraction States (Independently & Globally Collapsible for Full-Screen Focus)
  const [sidebarRetracted, setSidebarRetracted] = useState(() => localStorage.getItem('stockroom_sidebar_retracted') === 'true');
  const [topbarRetracted, setTopbarRetracted] = useState(() => localStorage.getItem('stockroom_topbar_retracted') === 'true');
  const [drawer, setDrawer] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (localStorage.getItem('stockroom_theme') === 'dark' ? 'dark' : 'light'));
  const [quickSearch, setQuickSearch] = useState('');
  const [transferOpen, setTransferOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [syncFlash, setSyncFlash] = useState('');
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const isFullScreen = sidebarRetracted && topbarRetracted;

  const base = user ? portalPath(user.role) : `/${portal}`;
  const navItems = buildNavItems(portal, base);
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

  useEffect(() => {
    localStorage.setItem('stockroom_sidebar_retracted', String(sidebarRetracted));
  }, [sidebarRetracted]);

  useEffect(() => {
    localStorage.setItem('stockroom_topbar_retracted', String(topbarRetracted));
  }, [topbarRetracted]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('stockroom_theme', theme);
  }, [theme]);

  function toggleFullScreen() {
    if (isFullScreen) {
      setSidebarRetracted(false);
      setTopbarRetracted(false);
    } else {
      setSidebarRetracted(true);
      setTopbarRetracted(true);
    }
  }

  // Global keyboard navigation & shortcuts:
  // Alt+1..9 for pages, Alt+K for search, Alt+T for Quick Transfer, Alt+F or F for Fullscreen, Esc to exit Fullscreen
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput = target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA');

      // Esc exits fullscreen or unretracts bars
      if (e.key === 'Escape') {
        if (sidebarRetracted || topbarRetracted) {
          setSidebarRetracted(false);
          setTopbarRetracted(false);
          return;
        }
      }

      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        if (e.key.toLowerCase() === 'f') {
          e.preventDefault();
          toggleFullScreen();
          return;
        }
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

      if (!inInput) {
        if (e.key === 'f' || e.key === 'F') {
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            toggleFullScreen();
            return;
          }
        }
        if (e.key === '/') {
          e.preventDefault();
          searchInputRef.current?.focus();
        }
        if (e.ctrlKey && e.key === '[') {
          e.preventDefault();
          setSidebarRetracted((s) => !s);
        }
        if (e.ctrlKey && e.key === ']') {
          e.preventDefault();
          setTopbarRetracted((t) => !t);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navItems, navigate, sidebarRetracted, topbarRetracted, isFullScreen]);

  function handleGlobalSearch(e: FormEvent) {
    e.preventDefault();
    const q = quickSearch.trim();
    navigate(`${base}/products${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  }

  return (
    <div
      className={`shell${sidebarRetracted ? ' is-sidebar-retracted' : ''}${topbarRetracted ? ' is-topbar-retracted' : ''}${isFullScreen ? ' is-fullscreen' : ''}${drawer ? ' drawer-open' : ''}`}
    >
      <a className="skip-link" href="#main">Skip to main content</a>

      {/* Floating Workspace Controller when Topbar is Retracted or in Fullscreen */}
      {(topbarRetracted || isFullScreen) && (
        <aside className="floating-retract-bar" aria-label="Fullscreen workspace controller">
          <div className="floating-bar-pill">
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => {
                setSidebarRetracted(false);
                setTopbarRetracted(false);
              }}
              title="Expand all navigation and menu bars (Esc / Alt+F)"
              style={{ fontWeight: 700, gap: '0.35rem' }}
            >
              ⤢ Expand All Bars <kbd style={{ background: 'rgba(0,0,0,0.25)', padding: '1px 5px', borderRadius: '4px', fontSize: '0.72rem' }}>Esc</kbd>
            </button>

            {sidebarRetracted && (
              <button
                type="button"
                className="btn btn-sm btn-outline"
                onClick={() => setSidebarRetracted(false)}
                title="Expand left navigation sidebar"
              >
                ⇥ Show Nav
              </button>
            )}

            {topbarRetracted && !sidebarRetracted && (
              <button
                type="button"
                className="btn btn-sm btn-outline"
                onClick={() => setTopbarRetracted(false)}
                title="Expand top menu bar"
              >
                ▼ Show Menu
              </button>
            )}

            <span className="floating-page-title">
              {currentNav?.short ?? 'StockRoom'}
            </span>

            <div className="floating-actions">
              <div className="topbar-seg-group" role="group" aria-label="Quick currency toggle">
                {(['USD', 'ZiG', 'ZAR'] as CurrencyCode[]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`topbar-seg-btn ${currency === c ? 'active-gold' : ''}`}
                    onClick={() => setCurrency(c)}
                  >
                    {c === 'USD' ? '$' : c === 'ZiG' ? 'ZiG' : 'R'}
                  </button>
                ))}
              </div>

              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
                title="Toggle Theme"
              >
                {theme === 'dark' ? <SunIcon size={14} /> : <MoonIcon size={14} />}
              </button>

              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setProfileOpen(true)}
                title="My Profile & Fast PIN"
              >
                👤 {user?.name?.split(' ')[0]}
              </button>
            </div>
          </div>
        </aside>
      )}

      {/* TIER 1: Retractable Left Sidebar with 10 Core Modules */}
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand" style={{ padding: '0.65rem 0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
          <Logo size={32} variant="full" themeColor="light" />
          <button
            type="button"
            className="sidebar-toggle-btn"
            onClick={() => setSidebarRetracted(true)}
            aria-label="Retract navigation sidebar"
            title="Retract Navigation Sidebar (Ctrl+[)"
          >
            ⇤
          </button>
        </div>
        <div className="denderedzwa-frieze sidebar-frieze" aria-hidden="true" />

        <nav aria-label="Main sections">
          {navItems.map((i) => (
            <NavLink
              key={i.to}
              to={i.to}
              end={i.end}
              className="nav-link"
              title={`${i.label} (${i.keyHint})`}
            >
              <span className="nav-dot" aria-hidden="true" />
              <span className="nav-label">{i.label}</span>
              <kbd className="nav-kbd">{i.keyHint}</kbd>
            </NavLink>
          ))}
        </nav>
      </aside>

      {drawer && <button className="scrim" aria-label="Close menu" onClick={() => setDrawer(false)} />}

      <div className="content">
        {/* Top 4px Ndebele Stepped Geometric Ribbon */}
        <div className="ndebele-ribbon" aria-hidden="true" />

        {/* TIER 2: Retractable Top Navigation & Action Bar */}
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <button
              type="button"
              className="btn btn-ghost topbar-toggle-btn"
              aria-label="Toggle sidebar navigation"
              onClick={() => {
                if (window.matchMedia('(max-width: 860px)').matches) {
                  setDrawer((d) => !d);
                } else {
                  setSidebarRetracted((s) => !s);
                }
              }}
              title={sidebarRetracted ? "Expand Sidebar Nav (Ctrl+[)" : "Retract Sidebar Nav (Ctrl+[)"}
              style={{ fontWeight: 700 }}
            >
              {sidebarRetracted ? '⇥ Nav' : '☰'}
            </button>

            <div className="topbar-brand-group">
              <strong className="topbar-ops-title">StockRoom ZW</strong>
              <span className="live-pill" aria-label="Live ledger active">● LIVE</span>
            </div>
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
            {/* 1. Role View Switcher (for Executive Managers who oversee both operational and executive layers) */}
            {user?.role === 'executive_manager' && (
              <div className="topbar-seg-group" role="group" aria-label="Role view switcher">
                <button
                  type="button"
                  className={`topbar-seg-btn ${roleView === 'inventory' ? 'active' : ''}`}
                  onClick={() => setRoleView('inventory')}
                  title="Operational Storefloor Focus"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                >
                  <StorefloorIcon size={13} /> Storefloor
                </button>
                <button
                  type="button"
                  className={`topbar-seg-btn ${roleView === 'executive' ? 'active' : ''}`}
                  onClick={() => setRoleView('executive')}
                  title="Capital Valuation, Margin & ZIMRA VAT Focus"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                >
                  <ExecutiveIcon size={13} /> Executive
                </button>
              </div>
            )}

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

            {/* Launch Standalone POS Counter Terminal */}
            <button
              type="button"
              className="btn btn-pill-action"
              onClick={() => navigate('/pos')}
              title="Launch Standalone POS Sales Counter"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                fontWeight: 700,
                color: 'var(--emerald)',
              }}
            >
              🛍️ POS Counter
            </button>

            {/* 3. Alerts Bell */}
            <button
              type="button"
              className={`btn btn-pill-action ${notifOpen ? 'btn-active' : ''}`}
              onClick={() => setNotifOpen((o) => !o)}
              aria-label={`Notifications (${notifications.length})`}
              aria-expanded={notifOpen}
              title="Live System Notifications"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.25rem 0.55rem' }}
            >
              <BellIcon size={14} /> Alerts
              {notifications.length > 0 && (
                <span className="badge badge-warn" style={{ padding: '1px 5px', fontSize: '0.68rem', marginLeft: '0.15rem' }}>
                  {notifications.length}
                </span>
              )}
            </button>

            {/* 4. Fullscreen Workspace Mode Toggle */}
            <button
              type="button"
              className={`btn btn-pill-action ${isFullScreen ? 'btn-active' : ''}`}
              onClick={toggleFullScreen}
              title="Toggle Fullscreen Mode (Alt+F / F / Esc)"
              aria-label="Toggle Fullscreen"
              style={{ fontWeight: 700, padding: '0.25rem 0.55rem' }}
            >
              ⛶
            </button>

            {/* 5. User Profile Trigger */}
            <button
              type="button"
              className="btn btn-pill-action user-profile-trigger"
              onClick={() => setProfileOpen(true)}
              title="My Profile, PIN, Display & Sign Out"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                cursor: 'pointer',
                fontWeight: 600,
                padding: '0.22rem 0.55rem',
              }}
            >
              <span className="user-avatar" aria-hidden="true" style={{ width: '22px', height: '22px', fontSize: '0.68rem' }}>
                {user?.name?.slice(0, 1).toUpperCase() ?? 'U'}
              </span>
              <span>{user?.name}</span>
            </button>
          </div>
        </header>

        {/* Profile Manager Modal */}
        <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} theme={theme} setTheme={setTheme} />

        {/* Subtle Great Zimbabwe dry-stone chevron (denderedzwa) frieze strip under the header */}
        <div className="denderedzwa-frieze" aria-hidden="true" />

        {/* Slim Breadcrumb & Status Subbar */}
        <div className="subbar" aria-label="Breadcrumb and status">
          <div className="breadcrumb">
            <span>{portalTitle}</span>
            <span className="crumb-sep">/</span>
            <strong>{currentNav?.label ?? 'Stockroom'}</strong>
            {vernacular !== 'english' && currentNav && (
              <>
                <span className="crumb-sep">•</span>
                <span style={{ color: 'var(--zim-gold-500)', fontWeight: 600 }}>
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
        </div>

        <main id="main" className="main" tabIndex={-1}>
          {notifOpen && (
            <section className="card" aria-label="Live Notifications Drawer" style={{ marginBottom: '1.2rem', borderColor: 'var(--gold)' }}>
              <div className="section-head">
                <div>
                  <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                    <BellIcon size={18} /> Live System Notifications ({notifications.length})
                  </h2>
                  <p className="muted" style={{ margin: 0, fontSize: '0.84rem' }}>
                    Real-time alerts computed from stock balances, batch expiry dates, approval queues, and system security.
                  </p>
                </div>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setNotifOpen(false)}>✕ Close</button>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th>Severity</th>
                      <th>Alert</th>
                    </tr>
                  </thead>
                  <tbody>
                    {notifications.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="muted text-center" style={{ padding: '1.5rem' }}>
                          No pending alerts. All systems operational.
                        </td>
                      </tr>
                    ) : (
                      notifications.map((n) => (
                        <tr key={n.id}>
                          <td><strong>{n.category.replace(/_/g, ' ')}</strong></td>
                          <td>
                            <span className={`badge badge-${n.severity === 'warning' ? 'pending' : n.severity === 'critical' ? 'rejected' : 'optimal'}`}>
                              {n.severity}
                            </span>
                          </td>
                          <td>
                            <strong>{n.title}:</strong> {n.message}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <Outlet />
        </main>
      </div>

      <QuickTransferModal
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        onSuccess={() => {
          window.dispatchEvent(new CustomEvent('stockroom:sync'));
        }}
      />
    </div>
  );
}
