import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type BalanceItem, type Summary } from '../api';
import { portalPath, useAuth } from '../auth';
import { AccessibleTabs, type TabDefinition } from '../components/AccessibleTabs';
import { QuickTransferModal } from '../components/QuickTransferModal';
import { Spinner } from '../components/Spinner';
import { useZim } from '../zimContext';
import { GoodsInIcon, QuickAdjustIcon, MoveTransferIcon, WhatsAppIcon } from '../components/Icons';

const ZONE_ROWS = ['A', 'B', 'C', 'D'];
const ZONE_COLS = [1, 2, 3, 4];

type DashSubTab = 'overview' | 'charts' | 'reorder' | 'activity';

export function Dashboard() {
  const { user } = useAuth();
  const { formatMoney, subLabel, roleView, currency, rates } = useZim();
  const [activeSubTab, setActiveSubTab] = useState<DashSubTab>('overview');
  const [data, setData] = useState<Summary | null>(null);
  const [balances, setBalances] = useState<BalanceItem[]>([]);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [transferTarget, setTransferTarget] = useState<{ productId?: number; warehouseId?: number } | null>(null);
  const [whatsappOpen, setWhatsappOpen] = useState(false);
  const [flashMsg, setFlashMsg] = useState('');
  const [error, setError] = useState('');
  const basePath = user ? portalPath(user.role) : '/inventory';

  const load = useCallback(() => {
    Promise.all([
      api.summary(),
      api.balances().catch(() => ({ items: [] as BalanceItem[] })),
    ])
      .then(([sumRes, balRes]) => {
        setData(sumRes);
        setBalances(balRes.items);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    const onSync = () => load();
    window.addEventListener('stockroom:sync', onSync);
    return () => window.removeEventListener('stockroom:sync', onSync);
  }, [load]);

  if (!data && !error) return <Spinner label="Loading dashboard" />;

  const totalSkus = data?.products ?? balances.length;
  const lowStockCount = data?.lowStockCount ?? 0;
  const healthySkus = Math.max(0, totalSkus - lowStockCount);
  const healthPct = totalSkus > 0 ? Math.round((healthySkus / totalSkus) * 100) : 100;
  const totalUnitsAll =
    data?.totalStockUnits !== undefined
      ? data.totalStockUnits
      : (data?.warehouseSummary ?? []).reduce((acc, w) => acc + w.totalUnits, 0);
  const totalValUsd =
    data?.totalStockValue !== undefined
      ? data.totalStockValue
      : (data?.warehouseSummary ?? []).reduce((acc, w) => acc + w.stockValue, 0);

  // Build 16 zone cells (A1..D4) mapped strictly to real warehouse stock balances
  const zoneCells = ZONE_ROWS.flatMap((r, rIdx) =>
    ZONE_COLS.map((c, cIdx) => {
      const idx = rIdx * 4 + cIdx;
      const code = `${r}${c}`;
      const bal = balances[idx];
      const ratio = bal
        ? bal.reorderLevel > 0
          ? Math.min(1, bal.quantity / (bal.reorderLevel * 2))
          : bal.quantity > 0
            ? 0.75
            : 0
        : 0;
      const tier: 'low' | 'mid' | 'high' = ratio >= 0.7 ? 'high' : ratio >= 0.3 ? 'mid' : 'low';
      return {
        code,
        tier,
        pct: Math.round(ratio * 100),
        balance: bal,
      };
    }),
  );

  const subTabs: TabDefinition<DashSubTab>[] = [
    {
      key: 'overview',
      label: '1. Overview & Quick Actions',
      purpose: 'Four core store health indicators and oversized 1-tap buttons for daily storefloor tasks.',
    },
    {
      key: 'charts',
      label: '2. Visual Charts & Trends',
      badge: `${healthPct}%`,
      purpose: 'Visual warehouse zone heatmap, stock health gauge, and multi-currency valuation breakdown.',
    },
    {
      key: 'reorder',
      label: '3. Reorder Alerts',
      badge: lowStockCount,
      purpose: 'Items running low on the shelf with 1-tap Purchase Order restocking and WhatsApp supplier list.',
    },
    {
      key: 'activity',
      label: '4. Recent Floor Activity',
      badge: data?.recentMovements?.length ?? 0,
      purpose: 'Live stream of goods received, issued to departments, or moved between warehouses.',
    },
  ];

  // Build WhatsApp Daily Summary & Reorder List text
  const lowItemsList = (data?.lowStockItems ?? [])
    .map((i) => `• ${i.productName} (${i.sku}): Only ${i.quantity} ${i.unit} left (Reorder at ${i.reorderLevel})`)
    .join('\n');
  const whatsappText = [
    `🇿🇼 *GREAT ZIMBABWE STOCKROOM — DAILY SUMMARY*`,
    `📅 Date: ${new Date().toISOString().slice(0, 10)}`,
    `📦 Active SKUs: ${totalSkus} (${totalUnitsAll.toLocaleString()} base units)`,
    `💰 Total Stock Valuation: ${formatMoney(totalValUsd, 'USD')} | ${formatMoney(totalValUsd, 'ZiG')} | ${formatMoney(totalValUsd, 'ZAR')}`,
    `📥 Receipts Posted: ${data?.receiptsCount ?? 0} (+${data?.receiptsUnits ?? 0} units)`,
    `📤 Issues Posted: ${data?.issuesCount ?? 0} (-${data?.issuesUnits ?? 0} units)`,
    `⚠️ Low-Stock Items (${lowStockCount}):`,
    lowItemsList || '• All items above reorder level ✓',
  ].join('\n');

  return (
    <>
      <div className="page-header">
        <div>
          <h1>
            {roleView === 'executive'
              ? 'Executive Business Command & Capital Overview'
              : 'Storefloor Operations & Quick Actions'}
          </h1>
          <span className="vernacular-sub">
            {subLabel(
              'Mufananidzo Webhizinesi & Zvinhu Zviri Muchitoro',
              'Isimo Sebhizimusi Lempahla Yesitolo',
              'Real-time Zimbabwean SME Stock & Multi-Currency Overview',
            )}
          </span>
        </div>
        <div className="quick-actions">
          <button
            type="button"
            className="btn btn-whatsapp"
            onClick={() => setWhatsappOpen(true)}
            title="Generate WhatsApp Daily Summary & Reorder List for Owner or Supplier"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}
          >
            <WhatsAppIcon size={16} /> WhatsApp Daily Summary
          </button>
          <button type="button" className="btn btn-outline" onClick={load}>
            ↻ Refresh
          </button>
        </div>
      </div>

      {error && <p className="form-error" role="alert">Could not load the dashboard. {error}</p>}
      {flashMsg && <p className="form-success" role="status">{flashMsg}</p>}

      {/* TIER 3: Horizontal In-Page Pill Sub-Menu Bar (renders ONE sub-view at a time) */}
      <AccessibleTabs
        idPrefix="dashboard"
        ariaLabel="Dashboard sub-navigation"
        tabs={subTabs}
        active={activeSubTab}
        onChange={setActiveSubTab}
      />

      {/* SUB-MENU 1: Overview & Quick Actions (Max 4 KPI Cards + 4 Oversized Step Buttons) */}
      {activeSubTab === 'overview' && data && (
        <div id="dashboard-panel-overview" role="tabpanel" aria-labelledby="dashboard-tab-overview">
          <section className="ops-kpi-row" aria-label="Key operational metrics">
            {/* KPI Card 1 */}
            <article className="ops-kpi-card">
              <div className="ops-kpi-top">
                <span className="ops-kpi-title">
                  {roleView === 'executive' ? `Total Capital Value (${currency})` : 'Total Stock On Hand'}
                </span>
                <span className="ops-kpi-trend">{totalUnitsAll.toLocaleString()} base units</span>
              </div>
              <div className="ops-kpi-Mid">
                <div>
                  <div className="ops-kpi-big">{formatMoney(totalValUsd)}</div>
                  <span className="ops-pill-badge">{data.products ?? 0} Active SKUs · {data.warehouses} Warehouses</span>
                </div>
                <svg className="ops-sparkline" viewBox="0 0 110 38" aria-hidden="true">
                  <path
                    d="M2 30 L18 25 L32 28 L48 16 L63 21 L78 10 L94 14 L108 4"
                    fill="none"
                    stroke="var(--zim-green-700)"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                  <path
                    d="M2 30 L18 25 L32 28 L48 16 L63 21 L78 10 L94 14 L108 4 L108 38 L2 38 Z"
                    fill="var(--accent-indigo-soft)"
                  />
                </svg>
              </div>
            </article>

            {/* KPI Card 2 */}
            <article className="ops-kpi-card">
              <div className="ops-kpi-top">
                <span className="ops-kpi-title">Goods In vs Goods Out</span>
                <span className="muted" style={{ margin: 0, fontSize: '.78rem' }}>
                  {(data.receiptsCount ?? 0) + (data.issuesCount ?? 0)} Posted Docs
                </span>
              </div>
              <div className="ops-kpi-big ops-kpi-split-num">
                <span title="Total received base units">
                  <strong>+{(data.receiptsUnits ?? 0).toLocaleString()}</strong> <small>In ({data.receiptsCount ?? 0})</small>
                </span>
                <span className="sep">/</span>
                <span title="Total issued base units">
                  <strong>-{(data.issuesUnits ?? 0).toLocaleString()}</strong> <small>Out ({data.issuesCount ?? 0})</small>
                </span>
              </div>
              <div className="ops-dot-strip">
                <span className="dot active" aria-hidden="true" />
                <span className="ops-dot-caption">
                  {data.branches} Branches · {data.departments} Depts
                  {data.users !== null ? ` · ${data.users} Staff` : ''}
                </span>
              </div>
            </article>

            {/* KPI Card 3 */}
            <article className="ops-kpi-card">
              <div className="ops-kpi-top">
                <span className="ops-kpi-title">
                  {roleView === 'executive' ? 'Est. 15% ZIMRA VAT Pool' : 'Transfers & Pending Approvals'}
                </span>
                <span className="muted" style={{ margin: 0, fontSize: '.78rem' }}>
                  {data.transfersCount ?? 0} Transfer Docs
                </span>
              </div>
              {roleView === 'executive' ? (
                <>
                  <div className="ops-kpi-big">{formatMoney(totalValUsd * 0.15)}</div>
                  <div className="ops-dot-strip">
                    <span className="ops-dot-caption">
                      1 USD = {rates.ZiG} ZiG · {rates.ZAR} ZAR
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div className="ops-kpi-big ops-kpi-split-num">
                    <span>
                      <strong>{(data.transfersUnits ?? 0).toLocaleString()}</strong> <small>Units Moved</small>
                    </span>
                    <span className="sep">/</span>
                    <span>
                      <strong>{data.pendingApprovals?.total ?? data.pendingCountSheets ?? 0}</strong> <small>Pending</small>
                    </span>
                  </div>
                  <div className="ops-dot-strip">
                    <span className="ops-dot-caption">
                      {data.pendingApprovals
                        ? `${data.pendingApprovals.draftPurchaseOrders} POs · ${data.pendingApprovals.pendingRequisitions} Reqs`
                        : `${data.pendingCountSheets ?? 0} draft stocktakes`}
                    </span>
                  </div>
                </>
              )}
            </article>

            {/* KPI Card 4 */}
            <article className="ops-kpi-card ops-kpi-gauge-card">
              <div>
                <span className="ops-kpi-title">Shelf Stock Health</span>
                <div className="ops-gauge-sub">
                  <strong>{healthPct}% Optimal</strong>
                  <span>({lowStockCount} low-stock · {data.expiringSoonCount ?? 0} expiring)</span>
                </div>
                <div className="ops-gauge-legend">
                  <span className="warn">▲ {lowStockCount} Low Stock</span>
                  <span className="opt">● {healthySkus} In Stock</span>
                </div>
              </div>
              <div className="ops-gauge-wrap" aria-hidden="true">
                <svg viewBox="0 0 100 60" className="ops-gauge-svg">
                  <path
                    d="M 12 50 A 38 38 0 0 1 88 50"
                    fill="none"
                    stroke="var(--line)"
                    strokeWidth="10"
                    strokeLinecap="round"
                  />
                  <path
                    d="M 12 50 A 38 38 0 0 1 88 50"
                    fill="none"
                    stroke="var(--zim-green-600)"
                    strokeWidth="10"
                    strokeLinecap="round"
                    strokeDasharray="120"
                    strokeDashoffset={120 - (120 * healthPct) / 100}
                  />
                </svg>
                <div className="ops-gauge-center">
                  <strong>{healthPct}%</strong>
                  <span>Healthy</span>
                </div>
              </div>
            </article>
          </section>

          {/* 4 Oversized Step Buttons for Zero-Computer-Background Staff */}
          <section className="card">
            <div className="section-head">
              <div>
                <h2>1-Tap Storefloor Step Buttons (Zero Typing Needed)</h2>
                <span className="vernacular-sub">
                  {subLabel(
                    'Baya bhatani rimwe chete kuita basa rechitoro',
                    'Cindezela inkinobho eyodwa ukwenza umsebenzi wesitolo',
                    'Tap any large card below to start a guided task',
                  )}
                </span>
              </div>
            </div>
            <div className="big-step-grid">
              <Link to={`${basePath}/procurement`} className="big-step-btn">
                <span className="big-step-icon" aria-hidden="true">
                  <GoodsInIcon size={30} />
                </span>
                <div>
                  <span className="big-step-title">Step 1: Receive Goods (GRN)</span>
                  <span className="big-step-sub">Kugamuchira Zvinhu • Ukuthola Impahla</span>
                  <span className="big-step-desc">Record supplier deliveries, cross-border runner stock, or crates into store.</span>
                </div>
              </Link>

              <Link to={`${basePath}/products`} className="big-step-btn">
                <span className="big-step-icon" aria-hidden="true">
                  <QuickAdjustIcon size={30} />
                </span>
                <div>
                  <span className="big-step-title">Step 2: Quick +1 Add / -1 Issue</span>
                  <span className="big-step-sub">Wedzera kana Kubvisa • Engeza kumbe Susa</span>
                  <span className="big-step-desc">Open visual product cards with oversized +1, -1, and +Bulk buttons.</span>
                </div>
              </Link>

              <button type="button" className="big-step-btn" onClick={() => setTransferTarget({})}>
                <span className="big-step-icon" aria-hidden="true">
                  <MoveTransferIcon size={30} />
                </span>
                <div>
                  <span className="big-step-title">Step 3: Move or Break Bulk</span>
                  <span className="big-step-sub">Kufambisa Zvinhu • Ukuthutha Impahla</span>
                  <span className="big-step-desc">Move stock between store zones, branches, or open a bulk crate onto shelves.</span>
                </div>
              </button>

              <button type="button" className="big-step-btn" onClick={() => setWhatsappOpen(true)}>
                <span className="big-step-icon" aria-hidden="true">
                  <WhatsAppIcon size={30} />
                </span>
                <div>
                  <span className="big-step-title">Step 4: WhatsApp Owner Summary</span>
                  <span className="big-step-sub">Tumira paWhatsApp • Thumela kuWhatsApp</span>
                  <span className="big-step-desc">Send today&apos;s stock balance and low-stock reorder list via WhatsApp.</span>
                </div>
              </button>
            </div>
          </section>
        </div>
      )}

      {/* SUB-MENU 2: Visual Charts & Trends */}
      {activeSubTab === 'charts' && (
        <div id="dashboard-panel-charts" role="tabpanel" aria-labelledby="dashboard-tab-charts">
          <div className="ops-command-grid">
            <section className="card ops-heatmap-card" aria-labelledby="heatmap-heading">
              <div className="section-head">
                <div>
                  <h2 id="heatmap-heading" className="ops-panel-title">STORE &amp; YARD ZONE HEATMAP</h2>
                  <span className="vernacular-sub">
                    {subLabel('Mamepu eMatura', 'Imephu Yezigaba Zesitolo')}
                  </span>
                </div>
                {selectedZone && (
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setSelectedZone(null)}>
                    Clear ({selectedZone})
                  </button>
                )}
              </div>
              <p className="muted" style={{ marginBottom: '.75rem', fontSize: '.84rem' }}>
                Click any zone tile to inspect bin stock or trigger a Quick Transfer.
              </p>

              <div className="heatmap-layout">
                <div className="heatmap-col-headers">
                  <span className="zone-corner">Zone</span>
                  {ZONE_COLS.map((c) => (
                    <span key={c} className="zone-col-label">{c}</span>
                  ))}
                </div>
                {ZONE_ROWS.map((r) => (
                  <div key={r} className="heatmap-row">
                    <span className="zone-row-label">{r}</span>
                    {ZONE_COLS.map((c) => {
                      const code = `${r}${c}`;
                      const cell = zoneCells.find((z) => z.code === code)!;
                      const isSelected = selectedZone === code;
                      return (
                        <button
                          key={code}
                          type="button"
                          className={`zone-tile tier-${cell.tier}${isSelected ? ' is-selected' : ''}`}
                          onClick={() => setSelectedZone(isSelected ? null : code)}
                          title={
                            cell.balance
                              ? `Zone ${code}: ${cell.balance.productName} (${cell.balance.quantity} ${cell.balance.unit} in ${cell.balance.warehouseName})`
                              : `Zone ${code} (${cell.pct}%)`
                          }
                        >
                          <strong>{code}</strong>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>

              <div className="heatmap-legend">
                <span><i className="leg-dot low" /> Low (0–30%)</span>
                <span><i className="leg-dot mid" /> Medium (30–70%)</span>
                <span><i className="leg-dot high" /> Full (70–100%)</span>
              </div>
            </section>

            <section className="card">
              <div className="section-head">
                <div>
                  <h2>Warehouse Valuation Breakdown ({currency})</h2>
                  <span className="vernacular-sub">
                    {subLabel('Hukoshi hweZvinhu muMatura', 'Inani Lempahla Ezigabeni')}
                  </span>
                </div>
                <Link to={`${basePath}/warehouses`}>Open Departments →</Link>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Warehouse / Store</th>
                      <th>Branch</th>
                      <th className="num">Base Units</th>
                      <th className="num">Value ({currency})</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.warehouseSummary ?? []).map((w) => (
                      <tr key={w.warehouseId}>
                        <td><strong>{w.warehouseName}</strong></td>
                        <td>{w.branchName}</td>
                        <td className="num">{w.totalUnits.toLocaleString()}</td>
                        <td className="num"><strong>{formatMoney(w.stockValue)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>
      )}

      {/* SUB-MENU 3: Reorder Alerts */}
      {activeSubTab === 'reorder' && (
        <div id="dashboard-panel-reorder" role="tabpanel" aria-labelledby="dashboard-tab-reorder">
          <section className="card">
            <div className="section-head">
              <div>
                <h2>Low-Stock Reorder Queue ({data?.lowStockItems?.length ?? 0})</h2>
                <span className="vernacular-sub">
                  {subLabel('Zvinhu Zvava Kupera Muchitoro', 'Impahla Esephela Esitolo')}
                </span>
              </div>
              <div className="action-row">
                <button
                  type="button"
                  className="btn btn-whatsapp btn-sm"
                  onClick={() => setWhatsappOpen(true)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
                >
                  <WhatsAppIcon size={14} /> Send Reorder List on WhatsApp
                </button>
                <Link to={`${basePath}/reports`} className="btn btn-outline btn-sm">
                  Full Reports →
                </Link>
              </div>
            </div>

            {data?.lowStockItems && data.lowStockItems.length > 0 ? (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Product</th>
                      <th className="num">Left on Shelf</th>
                      <th className="num">Reorder Level</th>
                      <th>Status</th>
                      <th className="num">1-Tap Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lowStockItems.map((item) => (
                      <tr key={item.productId}>
                        <td><code>{item.sku}</code></td>
                        <td><strong>{item.productName}</strong></td>
                        <td className="num badge-danger-text">{item.quantity} {item.unit}</td>
                        <td className="num">{item.reorderLevel} {item.unit}</td>
                        <td>
                          <span className={`status-pill ${item.quantity <= 0 ? 'out' : 'low'}`}>
                            {item.quantity <= 0 ? 'Out of Stock' : 'Low Stock'}
                          </span>
                        </td>
                        <td className="num">
                          <Link to={`${basePath}/procurement?productId=${item.productId}`} className="btn btn-primary btn-sm">
                            + Order from Supplier
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state-box">
                <strong>All shelves are well stocked!</strong>
                <span>Every active product is currently above its minimum reorder level.</span>
              </div>
            )}
          </section>
        </div>
      )}

      {/* SUB-MENU 4: Recent Floor Activity */}
      {activeSubTab === 'activity' && (
        <div id="dashboard-panel-activity" role="tabpanel" aria-labelledby="dashboard-tab-activity">
          <section className="card">
            <div className="section-head">
              <div>
                <h2>Recent Storefloor Ledger Activity</h2>
                <span className="vernacular-sub">
                  {subLabel('Zvichangobva Kuitika Muchitoro', 'Okusanda Kwenzakala Esitolo')}
                </span>
              </div>
              <Link to={`${basePath}/operations`} className="btn btn-primary btn-sm">
                + Record New Movement
              </Link>
            </div>

            <div className="activity-feed-list" role="log" aria-label="Recent ledger movements">
              {(data?.recentMovements ?? []).map((m) => (
                <div key={m.id} className="activity-feed-row">
                  <span className="feed-time">[{m.createdAt.slice(11, 19) || 'LIVE'}]</span>
                  <span className="feed-doc">DOC #{m.documentId}</span>
                  <span className="feed-arrow">→</span>
                  <span className={`badge badge-${m.type}`}>{m.type.replace('_', ' ').toUpperCase()}</span>
                  <span className="feed-sku">
                    <code>{m.sku}</code> (<strong>{m.productName}</strong>)
                  </span>
                  <span className="feed-wh">| {m.warehouseName}</span>
                  <strong className={`feed-delta ${m.baseChange >= 0 ? 'pos' : 'neg'}`}>
                    {m.baseChange > 0 ? `+${m.baseChange}` : m.baseChange} {m.unit}
                  </strong>
                </div>
              ))}
              {(data?.recentMovements?.length ?? 0) === 0 && (
                <div className="empty-state-box">No movements recorded yet today.</div>
              )}
            </div>
          </section>
        </div>
      )}

      {/* 1-Tap WhatsApp Daily Summary & Reorder List Modal */}
      {whatsappOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="whatsapp-modal-title">
          <div className="modal-card">
            <div className="modal-header-row">
              <h3 id="whatsapp-modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <WhatsAppIcon size={20} /> WhatsApp Daily Summary &amp; Reorder List
              </h3>
              <button type="button" className="btn-icon-close" aria-label="Close" onClick={() => setWhatsappOpen(false)}>
                ✕
              </button>
            </div>
            <p className="muted" style={{ fontSize: '0.84rem' }}>
              Ready to share with the shop owner, partner, or wholesale supplier on WhatsApp:
            </p>
            <textarea
              readOnly
              rows={9}
              value={whatsappText}
              style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.82rem', marginBottom: '0.9rem' }}
            />
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  navigator.clipboard?.writeText(whatsappText).catch(() => {});
                  setFlashMsg('WhatsApp summary copied to clipboard!');
                  setWhatsappOpen(false);
                }}
              >
                Copy Text
              </button>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(whatsappText)}`}
                target="_blank"
                rel="noreferrer"
                className="btn btn-whatsapp"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}
                onClick={() => setWhatsappOpen(false)}
              >
                <WhatsAppIcon size={16} /> Open in WhatsApp
              </a>
            </div>
          </div>
        </div>
      )}

      <QuickTransferModal
        open={!!transferTarget}
        initialProductId={transferTarget?.productId}
        initialFromWarehouseId={transferTarget?.warehouseId}
        onClose={() => setTransferTarget(null)}
        onSuccess={(m) => {
          setFlashMsg(m);
          load();
        }}
      />
    </>
  );
}
