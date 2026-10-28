import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type BalanceItem, type Summary, type ProductItem } from '../api';
import { portalPath, useAuth } from '../auth';
import { AccessibleTabs, type TabDefinition } from '../components/AccessibleTabs';
import { QuickTransferModal } from '../components/QuickTransferModal';
import { Spinner } from '../components/Spinner';
import { useZim } from '../zimContext';
import {
  GoodsInIcon,
  QuickAdjustIcon,
  MoveTransferIcon,
  WhatsAppIcon,
  StorefloorIcon,
  CartIcon,
  ProductRetailIcon,
  CheckCircleIcon,
} from '../components/Icons';

type DashSubTab = 'overview' | 'charts' | 'reorder' | 'activity';

interface StoreZoneItem {
  key: string;
  id: number;
  entityType: 'department' | 'warehouse';
  name: string;
  branchName: string;
  category: 'frontstore_pos' | 'groceries' | 'hardware_yard' | 'storeroom' | 'agrovet' | 'general';
  isPos: boolean;
  skuCount: number;
  totalUnits: number;
  totalValue: number;
  lowStockCount: number;
  status: 'optimal' | 'low_stock' | 'empty';
  products: {
    id: number;
    sku: string;
    name: string;
    stock: number;
    unit: string;
    unitCost: number;
    sellingPrice?: number;
    reorderLevel: number;
    isLowStock: boolean;
  }[];
}

export function Dashboard() {
  const { user } = useAuth();
  const { formatMoney, subLabel, roleView, currency, rates } = useZim();
  const [activeSubTab, setActiveSubTab] = useState<DashSubTab>('overview');
  const [data, setData] = useState<Summary | null>(null);
  const [balances, setBalances] = useState<BalanceItem[]>([]);
  const [departments, setDepartments] = useState<{ id: number; name: string; branchId: number; branchName?: string }[]>([]);
  const [warehouses, setWarehouses] = useState<{ id: number; name: string; branchId: number; branchName?: string }[]>([]);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [posDeptId, setPosDeptId] = useState<number | null>(null);
  const [posDeptName, setPosDeptName] = useState<string>('');
  const [mapFilter, setMapFilter] = useState<'all' | 'pos' | 'retail' | 'storage'>('all');
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
      api.departments().catch(() => []),
      api.warehouses().catch(() => []),
      api.organisation().catch(() => null),
      api.products('', { limit: 500 }).catch(() => ({ items: [] as ProductItem[], total: 0 })),
    ])
      .then(([sumRes, balRes, deptRes, whRes, orgRes, prodRes]) => {
        setData(sumRes);
        setBalances(balRes.items ?? []);
        setDepartments(deptRes ?? []);
        setWarehouses(whRes ?? []);
        if (orgRes) {
          setPosDeptId(orgRes.posDepartmentId ?? null);
          setPosDeptName(orgRes.posDepartmentName ?? '');
        }
        setProducts(prodRes.items ?? []);
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

  // Map strictly to real departments and storerooms configured by the user
  const deptZones: StoreZoneItem[] = departments.map((d) => {
    const isPos =
      (posDeptId !== null && d.id === posDeptId) ||
      (posDeptName && d.name.toLowerCase() === posDeptName.toLowerCase()) ||
      d.name.toLowerCase().includes('pos') ||
      d.name.toLowerCase().includes('counter') ||
      d.name.toLowerCase().includes('sales');

    const s = d.name.toLowerCase();
    let category: StoreZoneItem['category'] = 'general';
    if (isPos) category = 'frontstore_pos';
    else if (s.includes('grocer') || s.includes('food') || s.includes('fmcg') || s.includes('tuckshop')) category = 'groceries';
    else if (s.includes('hardware') || s.includes('yard') || s.includes('build') || s.includes('brick') || s.includes('timber') || s.includes('cement')) category = 'hardware_yard';
    else if (s.includes('store') || s.includes('bulk') || s.includes('reserve') || s.includes('warehouse')) category = 'storeroom';
    else if (s.includes('agro') || s.includes('seed') || s.includes('fert')) category = 'agrovet';

    const deptProds = products.filter((p) => p.departmentId === d.id);
    const skuCount = deptProds.length;
    const totalUnits = deptProds.reduce((sum, p) => sum + (p.totalStock ?? 0), 0);
    const totalValue = deptProds.reduce((sum, p) => sum + (p.totalStock ?? 0) * (p.unitCost ?? 0), 0);
    const lowCount = deptProds.filter((p) => (p.totalStock ?? 0) <= p.reorderLevel && p.reorderLevel > 0).length;

    return {
      key: `dept-${d.id}`,
      id: d.id,
      entityType: 'department',
      name: d.name,
      branchName: d.branchName || 'Main Branch',
      category,
      isPos,
      skuCount,
      totalUnits,
      totalValue,
      lowStockCount: lowCount,
      status: skuCount === 0 || totalUnits === 0 ? 'empty' : lowCount > 0 ? 'low_stock' : 'optimal',
      products: deptProds.map((p) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        stock: p.totalStock ?? 0,
        unit: p.baseUnit,
        unitCost: p.unitCost,
        sellingPrice: p.sellingPrice,
        reorderLevel: p.reorderLevel,
        isLowStock: (p.totalStock ?? 0) <= p.reorderLevel && p.reorderLevel > 0,
      })),
    };
  });

  const whZones: StoreZoneItem[] = warehouses.map((w) => {
    const s = w.name.toLowerCase();
    let category: StoreZoneItem['category'] = 'storeroom';
    if (s.includes('yard') || s.includes('outdoor') || s.includes('timber') || s.includes('brick')) category = 'hardware_yard';

    const whBals = balances.filter((b) => b.warehouseId === w.id);
    const skuCount = whBals.length;
    const totalUnits = whBals.reduce((sum, b) => sum + (b.quantity ?? 0), 0);
    const totalValue = whBals.reduce((sum, b) => sum + (b.stockValue ?? 0), 0);
    const lowCount = whBals.filter((b) => (b.quantity ?? 0) <= b.reorderLevel && b.reorderLevel > 0).length;

    return {
      key: `wh-${w.id}`,
      id: w.id,
      entityType: 'warehouse',
      name: w.name,
      branchName: w.branchName || 'Main Branch',
      category,
      isPos: false,
      skuCount,
      totalUnits,
      totalValue,
      lowStockCount: lowCount,
      status: skuCount === 0 || totalUnits === 0 ? 'empty' : lowCount > 0 ? 'low_stock' : 'optimal',
      products: whBals.map((b) => ({
        id: b.productId,
        sku: b.sku,
        name: b.productName,
        stock: b.quantity,
        unit: b.unit,
        unitCost: b.unitCost,
        sellingPrice: undefined,
        reorderLevel: b.reorderLevel,
        isLowStock: b.quantity <= b.reorderLevel && b.reorderLevel > 0,
      })),
    };
  });

  // Combine and sort with POS Counter first, followed by retail floors, then storerooms/yards
  const allZones = [...deptZones, ...whZones].sort((a, b) => {
    if (a.isPos) return -1;
    if (b.isPos) return 1;
    if (a.category === 'groceries') return -1;
    if (b.category === 'groceries') return 1;
    if (a.category === 'hardware_yard') return -1;
    if (b.category === 'hardware_yard') return 1;
    return 0;
  });

  const filteredZones = allZones.filter((z) => {
    if (mapFilter === 'pos') return z.isPos;
    if (mapFilter === 'retail') return z.isPos || z.entityType === 'department';
    if (mapFilter === 'storage') return z.entityType === 'warehouse';
    return true;
  });

  const activeZone = allZones.find((z) => z.key === selectedZone);

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

          {/* POS Counter Velocity & Sales Stats */}
          <section className="card" style={{ marginBottom: '1.25rem', borderLeft: '4px solid var(--emerald)' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                <div className="pos-station-badge" style={{ padding: '0.35rem 0.75rem' }}>
                  <span className="live-dot" style={{ background: '#10b981' }} />
                  <strong>POS Till Sales</strong>
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.96rem', color: 'var(--charcoal)' }}>
                    Live Point of Sale Counter ({posDeptName || 'Active Storefloor'})
                  </div>
                  <span className="muted" style={{ fontSize: '0.8rem' }}>
                    Multi-currency sales velocity, till shift reconciliation, and receipt audit.
                  </span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <div style={{ textAlign: 'right', marginRight: '0.5rem' }}>
                  <span className="muted" style={{ fontSize: '0.74rem', textTransform: 'uppercase' }}>Counter Volume</span>
                  <div style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--emerald)' }}>
                    {(data.issuesUnits ?? 0).toLocaleString()} Units Sold
                  </div>
                </div>
                <Link to="/pos" className="btn btn-primary btn-sm" style={{ fontWeight: 700 }}>
                  🛍️ Launch POS Counter →
                </Link>
              </div>
            </div>
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
              <Link to={`${basePath}/intake`} className="big-step-btn">
                <span className="big-step-icon" aria-hidden="true">
                  <GoodsInIcon size={30} />
                </span>
                <div>
                  <span className="big-step-title">Step 1: Stock Intake (GRN)</span>
                  <span className="big-step-sub">{subLabel('Kugamuchira Zvinhu', 'Ukuthola Impahla', 'Record supplier deliveries & bought stock')}</span>
                  <span className="big-step-desc">Enter supplier deliveries, cartons, or bales with automatic break-bulk.</span>
                </div>
              </Link>

              <Link to={`${basePath}/products`} className="big-step-btn">
                <span className="big-step-icon" aria-hidden="true">
                  <QuickAdjustIcon size={30} />
                </span>
                <div>
                  <span className="big-step-title">Step 2: Quick +1 Add / -1 Issue</span>
                  <span className="big-step-sub">{subLabel('Wedzera kana Kubvisa', 'Engeza kumbe Susa', 'Visual 1-tap shelf stock adjustments')}</span>
                  <span className="big-step-desc">Open visual product cards with oversized +1, -1, and +Bulk buttons.</span>
                </div>
              </Link>

              <button type="button" className="big-step-btn" onClick={() => setTransferTarget({})}>
                <span className="big-step-icon" aria-hidden="true">
                  <MoveTransferIcon size={30} />
                </span>
                <div>
                  <span className="big-step-title">Step 3: Move Stock</span>
                  <span className="big-step-sub">{subLabel('Kufambisa Zvinhu', 'Ukuthutha Impahla', 'Transfer between departments & rooms')}</span>
                  <span className="big-step-desc">Move stock between store zones, departments, or storerooms.</span>
                </div>
              </button>

              <button type="button" className="big-step-btn" onClick={() => setWhatsappOpen(true)}>
                <span className="big-step-icon" aria-hidden="true">
                  <WhatsAppIcon size={30} />
                </span>
                <div>
                  <span className="big-step-title">Step 4: WhatsApp Owner Summary</span>
                  <span className="big-step-sub">{subLabel('Tumira paWhatsApp', 'Thumela kuWhatsApp', 'Share daily stock report to owner')}</span>
                  <span className="big-step-desc">Send today&apos;s stock balance and low-stock reorder list via WhatsApp.</span>
                </div>
              </button>
            </div>
          </section>
        </div>
      )}

      {/* SUB-MENU 2: Visual Charts & Trends (Real Store & Yard Floorplan Map) */}
      {activeSubTab === 'charts' && (
        <div id="dashboard-panel-charts" role="tabpanel" aria-labelledby="dashboard-tab-charts">
          <div className="ops-command-grid">
            <section className="card" aria-labelledby="heatmap-heading">
              <div className="section-head">
                <div>
                  <h2 id="heatmap-heading" className="ops-panel-title">STORE &amp; YARD ARCHITECTURAL MAP</h2>
                  <span className="vernacular-sub">
                    {subLabel('Mamepu eMatura eChitoro neYadhi', 'Imephu Yezigaba Zesitolo Leyadhi')}
                  </span>
                </div>
                {selectedZone && (
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setSelectedZone(null)}>
                    Clear Selection
                  </button>
                )}
              </div>

              <div className="store-map-filter-bar">
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className={`btn btn-sm ${mapFilter === 'all' ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => setMapFilter('all')}
                  >
                    All Zones ({allZones.length})
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm ${mapFilter === 'pos' ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => setMapFilter('pos')}
                  >
                    Front Store &amp; POS
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm ${mapFilter === 'retail' ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => setMapFilter('retail')}
                  >
                    Retail Depts
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm ${mapFilter === 'storage' ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => setMapFilter('storage')}
                  >
                    Storerooms &amp; Yards
                  </button>
                </div>
                <span className="muted" style={{ fontSize: '0.78rem' }}>
                  Click any store area to inspect live on-shelf products and initiate transfers.
                </span>
              </div>

              {filteredZones.length === 0 ? (
                <div className="empty-state-box" style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
                  <h3 style={{ margin: '0 0 0.5rem' }}>No Store or Yard Zones Configured Yet</h3>
                  <p className="muted" style={{ maxWidth: '420px', margin: '0 auto 1.25rem', fontSize: '0.88rem' }}>
                    Set up your departments (e.g. Front Store POS, Sales Department, Storeroom) to visualize live inventory.
                  </p>
                  <Link to={`${basePath}/warehouses`} className="btn btn-primary btn-sm">
                    + Configure Departments &amp; Warehouses
                  </Link>
                </div>
              ) : (
                <div className="store-map-grid" style={{ marginTop: '1rem' }}>
                  {filteredZones.map((z) => {
                    const isSelected = selectedZone === z.key;
                    return (
                      <div
                        key={z.key}
                        className={`store-zone-card ${z.isPos ? 'pos-active-zone' : ''} ${isSelected ? 'selected' : ''}`}
                        onClick={() => setSelectedZone(isSelected ? null : z.key)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedZone(isSelected ? null : z.key);
                          }
                        }}
                      >
                        <div>
                          <div className="zone-header-row">
                            <div className="zone-title-group">
                              <div className="zone-icon-box" aria-hidden="true">
                                {z.isPos ? (
                                  <StorefloorIcon size={22} />
                                ) : z.category === 'hardware_yard' ? (
                                  <ProductRetailIcon name="brick" size={22} />
                                ) : z.category === 'groceries' ? (
                                  <CartIcon size={22} />
                                ) : z.category === 'agrovet' ? (
                                  <ProductRetailIcon name="meal" size={22} />
                                ) : (
                                  <ProductRetailIcon name="box" size={22} />
                                )}
                              </div>
                              <div>
                                <h3 className="zone-name">{z.name}</h3>
                                <div className="zone-branch-tag">{z.branchName}</div>
                              </div>
                            </div>
                            <div>
                              {z.isPos ? (
                                <span
                                  className="zone-type-badge"
                                  style={{
                                    background: 'rgba(217, 119, 6, 0.15)',
                                    color: 'var(--zim-gold-500)',
                                    border: '1px solid var(--zim-gold-500)',
                                  }}
                                >
                                  <span className="live-dot" style={{ background: '#10b981' }} />
                                  POS Active
                                </span>
                              ) : z.entityType === 'department' ? (
                                <span
                                  className="zone-type-badge"
                                  style={{
                                    background: 'rgba(5, 150, 105, 0.15)',
                                    color: 'var(--emerald)',
                                    border: '1px solid var(--line)',
                                  }}
                                >
                                  Department
                                </span>
                              ) : (
                                <span
                                  className="zone-type-badge"
                                  style={{
                                    background: 'var(--surface-alt)',
                                    color: 'var(--charcoal)',
                                    border: '1px solid var(--line)',
                                  }}
                                >
                                  Storage Zone
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="zone-metrics-strip">
                            <div className="zone-metric-item">
                              <span className="zone-metric-label">SKUs</span>
                              <span className="zone-metric-val">{z.skuCount}</span>
                            </div>
                            <div className="zone-metric-item">
                              <span className="zone-metric-label">Total Units</span>
                              <span className="zone-metric-val">{z.totalUnits.toLocaleString()}</span>
                            </div>
                            <div className="zone-metric-item">
                              <span className="zone-metric-label">Valuation</span>
                              <span className="zone-metric-val" style={{ color: 'var(--emerald)' }}>
                                {formatMoney(z.totalValue)}
                              </span>
                            </div>
                          </div>

                          {/* Top 3 Live Products Preview */}
                          {z.products.length > 0 ? (
                            <div className="zone-items-preview">
                              {z.products.slice(0, 3).map((p) => (
                                <div key={p.id} className="zone-item-line">
                                  <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '65%' }}>
                                    {p.name}
                                  </span>
                                  <span style={{ color: p.isLowStock ? 'var(--warning)' : 'var(--emerald)', fontWeight: 700 }}>
                                    {p.stock} {p.unit}
                                  </span>
                                </div>
                              ))}
                              {z.products.length > 3 && (
                                <span className="muted" style={{ fontSize: '0.72rem', textAlign: 'right' }}>
                                  +{z.products.length - 3} more items in this zone
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="zone-items-preview" style={{ color: 'var(--muted)', fontStyle: 'italic', padding: '0.35rem 0' }}>
                              No products assigned to this zone yet.
                            </div>
                          )}
                        </div>

                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                            {z.status === 'optimal' ? (
                              <span className="status-pill optimal">● Optimal Stock</span>
                            ) : z.status === 'low_stock' ? (
                              <span className="status-pill warn">▲ {z.lowStockCount} Low Stock</span>
                            ) : (
                              <span className="status-pill" style={{ background: 'var(--surface-alt)', color: 'var(--muted)', border: '1px solid var(--line)' }}>
                                ○ Ready for Stock
                              </span>
                            )}
                            <span style={{ fontSize: '0.76rem', color: isSelected ? 'var(--emerald)' : 'var(--muted)', fontWeight: 700 }}>
                              {isSelected ? 'Selected (Active)' : 'Click to Inspect →'}
                            </span>
                          </div>

                          <div className="zone-action-row" onClick={(e) => e.stopPropagation()}>
                            {z.isPos ? (
                              <Link
                                to={`${basePath}/pos`}
                                className="btn btn-sm btn-primary"
                                style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}
                              >
                                <CartIcon size={14} /> Open POS Counter
                              </Link>
                            ) : (
                              <Link
                                to={`${basePath}/products?dept=${z.id}`}
                                className="btn btn-sm btn-outline"
                                style={{ flex: 1, textAlign: 'center' }}
                              >
                                + Stock Item
                              </Link>
                            )}
                            <button
                              type="button"
                              className="btn btn-sm btn-secondary"
                              onClick={() => setTransferTarget({ warehouseId: z.entityType === 'warehouse' ? z.id : undefined })}
                              title="Transfer stock to/from this zone"
                            >
                              ⇄ Move
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Legend */}
              <div className="store-map-legend">
                <span>
                  <span className="live-dot" style={{ background: '#10b981', marginRight: '4px' }} />
                  Front Store &amp; Fast POS Counter
                </span>
                <span>
                  <i className="leg-dot mid" style={{ background: 'var(--zim-green-700)' }} />
                  Optimal Stock Level
                </span>
                <span>
                  <i className="leg-dot warn" style={{ background: 'var(--warning)' }} />
                  Low Stock Reorder Alert
                </span>
                <span>
                  <i className="leg-dot low" style={{ background: '#cbd5e1' }} />
                  Empty / Ready for Stocking
                </span>
              </div>
            </section>

            {/* Selected Zone Deep Inspector Panel */}
            {activeZone && (
              <section className="card zone-inspector-panel animate-scale-up" aria-label="Zone Inventory Inspector">
                <div className="section-head">
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                      <span className="pos-station-badge">
                        <span className="live-dot" style={{ background: '#10b981' }} />
                        {activeZone.isPos ? 'FRONT STORE & POS COUNTER' : activeZone.entityType.toUpperCase()}
                      </span>
                      <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>{activeZone.name}</h2>
                    </div>
                    <span className="vernacular-sub">
                      Branch: {activeZone.branchName} • {activeZone.skuCount} Registered Items • Total Units: {activeZone.totalUnits.toLocaleString()}
                    </span>
                  </div>
                  <div className="action-row">
                    {activeZone.isPos && (
                      <Link to={`${basePath}/pos`} className="btn btn-primary btn-sm">
                        🛒 Open POS Counter
                      </Link>
                    )}
                    <Link to={`${basePath}/products?dept=${activeZone.id}`} className="btn btn-outline btn-sm">
                      + Add Products to Zone
                    </Link>
                    <Link to={`${basePath}/procurement`} className="btn btn-outline btn-sm">
                      📥 Receive Goods (GRN)
                    </Link>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setSelectedZone(null)}>
                      ✕ Close
                    </button>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', marginBottom: '1.25rem' }}>
                  <div className="subcard" style={{ padding: '0.75rem' }}>
                    <span className="muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase' }}>Active Stock Units</span>
                    <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--charcoal)' }}>
                      {activeZone.totalUnits.toLocaleString()}
                    </div>
                  </div>
                  <div className="subcard" style={{ padding: '0.75rem' }}>
                    <span className="muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase' }}>Current Valuation</span>
                    <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--emerald)' }}>
                      {formatMoney(activeZone.totalValue)}
                    </div>
                  </div>
                  <div className="subcard" style={{ padding: '0.75rem' }}>
                    <span className="muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase' }}>Registered SKUs</span>
                    <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--charcoal)' }}>
                      {activeZone.skuCount}
                    </div>
                  </div>
                  <div className="subcard" style={{ padding: '0.75rem' }}>
                    <span className="muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase' }}>Stock Health</span>
                    <div style={{ fontSize: '1.1rem', fontWeight: 800, color: activeZone.lowStockCount > 0 ? 'var(--warning)' : 'var(--emerald)' }}>
                      {activeZone.lowStockCount > 0 ? `${activeZone.lowStockCount} Low Items` : activeZone.skuCount > 0 ? '100% Healthy' : 'Ready'}
                    </div>
                  </div>
                </div>

                {activeZone.products.length === 0 ? (
                  <div className="empty-state-box" style={{ padding: '2rem 1rem', textAlign: 'center' }}>
                    <p className="muted" style={{ margin: '0 0 1rem' }}>
                      There are no items currently assigned to <strong>&ldquo;{activeZone.name}&rdquo;</strong>.
                    </p>
                    <Link to={`${basePath}/products?dept=${activeZone.id}`} className="btn btn-primary btn-sm">
                      + Add Products to this Zone
                    </Link>
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>SKU</th>
                          <th>Product Name</th>
                          <th className="num">Stock on Hand</th>
                          <th className="num">Cost Price</th>
                          <th className="num">Retail Price</th>
                          <th>Status</th>
                          <th className="num">Quick Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeZone.products.map((p) => (
                          <tr key={p.id}>
                            <td><code>{p.sku}</code></td>
                            <td><strong>{p.name}</strong></td>
                            <td className="num">
                              <strong>{p.stock}</strong> <small>{p.unit}</small>
                            </td>
                            <td className="num">{formatMoney(p.unitCost)}</td>
                            <td className="num">
                              {p.sellingPrice ? formatMoney(p.sellingPrice) : '—'}
                            </td>
                            <td>
                              {p.stock <= 0 ? (
                                <span className="status-pill danger">Out of Stock</span>
                              ) : p.isLowStock ? (
                                <span className="status-pill warn">Low Stock (≤{p.reorderLevel})</span>
                              ) : (
                                <span className="status-pill optimal">In Stock</span>
                              )}
                            </td>
                            <td className="num">
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => setTransferTarget({ productId: p.id, warehouseId: activeZone.entityType === 'warehouse' ? activeZone.id : undefined })}
                              >
                                ⇄ Transfer
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
