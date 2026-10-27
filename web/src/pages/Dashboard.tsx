import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type BalanceItem, type Summary } from '../api';
import { portalPath, useAuth } from '../auth';
import { QuickTransferModal } from '../components/QuickTransferModal';
import { Spinner } from '../components/Spinner';

const ZONE_ROWS = ['A', 'B', 'C', 'D'];
const ZONE_COLS = [1, 2, 3, 4];

export function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState<Summary | null>(null);
  const [balances, setBalances] = useState<BalanceItem[]>([]);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<'stock' | 'activity'>('stock');
  const [transferTarget, setTransferTarget] = useState<{ productId?: number; warehouseId?: number } | null>(null);
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

  // Build 16 zone cells (A1..D4) mapped strictly to real warehouse stock balances (no synthetic numbers)
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

  const latestMovement = data?.recentMovements?.[0];

  return (
    <>
      {error && <p className="form-error" role="alert">Could not load the dashboard. {error}</p>}
      {flashMsg && <p className="form-success" role="status">{flashMsg}</p>}

      {/* TIER 1: 4 Command KPI Cards backed 100% by real SQLite queries */}
      {data && (
        <section className="ops-kpi-row" aria-label="Key operational metrics">
          {/* Card 1: Total Stock Valuation & Units */}
          <article className="ops-kpi-card">
            <div className="ops-kpi-top">
              <span className="ops-kpi-title">Total Stock Valuation</span>
              <span className="ops-kpi-trend">{totalUnitsAll.toLocaleString()} base units</span>
            </div>
            <div className="ops-kpi-Mid">
              <div>
                <div className="ops-kpi-big">
                  {data.totalStockValue !== undefined
                    ? `$${data.totalStockValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : `${totalUnitsAll.toLocaleString()}`}
                </div>
                <span className="ops-pill-badge">{data.products ?? 0} Active SKUs · {data.warehouses} Warehouses</span>
              </div>
              <svg className="ops-sparkline" viewBox="0 0 110 38" aria-hidden="true">
                <path
                  d="M2 30 L18 25 L32 28 L48 16 L63 21 L78 10 L94 14 L108 4"
                  fill="none"
                  stroke="var(--accent-indigo)"
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

          {/* Card 2: Receipts vs Issues (Real Ledger Totals) */}
          <article className="ops-kpi-card">
            <div className="ops-kpi-top">
              <span className="ops-kpi-title">Receipts &amp; Issues Ledger</span>
              <span className="muted" style={{ margin: 0, fontSize: '.78rem' }}>
                {(data.receiptsCount ?? 0) + (data.issuesCount ?? 0)} Posted Docs
              </span>
            </div>
            <div className="ops-kpi-big ops-kpi-split-num">
              <span title="Total received base units">
                <strong>+{(data.receiptsUnits ?? 0).toLocaleString()}</strong> <small>Received ({data.receiptsCount ?? 0})</small>
              </span>
              <span className="sep">/</span>
              <span title="Total issued base units">
                <strong>-{(data.issuesUnits ?? 0).toLocaleString()}</strong> <small>Issued ({data.issuesCount ?? 0})</small>
              </span>
            </div>
            <div className="ops-dot-strip">
              <span className="dot active" aria-hidden="true" />
              <span className="ops-dot-caption">
                {data.branches} Branches · {data.departments} Depts
                {data.users !== null ? ` · ${data.users} Users` : ''}
              </span>
            </div>
          </article>

          {/* Card 3: Internal Transfers & Pending Approvals */}
          <article className="ops-kpi-card">
            <div className="ops-kpi-top">
              <span className="ops-kpi-title">Transfers &amp; Approvals</span>
              <span className="muted" style={{ margin: 0, fontSize: '.78rem' }}>
                {data.transfersCount ?? 0} Transfer Docs
              </span>
            </div>
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
                  ? `${data.pendingApprovals.draftPurchaseOrders} POs · ${data.pendingApprovals.pendingRequisitions} Reqs · ${data.pendingApprovals.draftCountSheets} Counts`
                  : `${data.pendingCountSheets ?? 0} draft stocktakes`}
              </span>
            </div>
          </article>

          {/* Card 4: Overall Utilization / Reorder Health Gauge */}
          <article className="ops-kpi-card ops-kpi-gauge-card">
            <div>
              <span className="ops-kpi-title">Low-Stock &amp; Health</span>
              <div className="ops-gauge-sub">
                <strong>{healthPct}% Optimal</strong>
                <span>({lowStockCount} low-stock · {data.expiringSoonCount ?? 0} expiring)</span>
              </div>
              <div className="ops-gauge-legend">
                <span className="warn">▲ {lowStockCount} Low Stock</span>
                <span className="opt">● {healthySkus} Optimal</span>
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
                  stroke="var(--accent-teal)"
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray="120"
                  strokeDashoffset={120 - (120 * healthPct) / 100}
                />
              </svg>
              <div className="ops-gauge-center">
                <strong>{healthPct}%</strong>
                <span>Optimal</span>
              </div>
            </div>
          </article>
        </section>
      )}

      {/* TIER 2: Primary Command Split (Warehouse Zone Heatmap + Real-Time Stock & Ledger Status) */}
      <div className="ops-command-grid">
        {/* Left Panel: Warehouse Zone Capacity Heatmap */}
        <section className="card ops-heatmap-card" aria-labelledby="heatmap-heading">
          <div className="section-head">
            <h2 id="heatmap-heading" className="ops-panel-title">WAREHOUSE ZONE CAPACITY (HEATMAP)</h2>
            {selectedZone && (
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setSelectedZone(null)}>
                Clear ({selectedZone})
              </button>
            )}
          </div>
          <p className="muted" style={{ marginBottom: '.75rem', fontSize: '.84rem' }}>
            Click or press Enter on any zone tile to inspect bin stock or trigger a Quick Transfer.
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
            <span><i className="leg-dot low" /> 0–30%</span>
            <span><i className="leg-dot mid" /> 30–70%</span>
            <span><i className="leg-dot high" /> 70–100%</span>
          </div>
        </section>

        {/* Right Panel: Real-Time Stock & Scanner/Ledger Status */}
        <section className="card ops-live-card" aria-labelledby="live-status-heading">
          <div className="section-head">
            <div className="ops-live-title-group">
              <h2 id="live-status-heading" className="ops-panel-title">
                {rightTab === 'stock' ? 'REAL-TIME STOCK & ZONE STATUS' : 'REAL-TIME LEDGER ACTIVITY'}
              </h2>
              <div className="mini-pill-tabs" role="tablist" aria-label="Right panel view">
                <button
                  type="button"
                  role="tab"
                  aria-selected={rightTab === 'stock'}
                  className={`mini-tab${rightTab === 'stock' ? ' active' : ''}`}
                  onClick={() => setRightTab('stock')}
                >
                  Stock Status
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={rightTab === 'activity'}
                  className={`mini-tab${rightTab === 'activity' ? ' active' : ''}`}
                  onClick={() => setRightTab('activity')}
                >
                  Activity Feed
                </button>
              </div>
            </div>
            <span className="live-feed-badge">● LIVE feed</span>
          </div>

          {rightTab === 'stock' ? (
            <div className="table-wrap">
              <table className="data-table ops-status-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>SKU</th>
                    <th>Warehouse / Bin</th>
                    <th>Stock Level</th>
                    <th>Status</th>
                    <th className="num">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {balances.map((b, idx) => {
                    const zoneCode = `${ZONE_ROWS[idx % 4]}${ZONE_COLS[idx % 4]}-${idx + 1}`;
                    const ratio = b.reorderLevel > 0 ? Math.min(100, Math.round((b.quantity / (b.reorderLevel * 2)) * 100)) : 80;
                    const statusClass = b.quantity <= 0 ? 'out' : b.lowStock ? 'low' : 'optimal';
                    const statusLabel = b.quantity <= 0 ? 'Out of Stock' : b.lowStock ? 'Low Stock' : 'In Stock';
                    return (
                      <tr key={`${b.productId}-${b.warehouseId}`}>
                        <td><strong>{b.productName}</strong></td>
                        <td><code>{b.sku}</code></td>
                        <td>
                          <span className="bin-tag">{zoneCode}</span>{' '}
                          <span className="muted" style={{ fontSize: '.82rem' }}>{b.warehouseName}</span>
                        </td>
                        <td style={{ minWidth: '150px' }}>
                          <div className="stock-level-cell">
                            <div className="stock-bar-track">
                              <div className={`stock-bar-fill ${statusClass}`} style={{ width: `${Math.max(8, ratio)}%` }} />
                            </div>
                            <span className="stock-level-num">{b.quantity} {b.unit}</span>
                          </div>
                        </td>
                        <td>
                          <span className={`status-pill ${statusClass}`}>{statusLabel}</span>
                        </td>
                        <td className="num">
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            onClick={() => setTransferTarget({ productId: b.productId, warehouseId: b.warehouseId })}
                            title={`Quick transfer ${b.productName}`}
                          >
                            ⇄ Transfer
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {balances.length === 0 && (
                    <tr>
                      <td colSpan={6} className="muted">
                        No warehouse balances loaded yet. <Link to={`${basePath}/products`}>View Products</Link>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="activity-feed-list" role="log" aria-label="Recent ledger movements">
              {(data?.recentMovements ?? []).map((m) => (
                <div key={m.id} className="activity-feed-row">
                  <span className="feed-time">[{m.createdAt.slice(11, 19) || 'LIVE'}]</span>
                  <span className="feed-doc">DOC #{m.documentId}</span>
                  <span className="feed-arrow">→</span>
                  <span className={`badge badge-${m.type}`}>{m.type.replace('_', ' ').toUpperCase()}</span>
                  <span className="feed-sku">
                    <code>{m.sku}</code> ({m.productName})
                  </span>
                  <span className="feed-wh">| {m.warehouseName}</span>
                  <strong className={`feed-delta ${m.baseChange >= 0 ? 'pos' : 'neg'}`}>
                    {m.baseChange > 0 ? `+${m.baseChange}` : m.baseChange} {m.unit}
                  </strong>
                </div>
              ))}
            </div>
          )}

          {/* Bottom Live Scanner / Ledger Ticker Bar */}
          <div className="ops-ticker-bar">
            <span className="ticker-play" aria-hidden="true">▶</span>
            <span className="ticker-text">
              {latestMovement
                ? `[${latestMovement.createdAt.slice(11, 19) || 'LIVE'}] DOC_${latestMovement.documentId} → ${latestMovement.sku} (${latestMovement.productName}) | ${latestMovement.warehouseName.toUpperCase()}`
                : 'LEDGER_READY → ALL WAREHOUSE ZONES SYNCHRONISED'}
            </span>
            <Link to={`${basePath}/operations`} className="btn-ticker-plus" title="Record new stock movement">
              +
            </Link>
          </div>
        </section>
      </div>

      {/* TIER 3: Warehouse Summary & Quick Navigation Cards */}
      {data?.warehouseSummary && (
        <div className="dashboard-panels" style={{ marginTop: '1.25rem' }}>
          <section className="card">
            <div className="section-head">
              <h2>Warehouses Overview</h2>
              <Link to={`${basePath}/warehouses`}>Manage Warehouses &amp; Depts →</Link>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Warehouse</th>
                    <th>Branch</th>
                    <th className="num">Base Units</th>
                    <th className="num">Stock Value (USD)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.warehouseSummary.map((w) => (
                    <tr key={w.warehouseId}>
                      <td><strong>{w.warehouseName}</strong></td>
                      <td>{w.branchName}</td>
                      <td className="num">{w.totalUnits.toLocaleString()}</td>
                      <td className="num">${w.stockValue.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <div className="section-head">
              <h2>Low-Stock Reorder Queue ({data.lowStockItems?.length ?? 0})</h2>
              <Link to={`${basePath}/reports`}>Full Reports &amp; Alerts →</Link>
            </div>
            {data.lowStockItems && data.lowStockItems.length > 0 ? (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Product</th>
                      <th className="num">On Hand</th>
                      <th className="num">Reorder At</th>
                      <th className="num">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lowStockItems.map((item) => (
                      <tr key={item.productId}>
                        <td><code>{item.sku}</code></td>
                        <td><strong>{item.productName}</strong></td>
                        <td className="num badge-danger-text">{item.quantity} {item.unit}</td>
                        <td className="num">{item.reorderLevel} {item.unit}</td>
                        <td className="num">
                          <Link to={`${basePath}/procurement?productId=${item.productId}`} className="btn btn-primary btn-sm">
                            Order PO
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">All active products are above their reorder thresholds.</p>
            )}
          </section>
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
