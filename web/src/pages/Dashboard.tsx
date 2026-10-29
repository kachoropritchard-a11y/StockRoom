import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  type BalanceItem,
  type Summary,
  type ProductItem,
  type BatchExpiryItem,
  type StockSerialItem,
  type SmeOverview,
  type RequisitionSummary,
  type CountSheetSummary,
} from '../api';
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
} from '../components/Icons';

type DashSubTab =
  | 'overview'
  | 'charts'
  | 'products_catalog'
  | 'intake_batches'
  | 'serials_audits'
  | 'layby_credit';

interface CategoryItem {
  id: number;
  name: string;
  code?: string;
  parentId: number | null;
  active: number;
}

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
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [batches, setBatches] = useState<BatchExpiryItem[]>([]);
  const [serials, setSerials] = useState<StockSerialItem[]>([]);
  const [smeData, setSmeData] = useState<SmeOverview | null>(null);
  const [requisitions, setRequisitions] = useState<RequisitionSummary[]>([]);
  const [countSheets, setCountSheets] = useState<CountSheetSummary[]>([]);

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
      api.categories().catch(() => []),
      api.batchExpiryTracker().catch(() => ({ items: [] as BatchExpiryItem[] })),
      api.stockSerials().catch(() => ({ items: [] as StockSerialItem[] })),
      api.smeOverview().catch(() => null),
      api.requisitions().catch(() => ({ items: [] as RequisitionSummary[] })),
      api.countSheets().catch(() => ({ items: [] as CountSheetSummary[] })),
    ])
      .then(
        ([
          sumRes,
          balRes,
          deptRes,
          whRes,
          orgRes,
          prodRes,
          catRes,
          batchRes,
          serialRes,
          smeRes,
          reqRes,
          countRes,
        ]) => {
          setData(sumRes);
          setBalances(balRes.items ?? []);
          setDepartments(deptRes ?? []);
          setWarehouses(whRes ?? []);
          if (orgRes) {
            setPosDeptId(orgRes.posDepartmentId ?? null);
            setPosDeptName(orgRes.posDepartmentName ?? '');
          }
          setProducts(prodRes.items ?? []);
          setCategories(catRes ?? []);
          setBatches(batchRes.items ?? []);
          setSerials(serialRes.items ?? []);
          setSmeData(smeRes ?? null);
          setRequisitions(reqRes.items ?? []);
          setCountSheets(countRes.items ?? []);
        },
      )
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    const onSync = () => load();
    window.addEventListener('stockroom:sync', onSync);
    return () => window.removeEventListener('stockroom:sync', onSync);
  }, [load]);

  if (!data && !error) return <Spinner label="Loading comprehensive stock dashboard" />;

  // 1. Catalog & Valuation Metrics
  const totalUnitsAll =
    data?.totalStockUnits !== undefined
      ? data.totalStockUnits
      : (data?.warehouseSummary ?? []).reduce((acc, w) => acc + w.totalUnits, 0);
  const totalValUsd =
    data?.totalStockValue !== undefined
      ? data.totalStockValue
      : (data?.warehouseSummary ?? []).reduce((acc, w) => acc + w.stockValue, 0);

  const totalSkus = data?.products ?? products.length ?? balances.length;

  // Real on-shelf stock health evaluation:
  // Out-of-stock products: registered SKUs with 0 or negative stock
  const outOfStockCount =
    products.length > 0
      ? products.filter((p) => (p.totalStock ?? 0) <= 0).length
      : totalUnitsAll === 0 && totalSkus > 0
        ? totalSkus
        : 0;

  // Low-stock products: positive stock, but at or below reorder level
  const effectiveLowStock =
    products.length > 0
      ? products.filter((p) => (p.totalStock ?? 0) > 0 && (p.totalStock ?? 0) <= p.reorderLevel && p.reorderLevel > 0).length
      : data?.lowStockCount ?? 0;

  // Healthy products: strictly positive stock AND above reorder level
  const healthySkus =
    totalUnitsAll === 0 || totalSkus === 0
      ? 0
      : products.length > 0
        ? products.filter((p) => (p.totalStock ?? 0) > 0 && ((p.totalStock ?? 0) > p.reorderLevel || p.reorderLevel === 0)).length
        : Math.max(0, totalSkus - effectiveLowStock - outOfStockCount);

  // Health %: If there is zero stock or zero SKUs, health is strictly 0%
  const healthPct =
    totalUnitsAll === 0 || totalSkus === 0
      ? 0
      : Math.min(100, Math.max(0, Math.round((healthySkus / totalSkus) * 100)));

  // 2. Batch & FEFO Expiry Calculations
  const expiredBatches = batches.filter((b) => b.daysRemaining <= 0 || b.status === 'EXPIRED');
  const criticalBatches = batches.filter((b) => b.daysRemaining > 0 && b.daysRemaining <= 30);
  const nearBatches = batches.filter((b) => b.daysRemaining > 30 && b.daysRemaining <= 90);
  const goodBatches = batches.filter((b) => b.daysRemaining > 90);
  const totalTrackedBatches = batches.length;

  const expiredPct = totalTrackedBatches > 0 ? Math.round((expiredBatches.length / totalTrackedBatches) * 100) : 0;
  const criticalPct = totalTrackedBatches > 0 ? Math.round((criticalBatches.length / totalTrackedBatches) * 100) : 0;
  const nearPct = totalTrackedBatches > 0 ? Math.round((nearBatches.length / totalTrackedBatches) * 100) : 0;
  const goodPct = totalTrackedBatches > 0 ? Math.max(0, 100 - expiredPct - criticalPct - nearPct) : 100;

  // 3. Serial Number & IMEI Metrics
  const inStockSerials = serials.filter((s) => s.status === 'IN_STOCK');
  const soldSerials = serials.filter((s) => s.status === 'SOLD');
  const defectiveSerials = serials.filter((s) => s.status === 'DEFECTIVE');
  const totalSerialsCount = serials.length;
  const inStockSerialPct = totalSerialsCount > 0 ? Math.round((inStockSerials.length / totalSerialsCount) * 100) : 100;
  const soldSerialPct = totalSerialsCount > 0 ? Math.round((soldSerials.length / totalSerialsCount) * 100) : 0;
  const defectiveSerialPct = totalSerialsCount > 0 ? Math.max(0, 100 - inStockSerialPct - soldSerialPct) : 0;

  // 4. Lay-by, Chikwereti & Change Liabilities
  const pendingLaybys = (smeData?.laybys ?? []).filter((l) => l.status !== 'COMPLETED');
  const totalLaybyValue = pendingLaybys.reduce((sum, l) => sum + (l.totalPaid ?? 0), 0);

  const activeDebtors = (smeData?.debtors ?? []).filter((d) => d.status !== 'CLEARED' && d.balance > 0);
  const totalDebtorBalance = activeDebtors.reduce((sum, d) => sum + (d.balance ?? 0), 0);

  const unredeemedVouchers = (smeData?.changeVouchers ?? []).filter((v) => v.status === 'UNREDEEMED');
  const totalVoucherLiability = unredeemedVouchers.reduce((sum, v) => sum + (v.amountUsd ?? 0), 0);

  // 5. Category-wise Distribution
  const categoryStats = categories.map((cat) => {
    const catProds = products.filter((p) => p.categoryId === cat.id);
    const catUnits = catProds.reduce((sum, p) => sum + (p.totalStock ?? 0), 0);
    const catVal = catProds.reduce((sum, p) => sum + (p.totalStock ?? 0) * (p.unitCost ?? 0), 0);
    return {
      id: cat.id,
      name: cat.name,
      code: cat.code,
      skuCount: catProds.length,
      totalUnits: catUnits,
      valuation: catVal,
      pctOfTotalVal: totalValUsd > 0 ? Math.round((catVal / totalValUsd) * 100) : 0,
    };
  }).sort((a, b) => b.valuation - a.valuation);

  // 6. Departments & Storefloor Architectural Zones
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

  const allZones = [...deptZones, ...whZones].sort((a, b) => {
    if (a.isPos) return -1;
    if (b.isPos) return 1;
    if (a.category === 'groceries') return -1;
    if (b.category === 'groceries') return 1;
    return 0;
  });

  const filteredZones = allZones.filter((z) => {
    if (mapFilter === 'pos') return z.isPos;
    if (mapFilter === 'retail') return z.isPos || z.entityType === 'department';
    if (mapFilter === 'storage') return z.entityType === 'warehouse';
    return true;
  });

  const activeZone = allZones.find((z) => z.key === selectedZone);

  // Sub-tabs configuration
  const subTabs: TabDefinition<DashSubTab>[] = [
    {
      key: 'overview',
      label: '1. Overview & Quick Actions',
      purpose: 'Complete high-level visualizer synthesizing every page: Catalog, Intake, Batches, Serials, Transfers, and Customer Balances.',
    },
    {
      key: 'charts',
      label: '2. Visual Charts & Trends',
      badge: `${healthPct}%`,
      purpose: 'Visual store & yard architectural heatmap, live zone floorplan, and warehouse valuation breakdown.',
    },
    {
      key: 'products_catalog',
      label: '3. Product Catalog & Categories',
      badge: `${totalSkus} SKUs`,
      purpose: 'Category stock valuation bar charts, margin spreads, top valued inventory, and low stock reorder alerts.',
    },
    {
      key: 'intake_batches',
      label: '4. Stock Intake & Batches (FEFO)',
      badge: expiredBatches.length + criticalBatches.length > 0 ? `${expiredBatches.length + criticalBatches.length} Alert` : 'FEFO',
      purpose: 'Supplier inward deliveries (GRN), auto break-bulk events, and FEFO expiry countdown distribution.',
    },
    {
      key: 'serials_audits',
      label: '5. Serials & Stock Audits',
      badge: serials.length > 0 ? `${serials.length} S/N` : undefined,
      purpose: 'High-value IMEI and serial hardware status alongside manual stocktake count sheets & variance audits.',
    },
    {
      key: 'layby_credit',
      label: '6. Lay-by & Customer Balances',
      badge: pendingLaybys.length + activeDebtors.length > 0 ? `${pendingLaybys.length + activeDebtors.length} Active` : undefined,
      purpose: 'Paid & uncollected customer stock (Lay-by), Chikwereti customer credit/debt, and unredeemed till change liabilities.',
    },
  ];

  // WhatsApp Daily Stock Report
  const lowItemsList = (data?.lowStockItems ?? [])
    .map((i) => `• ${i.productName} (${i.sku}): Only ${i.quantity} ${i.unit} left (Reorder at ${i.reorderLevel})`)
    .join('\n');
  const whatsappText = [
    `🇿🇼 *GREAT ZIMBABWE STOCKROOM — COMPREHENSIVE STOCK SUMMARY*`,
    `📅 Date: ${new Date().toISOString().slice(0, 10)}`,
    `📦 Active SKUs: ${totalSkus} (${totalUnitsAll.toLocaleString()} units on hand)`,
    `💰 Total Stock Valuation: ${formatMoney(totalValUsd, 'USD')} | ${formatMoney(totalValUsd, 'ZiG')} | ${formatMoney(totalValUsd, 'ZAR')}`,
    `📥 Intake (Receipts): ${data?.receiptsCount ?? 0} (+${data?.receiptsUnits ?? 0} units)`,
    `📤 Dispatched/Sold: ${data?.issuesCount ?? 0} (-${data?.issuesUnits ?? 0} units)`,
    `⇄ Transfers Moved: ${data?.transfersCount ?? 0} (${data?.transfersUnits ?? 0} units)`,
    `⏳ Expiring Batches: ${expiredBatches.length} expired, ${criticalBatches.length} critical (≤30d)`,
    `🔢 Serial/IMEI Units: ${inStockSerials.length} in stock`,
    `🤝 Customer Balances: ${pendingLaybys.length} Lay-bys (${formatMoney(totalLaybyValue)}), ${activeDebtors.length} Chikwereti Debts (${formatMoney(totalDebtorBalance)})`,
    `⚠️ Stock Attention Items (${outOfStockCount > 0 ? `${outOfStockCount} Out, ` : ''}${effectiveLowStock} Low):`,
    totalUnitsAll === 0
      ? '• No inventory currently on hand (0 base units). Stock intake required.'
      : lowItemsList || '• All active items are above reorder level ✓',
  ].join('\n');

  return (
    <>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1>
            {roleView === 'executive'
              ? 'Executive Business Command & Multi-Stock Visualizer'
              : 'Storefloor Operations & Stock Systems Dashboard'}
          </h1>
          <span className="vernacular-sub">
            {subLabel(
              'Mufananidzo weZvinhu Zvose Zvemuchitoro neMagwaro',
              'Isimo Sawo Wonke Amaphepha Empahla Yesitolo',
              'Real-Time Visualization of Every Stock Page & Sub-System',
            )}
          </span>
        </div>
        <div className="quick-actions">
          <button
            type="button"
            className="btn btn-whatsapp"
            onClick={() => setWhatsappOpen(true)}
            title="Generate WhatsApp Daily Summary for Owner or Supplier"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}
          >
            <WhatsAppIcon size={16} /> WhatsApp Stock Report
          </button>
          <button type="button" className="btn btn-outline" onClick={load}>
            ↻ Refresh All
          </button>
        </div>
      </div>

      {error && <p className="form-error" role="alert">Could not load dashboard data: {error}</p>}
      {flashMsg && <p className="form-success" role="status">{flashMsg}</p>}

      {/* GLOBAL STOCK KPI RIBBON (8 Key Indicators) */}
      <section className="ops-kpi-row" aria-label="Global stock KPI indicators">
        {/* KPI 1: Valuation */}
        <article className="ops-kpi-card">
          <div className="ops-kpi-top">
            <span className="ops-kpi-title">Stock Valuation</span>
            <span className="ops-kpi-trend">{totalSkus} {totalSkus === 1 ? 'SKU' : 'SKUs'}</span>
          </div>
          <div className="ops-kpi-Mid">
            <div>
              <div className="ops-kpi-big">{formatMoney(totalValUsd)}</div>
              <span className="ops-pill-badge">
                {formatMoney(totalValUsd, 'ZiG')} · {formatMoney(totalValUsd, 'ZAR')}
              </span>
            </div>
            <svg className="ops-sparkline" viewBox="0 0 110 38" aria-hidden="true">
              <path
                d="M2 30 L18 25 L32 28 L48 16 L63 21 L78 10 L94 14 L108 4"
                fill="none"
                stroke={totalValUsd > 0 ? 'var(--zim-green-700)' : 'var(--line)'}
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              <path
                d="M2 30 L18 25 L32 28 L48 16 L63 21 L78 10 L94 14 L108 4 L108 38 L2 38 Z"
                fill={totalValUsd > 0 ? 'var(--accent-indigo-soft)' : 'transparent'}
              />
            </svg>
          </div>
        </article>

        {/* KPI 2: On-Hand Units */}
        <article className="ops-kpi-card">
          <div className="ops-kpi-top">
            <span className="ops-kpi-title">Units On Hand</span>
            <span className="muted" style={{ margin: 0, fontSize: '.78rem' }}>
              {departments.length} Depts · {warehouses.length} Storerooms
            </span>
          </div>
          <div className="ops-kpi-big">
            {totalUnitsAll.toLocaleString()} <small style={{ fontSize: '0.85rem' }}>base units</small>
          </div>
          <div className="ops-dot-strip">
            <span className={`dot ${totalUnitsAll > 0 ? 'active' : ''}`} aria-hidden="true" />
            <span className="ops-dot-caption">
              {totalUnitsAll > 0
                ? 'Across all storefloors & storage yards'
                : 'Zero stock in system (Stock Intake required)'}
            </span>
          </div>
        </article>

        {/* KPI 3: Inward vs Outward */}
        <article className="ops-kpi-card">
          <div className="ops-kpi-top">
            <span className="ops-kpi-title">Intake vs Dispatches</span>
            <span className="muted" style={{ margin: 0, fontSize: '.78rem' }}>
              {(data?.receiptsCount ?? 0) + (data?.issuesCount ?? 0)} Docs
            </span>
          </div>
          <div className="ops-kpi-big ops-kpi-split-num">
            <span title="Total received units">
              <strong>+{(data?.receiptsUnits ?? 0).toLocaleString()}</strong> <small>In</small>
            </span>
            <span className="sep">/</span>
            <span title="Total issued units">
              <strong>-{(data?.issuesUnits ?? 0).toLocaleString()}</strong> <small>Out</small>
            </span>
          </div>
          <div className="ops-dot-strip">
            <span className="ops-dot-caption">
              {(data?.transfersUnits ?? 0).toLocaleString()} units moved between departments
            </span>
          </div>
        </article>

        {/* KPI 4: Shelf Health Gauge */}
        <article className="ops-kpi-card ops-kpi-gauge-card">
          <div>
            <span className="ops-kpi-title">Shelf Health</span>
            <div className="ops-gauge-sub">
              <strong>
                {totalUnitsAll === 0 || totalSkus === 0
                  ? '0% (No Stock)'
                  : healthPct >= 80
                    ? `${healthPct}% Optimal`
                    : healthPct >= 50
                      ? `${healthPct}% Moderate`
                      : `${healthPct}% Critical`}
              </strong>
              <span>
                {totalUnitsAll === 0 || totalSkus === 0
                  ? '(Empty inventory)'
                  : `(${outOfStockCount > 0 ? `${outOfStockCount} out · ` : ''}${effectiveLowStock} low · ${expiredBatches.length} expired)`}
              </span>
            </div>
            <div className="ops-gauge-legend">
              {totalUnitsAll === 0 ? (
                <span className="warn" style={{ color: 'var(--danger)' }}>▲ 0 In Stock (Empty)</span>
              ) : (
                <>
                  {outOfStockCount + effectiveLowStock > 0 && (
                    <span className="warn">▲ {outOfStockCount + effectiveLowStock} Restock</span>
                  )}
                  <span className="opt">● {healthySkus} In Stock</span>
                </>
              )}
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
                stroke={
                  totalUnitsAll === 0 || healthPct === 0
                    ? 'var(--line)'
                    : healthPct < 50
                      ? '#ef4444'
                      : healthPct < 80
                        ? '#f59e0b'
                        : 'var(--zim-green-600)'
                }
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray="120"
                strokeDashoffset={120 - (120 * healthPct) / 100}
              />
            </svg>
            <div className="ops-gauge-center">
              <strong>{healthPct}%</strong>
              <span>
                {totalUnitsAll === 0
                  ? 'No Stock'
                  : healthPct >= 80
                    ? 'Healthy'
                    : healthPct >= 50
                      ? 'Moderate'
                      : 'Critical'}
              </span>
            </div>
          </div>
        </article>
      </section>

      {/* ACCESSIBLE SUB-TABS */}
      <AccessibleTabs
        idPrefix="dashboard-systems"
        ariaLabel="Stock systems navigation tabs"
        tabs={subTabs}
        active={activeSubTab}
        onChange={setActiveSubTab}
      />

      {/* =========================================================================
          TAB 1: OVERVIEW & MASTER STOCK SYSTEMS VISUALIZER
          ========================================================================= */}
      {activeSubTab === 'overview' && (
        <div id="dashboard-panel-overview" role="tabpanel" aria-labelledby="dashboard-tab-overview">
          {/* 4 Oversized Step Buttons for Daily Operations */}
          <section className="big-step-grid" style={{ marginBottom: '1.25rem' }}>
            <Link to={`${basePath}/intake`} className="big-step-btn">
              <span className="big-step-icon" aria-hidden="true"><GoodsInIcon size={26} /></span>
              <div>
                <span className="big-step-title">Step 1: Stock Intake (GRN)</span>
                <span className="big-step-sub">{subLabel('Kugamuchira Zvinhu', 'Ukuthola Impahla', 'Bought Stock & GRN')}</span>
                <span className="big-step-desc">Enter supplier deliveries, batches, expiry, and serials.</span>
              </div>
            </Link>
            <Link to={`${basePath}/products`} className="big-step-btn">
              <span className="big-step-icon" aria-hidden="true"><QuickAdjustIcon size={26} /></span>
              <div>
                <span className="big-step-title">Step 2: Quick +1 Add / -1 Issue</span>
                <span className="big-step-sub">{subLabel('Wedzera kana Kubvisa', 'Engeza kumbe Susa', 'Visual Adjustments')}</span>
                <span className="big-step-desc">Open product cards with oversized +1, -1, and bulk buttons.</span>
              </div>
            </Link>
            <button type="button" className="big-step-btn" onClick={() => setTransferTarget({})}>
              <span className="big-step-icon" aria-hidden="true"><MoveTransferIcon size={26} /></span>
              <div>
                <span className="big-step-title">Step 3: Move Stock</span>
                <span className="big-step-sub">{subLabel('Kufambisa Zvinhu', 'Ukuthutha Impahla', 'Inter-Department Move')}</span>
                <span className="big-step-desc">Move stock between departments and storage yards.</span>
              </div>
            </button>
            <button type="button" className="big-step-btn" onClick={() => setWhatsappOpen(true)}>
              <span className="big-step-icon" aria-hidden="true"><WhatsAppIcon size={26} /></span>
              <div>
                <span className="big-step-title">Step 4: WhatsApp Owner Summary</span>
                <span className="big-step-sub">{subLabel('Tumira paWhatsApp', 'Thumela kuWhatsApp', 'Daily Stock Report')}</span>
                <span className="big-step-desc">Send stock balance and reorder list directly to the owner.</span>
              </div>
            </button>
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
                    {(data?.issuesUnits ?? 0).toLocaleString()} Units Sold
                  </div>
                </div>
                <Link to="/pos" className="btn btn-primary btn-sm" style={{ fontWeight: 700 }}>
                  🛍️ Launch POS Counter →
                </Link>
              </div>
            </div>
          </section>

          {/* MASTER STOCK SYSTEMS VISUALIZER GRID (EVERY STOCK PAGE SUMMARIZED) */}
          <div className="stock-visual-grid">
            {/* WIDGET 1: Product Manager & Catalog State */}
            <article className="stock-system-card">
              <div>
                <div className="stock-system-header">
                  <div className="stock-system-title-group">
                    <div className="stock-system-icon-badge" aria-hidden="true">🏷️</div>
                    <div>
                      <h2 className="stock-system-title">Product Manager &amp; Catalog</h2>
                      <span className="stock-system-page-tag">Page: /products</span>
                    </div>
                  </div>
                  <Link to={`${basePath}/products`} className="btn btn-sm btn-outline">
                    Open Manager →
                  </Link>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <div className="subcard" style={{ padding: '0.6rem' }}>
                    <span className="muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase' }}>Active SKUs</span>
                    <div style={{ fontSize: '1.2rem', fontWeight: 800 }}>{totalSkus}</div>
                  </div>
                  <div className="subcard" style={{ padding: '0.6rem' }}>
                    <span className="muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase' }}>Categories</span>
                    <div style={{ fontSize: '1.2rem', fontWeight: 800 }}>{categories.length}</div>
                  </div>
                  <div className="subcard" style={{ padding: '0.6rem' }}>
                    <span className="muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase' }}>
                      {outOfStockCount > 0 ? 'Out of Stock' : 'Low Stock'}
                    </span>
                    <div
                      style={{
                        fontSize: '1.2rem',
                        fontWeight: 800,
                        color:
                          outOfStockCount > 0
                            ? 'var(--danger)'
                            : effectiveLowStock > 0
                              ? 'var(--warning)'
                              : 'var(--emerald)',
                      }}
                    >
                      {outOfStockCount > 0 ? outOfStockCount : effectiveLowStock}
                    </div>
                  </div>
                </div>

                {/* Category Valuation Breakdown Visual Bars */}
                <div style={{ marginTop: '0.5rem' }}>
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--charcoal)' }}>Top Categories by Valuation</span>
                  <div className="visual-bar-chart">
                    {categoryStats.slice(0, 3).map((cat) => (
                      <div key={cat.id} className="visual-bar-row">
                        <span className="visual-bar-label" title={cat.name}>{cat.name}</span>
                        <div className="visual-bar-track">
                          <div className="visual-bar-fill" style={{ width: `${Math.max(5, cat.pctOfTotalVal)}%` }} />
                        </div>
                        <span className="visual-bar-value">{formatMoney(cat.valuation)}</span>
                      </div>
                    ))}
                    {categoryStats.length === 0 && (
                      <span className="muted" style={{ fontSize: '0.78rem', fontStyle: 'italic' }}>No categories created yet.</span>
                    )}
                  </div>
                </div>

                {/* Mini Top Products Table */}
                <div className="table-wrap" style={{ marginTop: '0.6rem' }}>
                  <table className="data-table" style={{ fontSize: '0.8rem' }}>
                    <thead>
                      <tr>
                        <th>SKU</th>
                        <th>Product</th>
                        <th className="num">Stock</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {products.slice(0, 3).map((p) => (
                        <tr key={p.id}>
                          <td><code>{p.sku}</code></td>
                          <td><strong>{p.name}</strong></td>
                          <td className="num">{p.totalStock ?? 0} {p.baseUnit}</td>
                          <td>
                            {(p.totalStock ?? 0) <= 0 ? (
                              <span className="status-pill danger">Out</span>
                            ) : (p.totalStock ?? 0) <= p.reorderLevel ? (
                              <span className="status-pill warn">Low</span>
                            ) : (
                              <span className="status-pill optimal">OK</span>
                            )}
                          </td>
                        </tr>
                      ))}
                      {products.length === 0 && (
                        <tr><td colSpan={4} className="muted" style={{ textAlign: 'center' }}>No products registered yet.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </article>

            {/* WIDGET 2: Stock Intake (GRN Deliveries & Auto Break-Bulk) */}
            <article className="stock-system-card">
              <div>
                <div className="stock-system-header">
                  <div className="stock-system-title-group">
                    <div className="stock-system-icon-badge" aria-hidden="true">📥</div>
                    <div>
                      <h2 className="stock-system-title">Stock Intake &amp; Deliveries</h2>
                      <span className="stock-system-page-tag">Page: /intake</span>
                    </div>
                  </div>
                  <Link to={`${basePath}/intake`} className="btn btn-sm btn-outline">
                    Open Intake →
                  </Link>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <div className="subcard" style={{ padding: '0.6rem' }}>
                    <span className="muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase' }}>Receipts Posted</span>
                    <div style={{ fontSize: '1.2rem', fontWeight: 800 }}>{data?.receiptsCount ?? 0}</div>
                  </div>
                  <div className="subcard" style={{ padding: '0.6rem' }}>
                    <span className="muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase' }}>Inward Units</span>
                    <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--emerald)' }}>
                      +{(data?.receiptsUnits ?? 0).toLocaleString()}
                    </div>
                  </div>
                  <div className="subcard" style={{ padding: '0.6rem' }}>
                    <span className="muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase' }}>Auto Break-Bulk</span>
                    <div style={{ fontSize: '1.2rem', fontWeight: 800 }}>
                      {smeData?.yieldBatches?.length ?? 0}
                    </div>
                  </div>
                </div>

                {/* Inward vs Outward Movement Progress Bar */}
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--charcoal)' }}>Inward Intake vs Outward Velocity</span>
                <div className="visual-meter-bar">
                  <div
                    className="visual-meter-segment green"
                    style={{
                      width: `${
                        (data?.receiptsUnits ?? 0) + (data?.issuesUnits ?? 0) > 0
                          ? Math.round(((data?.receiptsUnits ?? 0) / ((data?.receiptsUnits ?? 0) + (data?.issuesUnits ?? 0))) * 100)
                          : 50
                      }%`,
                    }}
                    title={`Inward: ${data?.receiptsUnits ?? 0} units`}
                  />
                  <div
                    className="visual-meter-segment orange"
                    style={{
                      width: `${
                        (data?.receiptsUnits ?? 0) + (data?.issuesUnits ?? 0) > 0
                          ? Math.round(((data?.issuesUnits ?? 0) / ((data?.receiptsUnits ?? 0) + (data?.issuesUnits ?? 0))) * 100)
                          : 50
                      }%`,
                    }}
                    title={`Outward: ${data?.issuesUnits ?? 0} units`}
                  />
                </div>
                <div className="visual-meter-legend">
                  <span className="visual-meter-legend-item">
                    <span className="visual-legend-dot" style={{ background: '#10b981' }} />
                    Inward Delivery (+{(data?.receiptsUnits ?? 0).toLocaleString()} units)
                  </span>
                  <span className="visual-meter-legend-item">
                    <span className="visual-legend-dot" style={{ background: '#f97316' }} />
                    Dispatches (-{(data?.issuesUnits ?? 0).toLocaleString()} units)
                  </span>
                </div>

                {/* Recent Intake Ledger */}
                <div className="table-wrap" style={{ marginTop: '0.6rem' }}>
                  <table className="data-table" style={{ fontSize: '0.8rem' }}>
                    <thead>
                      <tr>
                        <th>Doc</th>
                        <th>Product</th>
                        <th className="num">Inflow</th>
                        <th>Location</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data?.recentMovements ?? [])
                        .filter((m) => m.type === 'receipt')
                        .slice(0, 3)
                        .map((m) => (
                          <tr key={m.id}>
                            <td><code>#{m.documentId}</code></td>
                            <td><strong>{m.productName}</strong></td>
                            <td className="num" style={{ color: 'var(--emerald)', fontWeight: 700 }}>
                              +{m.quantity} {m.unit}
                            </td>
                            <td>{m.warehouseName}</td>
                          </tr>
                        ))}
                      {(data?.recentMovements ?? []).filter((m) => m.type === 'receipt').length === 0 && (
                        <tr><td colSpan={4} className="muted" style={{ textAlign: 'center' }}>No stock intake receipts posted yet today.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </article>

            {/* WIDGET 3: Batch & FEFO Expiry Tracker */}
            <article className="stock-system-card">
              <div>
                <div className="stock-system-header">
                  <div className="stock-system-title-group">
                    <div className="stock-system-icon-badge" aria-hidden="true">⏳</div>
                    <div>
                      <h2 className="stock-system-title">Batch &amp; Expiry Tracker (FEFO)</h2>
                      <span className="stock-system-page-tag">Intake Feature &amp; FEFO</span>
                    </div>
                  </div>
                  <button type="button" className="btn btn-sm btn-outline" onClick={() => setActiveSubTab('intake_batches')}>
                    View Batches →
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.4rem', marginBottom: '0.75rem' }}>
                  <div className="subcard" style={{ padding: '0.5rem', textAlign: 'center' }}>
                    <span className="muted" style={{ fontSize: '0.68rem', textTransform: 'uppercase' }}>Expired</span>
                    <div style={{ fontSize: '1.1rem', fontWeight: 800, color: expiredBatches.length > 0 ? 'var(--danger)' : 'var(--charcoal)' }}>
                      {expiredBatches.length}
                    </div>
                  </div>
                  <div className="subcard" style={{ padding: '0.5rem', textAlign: 'center' }}>
                    <span className="muted" style={{ fontSize: '0.68rem', textTransform: 'uppercase' }}>≤30 Days</span>
                    <div style={{ fontSize: '1.1rem', fontWeight: 800, color: criticalBatches.length > 0 ? 'var(--warning)' : 'var(--charcoal)' }}>
                      {criticalBatches.length}
                    </div>
                  </div>
                  <div className="subcard" style={{ padding: '0.5rem', textAlign: 'center' }}>
                    <span className="muted" style={{ fontSize: '0.68rem', textTransform: 'uppercase' }}>31-90 Days</span>
                    <div style={{ fontSize: '1.1rem', fontWeight: 800 }}>
                      {nearBatches.length}
                    </div>
                  </div>
                  <div className="subcard" style={{ padding: '0.5rem', textAlign: 'center' }}>
                    <span className="muted" style={{ fontSize: '0.68rem', textTransform: 'uppercase' }}>&gt;90 Days</span>
                    <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--emerald)' }}>
                      {goodBatches.length}
                    </div>
                  </div>
                </div>

                {/* FEFO Expiry Distribution Multi-Segment Visual Meter */}
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--charcoal)' }}>FEFO Shelf-Life Timeline Distribution</span>
                <div className="visual-meter-bar">
                  <div className="visual-meter-segment red" style={{ width: `${expiredPct}%` }} title={`Expired: ${expiredBatches.length} batches`} />
                  <div className="visual-meter-segment orange" style={{ width: `${criticalPct}%` }} title={`Critical ≤30d: ${criticalBatches.length} batches`} />
                  <div className="visual-meter-segment gold" style={{ width: `${nearPct}%` }} title={`Near 31-90d: ${nearBatches.length} batches`} />
                  <div className="visual-meter-segment green" style={{ width: `${goodPct}%` }} title={`Good >90d: ${goodBatches.length} batches`} />
                </div>
                <div className="visual-meter-legend">
                  <span className="visual-meter-legend-item">
                    <span className="visual-legend-dot" style={{ background: '#ef4444' }} /> Expired ({expiredBatches.length})
                  </span>
                  <span className="visual-meter-legend-item">
                    <span className="visual-legend-dot" style={{ background: '#f97316' }} /> ≤30d ({criticalBatches.length})
                  </span>
                  <span className="visual-meter-legend-item">
                    <span className="visual-legend-dot" style={{ background: '#f59e0b' }} /> 31-90d ({nearBatches.length})
                  </span>
                  <span className="visual-meter-legend-item">
                    <span className="visual-legend-dot" style={{ background: '#10b981' }} /> Fresh ({goodBatches.length})
                  </span>
                </div>

                {/* Mini Expiry Watchlist */}
                <div className="table-wrap" style={{ marginTop: '0.6rem' }}>
                  <table className="data-table" style={{ fontSize: '0.8rem' }}>
                    <thead>
                      <tr>
                        <th>Batch</th>
                        <th>Product</th>
                        <th className="num">Stock</th>
                        <th>Days Left</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...expiredBatches, ...criticalBatches, ...nearBatches].slice(0, 3).map((b, i) => (
                        <tr key={`${b.productId}-${b.batchNumber}-${i}`}>
                          <td><code>{b.batchNumber || 'N/A'}</code></td>
                          <td><strong>{b.productName}</strong></td>
                          <td className="num">{b.inStockQty} {b.unit}</td>
                          <td>
                            {b.daysRemaining <= 0 ? (
                              <span className="status-pill danger">EXPIRED ({Math.abs(b.daysRemaining)}d ago)</span>
                            ) : b.daysRemaining <= 30 ? (
                              <span className="status-pill warn">{b.daysRemaining} days left</span>
                            ) : (
                              <span className="status-pill">{b.daysRemaining} days</span>
                            )}
                          </td>
                        </tr>
                      ))}
                      {batches.length === 0 && (
                        <tr><td colSpan={4} className="muted" style={{ textAlign: 'center' }}>No perishable batches registered yet.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </article>

            {/* WIDGET 4: Serial Number & IMEI Registry */}
            <article className="stock-system-card">
              <div>
                <div className="stock-system-header">
                  <div className="stock-system-title-group">
                    <div className="stock-system-icon-badge" aria-hidden="true">🔢</div>
                    <div>
                      <h2 className="stock-system-title">Serial Number &amp; IMEI Registry</h2>
                      <span className="stock-system-page-tag">High-Value Hardware</span>
                    </div>
                  </div>
                  <button type="button" className="btn btn-sm btn-outline" onClick={() => setActiveSubTab('serials_audits')}>
                    View Serials →
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <div className="subcard" style={{ padding: '0.6rem' }}>
                    <span className="muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase' }}>In Stock</span>
                    <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--emerald)' }}>
                      {inStockSerials.length}
                    </div>
                  </div>
                  <div className="subcard" style={{ padding: '0.6rem' }}>
                    <span className="muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase' }}>Sold / Dispatched</span>
                    <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--accent-indigo)' }}>
                      {soldSerials.length}
                    </div>
                  </div>
                  <div className="subcard" style={{ padding: '0.6rem' }}>
                    <span className="muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase' }}>Defective</span>
                    <div style={{ fontSize: '1.2rem', fontWeight: 800, color: defectiveSerials.length > 0 ? 'var(--danger)' : 'var(--charcoal)' }}>
                      {defectiveSerials.length}
                    </div>
                  </div>
                </div>

                {/* Serial Hardware Status Distribution Bar */}
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--charcoal)' }}>Serialized Assets Distribution</span>
                <div className="visual-meter-bar">
                  <div className="visual-meter-segment green" style={{ width: `${inStockSerialPct}%` }} title={`In Stock: ${inStockSerials.length}`} />
                  <div className="visual-meter-segment indigo" style={{ width: `${soldSerialPct}%` }} title={`Sold: ${soldSerials.length}`} />
                  <div className="visual-meter-segment red" style={{ width: `${defectiveSerialPct}%` }} title={`Defective: ${defectiveSerials.length}`} />
                </div>
                <div className="visual-meter-legend">
                  <span className="visual-meter-legend-item">
                    <span className="visual-legend-dot" style={{ background: '#10b981' }} /> In Stock ({inStockSerials.length})
                  </span>
                  <span className="visual-meter-legend-item">
                    <span className="visual-legend-dot" style={{ background: '#6366f1' }} /> Sold ({soldSerials.length})
                  </span>
                  <span className="visual-meter-legend-item">
                    <span className="visual-legend-dot" style={{ background: '#ef4444' }} /> Defective ({defectiveSerials.length})
                  </span>
                </div>

                {/* Mini Serials Table */}
                <div className="table-wrap" style={{ marginTop: '0.6rem' }}>
                  <table className="data-table" style={{ fontSize: '0.8rem' }}>
                    <thead>
                      <tr>
                        <th>Hardware S/N or IMEI</th>
                        <th>Product</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {serials.slice(0, 3).map((s) => (
                        <tr key={s.id}>
                          <td><code>{s.serialNumber || s.imei}</code></td>
                          <td><strong>{s.productName}</strong></td>
                          <td>
                            <span className={`status-pill ${s.status === 'IN_STOCK' ? 'optimal' : s.status === 'SOLD' ? '' : 'danger'}`}>
                              {s.status.replace('_', ' ')}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {serials.length === 0 && (
                        <tr><td colSpan={3} className="muted" style={{ textAlign: 'center' }}>No serial numbers registered yet.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </article>

            {/* WIDGET 5: Inter-Department Transfers & Storefloor Flow */}
            <article className="stock-system-card">
              <div>
                <div className="stock-system-header">
                  <div className="stock-system-title-group">
                    <div className="stock-system-icon-badge" aria-hidden="true">⇄</div>
                    <div>
                      <h2 className="stock-system-title">Transfers &amp; Department Flow</h2>
                      <span className="stock-system-page-tag">Page: /transfers &amp; /departments</span>
                    </div>
                  </div>
                  <Link to={`${basePath}/transfers`} className="btn btn-sm btn-outline">
                    Move Stock →
                  </Link>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <div className="subcard" style={{ padding: '0.6rem' }}>
                    <span className="muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase' }}>Transfers Posted</span>
                    <div style={{ fontSize: '1.2rem', fontWeight: 800 }}>{data?.transfersCount ?? requisitions.length}</div>
                  </div>
                  <div className="subcard" style={{ padding: '0.6rem' }}>
                    <span className="muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase' }}>Units Moved</span>
                    <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--accent-indigo)' }}>
                      {(data?.transfersUnits ?? 0).toLocaleString()}
                    </div>
                  </div>
                  <div className="subcard" style={{ padding: '0.6rem' }}>
                    <span className="muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase' }}>Store Zones</span>
                    <div style={{ fontSize: '1.2rem', fontWeight: 800 }}>{allZones.length}</div>
                  </div>
                </div>

                {/* Department Distribution Bars */}
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--charcoal)' }}>Top Department Stock Holdings</span>
                <div className="visual-bar-chart">
                  {deptZones.slice(0, 3).map((dz) => (
                    <div key={dz.key} className="visual-bar-row">
                      <span className="visual-bar-label" title={dz.name}>{dz.name}</span>
                      <div className="visual-bar-track">
                        <div
                          className="visual-bar-fill"
                          style={{
                            width: `${
                              totalValUsd > 0 ? Math.min(100, Math.max(5, Math.round((dz.totalValue / totalValUsd) * 100))) : 20
                            }%`,
                          }}
                        />
                      </div>
                      <span className="visual-bar-value">{formatMoney(dz.totalValue)}</span>
                    </div>
                  ))}
                  {deptZones.length === 0 && (
                    <span className="muted" style={{ fontSize: '0.78rem', fontStyle: 'italic' }}>No departments configured.</span>
                  )}
                </div>

                {/* Recent Transfers Activity */}
                <div className="table-wrap" style={{ marginTop: '0.6rem' }}>
                  <table className="data-table" style={{ fontSize: '0.8rem' }}>
                    <thead>
                      <tr>
                        <th>Transfer Ref</th>
                        <th>Destination</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {requisitions.slice(0, 3).map((r) => (
                        <tr key={r.id}>
                          <td><code>{r.reference || `REQ-#${r.id}`}</code></td>
                          <td><strong>{r.departmentName || r.toWarehouseName || 'Storefloor'}</strong></td>
                          <td>
                            <span className={`status-pill ${r.status === 'fulfilled' ? 'optimal' : 'warn'}`}>
                              {r.status.toUpperCase()}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {requisitions.length === 0 && (
                        <tr><td colSpan={3} className="muted" style={{ textAlign: 'center' }}>No inter-department transfers recorded.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </article>

            {/* WIDGET 6: Customer Balances & Stock Audits */}
            <article className="stock-system-card">
              <div>
                <div className="stock-system-header">
                  <div className="stock-system-title-group">
                    <div className="stock-system-icon-badge" aria-hidden="true">🤝</div>
                    <div>
                      <h2 className="stock-system-title">Lay-by, Chikwereti &amp; Stock Count</h2>
                      <span className="stock-system-page-tag">Page: /layby-and-change &amp; /count</span>
                    </div>
                  </div>
                  <Link to={`${basePath}/layby-and-change`} className="btn btn-sm btn-outline">
                    Open Balances →
                  </Link>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <div className="subcard" style={{ padding: '0.6rem' }}>
                    <span className="muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase' }}>Lay-by Held</span>
                    <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--charcoal)' }}>
                      {formatMoney(totalLaybyValue)}
                    </div>
                    <span className="muted" style={{ fontSize: '0.72rem' }}>{pendingLaybys.length} reservations</span>
                  </div>
                  <div className="subcard" style={{ padding: '0.6rem' }}>
                    <span className="muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase' }}>Chikwereti Debt</span>
                    <div style={{ fontSize: '1.2rem', fontWeight: 800, color: totalDebtorBalance > 0 ? 'var(--warning)' : 'var(--emerald)' }}>
                      {formatMoney(totalDebtorBalance)}
                    </div>
                    <span className="muted" style={{ fontSize: '0.72rem' }}>{activeDebtors.length} debtors</span>
                  </div>
                  <div className="subcard" style={{ padding: '0.6rem' }}>
                    <span className="muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase' }}>Till Change Owed</span>
                    <div style={{ fontSize: '1.2rem', fontWeight: 800 }}>
                      {formatMoney(totalVoucherLiability)}
                    </div>
                    <span className="muted" style={{ fontSize: '0.72rem' }}>{unredeemedVouchers.length} slips</span>
                  </div>
                </div>

                {/* Stocktaking Audits Indicator */}
                <div style={{ background: 'var(--surface-alt)', padding: '0.6rem', borderRadius: '8px', border: '1px solid var(--line)', marginBottom: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.78rem', fontWeight: 700 }}>📋 Physical Stock Count &amp; Audits</span>
                    <Link to={`${basePath}/count`} style={{ fontSize: '0.76rem', fontWeight: 700 }}>
                      Perform Count →
                    </Link>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: '0.2rem' }}>
                    {countSheets.length} Count Sheets logged · {countSheets.filter((c) => c.status === 'draft').length} Drafts pending manager approval
                  </div>
                </div>

                {/* Mini Customer Balance Table */}
                <div className="table-wrap" style={{ marginTop: '0.4rem' }}>
                  <table className="data-table" style={{ fontSize: '0.8rem' }}>
                    <thead>
                      <tr>
                        <th>Customer / Entity</th>
                        <th>Type</th>
                        <th className="num">Balance / Units</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingLaybys.slice(0, 2).map((l) => (
                        <tr key={`layby-${l.id}`}>
                          <td><strong>{l.customerName}</strong></td>
                          <td><span className="status-pill optimal">Lay-by</span></td>
                          <td className="num">{l.remainingQty} {l.unit} ({formatMoney(l.totalPaid)})</td>
                          <td><span className="status-pill warn">Awaiting Pickup</span></td>
                        </tr>
                      ))}
                      {activeDebtors.slice(0, 2).map((d) => (
                        <tr key={`debtor-${d.id}`}>
                          <td><strong>{d.customerName}</strong></td>
                          <td><span className="status-pill warn">Chikwereti</span></td>
                          <td className="num" style={{ fontWeight: 700, color: 'var(--danger)' }}>{formatMoney(d.balance)}</td>
                          <td>
                            <span className={`status-pill ${d.status === 'OVERDUE' ? 'danger' : 'warn'}`}>
                              {d.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {pendingLaybys.length === 0 && activeDebtors.length === 0 && (
                        <tr><td colSpan={4} className="muted" style={{ textAlign: 'center' }}>No outstanding customer lay-bys or debts.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </article>
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 2: VISUAL CHARTS & STORE ARCHITECTURAL MAP
          ========================================================================= */}
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
                  <Link to={`${basePath}/departments`} className="btn btn-primary btn-sm">
                    + Configure Departments
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
                                to="/pos"
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
                      <Link to="/pos" className="btn btn-primary btn-sm">
                        🛒 Open POS Counter
                      </Link>
                    )}
                    <Link to={`${basePath}/products?dept=${activeZone.id}`} className="btn btn-outline btn-sm">
                      + Add Products to Zone
                    </Link>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setSelectedZone(null)}>
                      ✕ Close
                    </button>
                  </div>
                </div>

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
                          <td className="num"><strong>{p.stock}</strong> <small>{p.unit}</small></td>
                          <td className="num">{formatMoney(p.unitCost)}</td>
                          <td className="num">{p.sellingPrice ? formatMoney(p.sellingPrice) : '—'}</td>
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
                <Link to={`${basePath}/departments`}>Open Departments →</Link>
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

      {/* =========================================================================
          TAB 3: PRODUCT CATALOG & CATEGORIES DEEP DIVE
          ========================================================================= */}
      {activeSubTab === 'products_catalog' && (
        <div id="dashboard-panel-products" role="tabpanel" aria-labelledby="dashboard-tab-products_catalog">
          <div className="card" style={{ marginBottom: '1.25rem' }}>
            <div className="section-head">
              <div>
                <h2>Product Categories &amp; Inventory Valuation ({currency})</h2>
                <span className="vernacular-sub">
                  {subLabel('Mhando dzeZvinhu neHukoshi', 'Izinhlobo Zempahla Lenani Layol')}
                </span>
              </div>
              <Link to={`${basePath}/products`} className="btn btn-primary btn-sm">
                + Add / Manage Products
              </Link>
            </div>

            <div className="visual-bar-chart" style={{ margin: '1rem 0' }}>
              {categoryStats.map((cat) => (
                <div key={cat.id} className="visual-bar-row">
                  <span className="visual-bar-label" title={cat.name} style={{ width: '180px' }}>
                    {cat.name} ({cat.skuCount} SKUs)
                  </span>
                  <div className="visual-bar-track" style={{ height: '14px' }}>
                    <div className="visual-bar-fill" style={{ width: `${Math.max(4, cat.pctOfTotalVal)}%` }} />
                  </div>
                  <span className="visual-bar-value" style={{ width: '130px' }}>
                    {formatMoney(cat.valuation)} ({cat.pctOfTotalVal}%)
                  </span>
                </div>
              ))}
            </div>

            <div className="table-wrap" style={{ marginTop: '1.5rem' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Category Name</th>
                    <th>Code</th>
                    <th className="num">SKU Count</th>
                    <th className="num">Total Units</th>
                    <th className="num">Valuation ({currency})</th>
                    <th className="num">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {categoryStats.map((cat) => (
                    <tr key={cat.id}>
                      <td><strong>{cat.name}</strong></td>
                      <td><code>{cat.code || '—'}</code></td>
                      <td className="num">{cat.skuCount}</td>
                      <td className="num">{cat.totalUnits.toLocaleString()}</td>
                      <td className="num" style={{ fontWeight: 700, color: 'var(--emerald)' }}>
                        {formatMoney(cat.valuation)}
                      </td>
                      <td className="num">
                        <Link to={`${basePath}/products?category=${cat.id}`} className="btn btn-sm btn-outline">
                          Filter SKUs →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 4: STOCK INTAKE & BATCHES (FEFO) DEEP DIVE
          ========================================================================= */}
      {activeSubTab === 'intake_batches' && (
        <div id="dashboard-panel-intake" role="tabpanel" aria-labelledby="dashboard-tab-intake_batches">
          <div className="card" style={{ marginBottom: '1.25rem' }}>
            <div className="section-head">
              <div>
                <h2>Perishable Batches &amp; FEFO Expiry Risk Tracker</h2>
                <span className="vernacular-sub">
                  {subLabel('Mazuva eKupera kweZvinhu', 'Izinsuku Zokuphela Kwempahla', 'First-Expiry First-Out')}
                </span>
              </div>
              <Link to={`${basePath}/intake`} className="btn btn-primary btn-sm">
                + Receive Batch Stock
              </Link>
            </div>

            {/* Visual FEFO Meter */}
            <div style={{ marginBottom: '1rem' }}>
              <div className="visual-meter-bar" style={{ height: '16px' }}>
                <div className="visual-meter-segment red" style={{ width: `${expiredPct}%` }} />
                <div className="visual-meter-segment orange" style={{ width: `${criticalPct}%` }} />
                <div className="visual-meter-segment gold" style={{ width: `${nearPct}%` }} />
                <div className="visual-meter-segment green" style={{ width: `${goodPct}%` }} />
              </div>
              <div className="visual-meter-legend">
                <span className="visual-meter-legend-item">
                  <span className="visual-legend-dot" style={{ background: '#ef4444' }} />
                  <strong>Expired ({expiredBatches.length})</strong>
                </span>
                <span className="visual-meter-legend-item">
                  <span className="visual-legend-dot" style={{ background: '#f97316' }} />
                  <strong>Critical ≤30 Days ({criticalBatches.length})</strong>
                </span>
                <span className="visual-meter-legend-item">
                  <span className="visual-legend-dot" style={{ background: '#f59e0b' }} />
                  <strong>Expiring in 31-90 Days ({nearBatches.length})</strong>
                </span>
                <span className="visual-meter-legend-item">
                  <span className="visual-legend-dot" style={{ background: '#10b981' }} />
                  <strong>Fresh &gt;90 Days ({goodBatches.length})</strong>
                </span>
              </div>
            </div>

            {batches.length > 0 ? (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Batch Number</th>
                      <th>Product</th>
                      <th>Warehouse</th>
                      <th className="num">In Stock</th>
                      <th>Expiry Date</th>
                      <th>Days Remaining</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map((b, i) => (
                      <tr key={`${b.productId}-${b.batchNumber}-${i}`}>
                        <td><code>{b.batchNumber || 'N/A'}</code></td>
                        <td><strong>{b.productName}</strong></td>
                        <td>{b.warehouseName}</td>
                        <td className="num"><strong>{b.inStockQty}</strong> <small>{b.unit}</small></td>
                        <td>{b.expiryDate}</td>
                        <td>
                          {b.daysRemaining <= 0 ? (
                            <span className="status-pill danger">EXPIRED ({Math.abs(b.daysRemaining)}d ago)</span>
                          ) : b.daysRemaining <= 30 ? (
                            <span className="status-pill warn">⚠️ {b.daysRemaining} days left</span>
                          ) : (
                            <span className="status-pill optimal">✓ {b.daysRemaining} days</span>
                          )}
                        </td>
                        <td>
                          <span className={`status-pill ${b.status === 'EXPIRED' ? 'danger' : b.status === 'EXPIRING_SOON' ? 'warn' : 'optimal'}`}>
                            {b.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state-box">No expiring batch items tracked in this storeroom yet.</div>
            )}
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 5: SERIAL NUMBER REGISTRY & STOCK AUDITS
          ========================================================================= */}
      {activeSubTab === 'serials_audits' && (
        <div id="dashboard-panel-serials" role="tabpanel" aria-labelledby="dashboard-tab-serials_audits">
          <div className="card" style={{ marginBottom: '1.25rem' }}>
            <div className="section-head">
              <div>
                <h2>Serial Number &amp; IMEI Hardware Registry ({serials.length})</h2>
                <span className="vernacular-sub">
                  {subLabel('Kunyoreswa kweNhamba dzeMichina', 'Ukubhaliswa Kwezinombolo Zempahla')}
                </span>
              </div>
              <Link to={`${basePath}/intake`} className="btn btn-primary btn-sm">
                + Register New Hardware
              </Link>
            </div>

            {serials.length > 0 ? (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Serial / IMEI</th>
                      <th>Product</th>
                      <th>Storeroom / Department</th>
                      <th>Batch</th>
                      <th>Status</th>
                      <th>Registered</th>
                    </tr>
                  </thead>
                  <tbody>
                    {serials.map((s) => (
                      <tr key={s.id}>
                        <td><code>{s.serialNumber || s.imei}</code></td>
                        <td><strong>{s.productName}</strong></td>
                        <td>{s.warehouseName}</td>
                        <td><code>{s.batchNumber || '—'}</code></td>
                        <td>
                          <span className={`status-pill ${s.status === 'IN_STOCK' ? 'optimal' : s.status === 'SOLD' ? '' : 'danger'}`}>
                            {s.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="muted" style={{ fontSize: '0.78rem' }}>
                          {s.createdAt ? s.createdAt.slice(0, 10) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state-box">No serial numbers registered yet. Enter serialized goods via Stock Intake.</div>
            )}
          </div>

          {/* Physical Count Sheets & Variance Audits */}
          <div className="card">
            <div className="section-head">
              <div>
                <h2>Physical Stock Count Sheets &amp; Variance Audits ({countSheets.length})</h2>
                <span className="vernacular-sub">
                  {subLabel('Gwaro reKuverenga Zvinhu', 'Ukubalwa Kwempahla Esitolo')}
                </span>
              </div>
              <Link to={`${basePath}/count`} className="btn btn-primary btn-sm">
                + Start Stock Count
              </Link>
            </div>

            {countSheets.length > 0 ? (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Sheet Ref</th>
                      <th>Warehouse / Zone</th>
                      <th className="num">Lines Counted</th>
                      <th>Status</th>
                      <th>Date</th>
                      <th className="num">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {countSheets.map((c) => (
                      <tr key={c.id}>
                        <td><code>{c.reference || `COUNT-#${c.id}`}</code></td>
                        <td><strong>{c.warehouseName}</strong></td>
                        <td className="num">{c.lineCount}</td>
                        <td>
                          <span className={`status-pill ${c.status === 'approved' ? 'optimal' : c.status === 'draft' ? 'warn' : ''}`}>
                            {c.status.toUpperCase()}
                          </span>
                        </td>
                        <td>{c.createdAt ? c.createdAt.slice(0, 10) : '—'}</td>
                        <td className="num">
                          <Link to={`${basePath}/count`} className="btn btn-outline btn-sm">
                            Inspect Audit →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state-box">No physical stock count audits recorded yet.</div>
            )}
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 6: LAY-BY, CHIKWERETI & CUSTOMER BALANCES
          ========================================================================= */}
      {activeSubTab === 'layby_credit' && (
        <div id="dashboard-panel-layby" role="tabpanel" aria-labelledby="dashboard-tab-layby_credit">
          {/* Section 1: Paid & Uncollected (Lay-by) */}
          <div className="card" style={{ marginBottom: '1.25rem' }}>
            <div className="section-head">
              <div>
                <h2>Paid &amp; Uncollected Stock (Lay-by) Reservations</h2>
                <span className="vernacular-sub">
                  {subLabel('Zvinhu Zvakabhadharwa Zvichakamirira Kutakurwa', 'Impahla Ebhadelweyo Elindele Ukuthathwa')}
                </span>
              </div>
              <Link to={`${basePath}/layby-and-change`} className="btn btn-primary btn-sm">
                + New Lay-by
              </Link>
            </div>

            {pendingLaybys.length > 0 ? (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Customer Name</th>
                      <th>Phone</th>
                      <th>Product</th>
                      <th className="num">Remaining Qty</th>
                      <th className="num">Total Paid</th>
                      <th>Status</th>
                      <th className="num">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingLaybys.map((l) => (
                      <tr key={l.id}>
                        <td><strong>{l.customerName}</strong></td>
                        <td>{l.customerPhone}</td>
                        <td>{l.productName}</td>
                        <td className="num"><strong>{l.remainingQty}</strong> <small>{l.unit}</small></td>
                        <td className="num" style={{ color: 'var(--emerald)', fontWeight: 700 }}>
                          {formatMoney(l.totalPaid)}
                        </td>
                        <td><span className="status-pill warn">Awaiting Collection</span></td>
                        <td className="num">
                          <Link to={`${basePath}/layby-and-change`} className="btn btn-sm btn-primary">
                            Dispatch / Collect →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state-box">No pending lay-by reservations at this time.</div>
            )}
          </div>

          {/* Section 2: Chikwereti (Customer Credit & Debt) */}
          <div className="card" style={{ marginBottom: '1.25rem' }}>
            <div className="section-head">
              <div>
                <h2>Customer Credit &amp; Debt Ledger (Chikwereti)</h2>
                <span className="vernacular-sub">
                  {subLabel('Magwaro eChikwereti cheVatengi', 'Izikwelede Zabathengi')}
                </span>
              </div>
              <Link to={`${basePath}/layby-and-change`} className="btn btn-primary btn-sm">
                + Record Credit
              </Link>
            </div>

            {activeDebtors.length > 0 ? (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Phone</th>
                      <th>Department</th>
                      <th className="num">Debt Balance</th>
                      <th>Due Date</th>
                      <th>Status</th>
                      <th className="num">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeDebtors.map((d) => (
                      <tr key={d.id}>
                        <td><strong>{d.customerName}</strong></td>
                        <td>{d.phone}</td>
                        <td>{d.departmentName}</td>
                        <td className="num" style={{ fontWeight: 800, color: 'var(--danger)' }}>
                          {formatMoney(d.balance)}
                        </td>
                        <td>{d.dueDate}</td>
                        <td>
                          <span className={`status-pill ${d.status === 'OVERDUE' ? 'danger' : 'warn'}`}>
                            {d.status}
                          </span>
                        </td>
                        <td className="num">
                          <Link to={`${basePath}/layby-and-change`} className="btn btn-sm btn-outline">
                            Repay Debt →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state-box">All customer credit accounts are clear!</div>
            )}
          </div>

          {/* Section 3: Till Change Vouchers */}
          <div className="card">
            <div className="section-head">
              <div>
                <h2>Customer Till Change Slips &amp; Liability</h2>
                <span className="vernacular-sub">
                  {subLabel('Mari yeChange Yakatadza Kubuda paTill', 'Isikwelede Sentshintshi')}
                </span>
              </div>
              <Link to={`${basePath}/layby-and-change`} className="btn btn-primary btn-sm">
                + Issue Change Voucher
              </Link>
            </div>

            {unredeemedVouchers.length > 0 ? (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Voucher Code</th>
                      <th>Customer</th>
                      <th>Department</th>
                      <th className="num">Liability (USD)</th>
                      <th>Status</th>
                      <th>Issued Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unredeemedVouchers.map((v) => (
                      <tr key={v.id}>
                        <td><code>{v.voucherCode}</code></td>
                        <td><strong>{v.customerName || 'Anonymous'}</strong></td>
                        <td>{v.departmentName}</td>
                        <td className="num" style={{ fontWeight: 700, color: 'var(--warning)' }}>
                          {formatMoney(v.amountUsd)}
                        </td>
                        <td><span className="status-pill warn">UNREDEEMED</span></td>
                        <td>{v.createdAt ? v.createdAt.slice(0, 10) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state-box">No unredeemed change slips. Till change balance is completely reconciled.</div>
            )}
          </div>
        </div>
      )}

      {/* WHATSAPP MODAL */}
      {whatsappOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="whatsapp-modal-title">
          <div className="modal-card">
            <div className="modal-header-row">
              <h3 id="whatsapp-modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <WhatsAppIcon size={20} /> WhatsApp Comprehensive Stock Report
              </h3>
              <button type="button" className="btn-icon-close" aria-label="Close" onClick={() => setWhatsappOpen(false)}>
                ✕
              </button>
            </div>
            <p className="muted" style={{ fontSize: '0.84rem' }}>
              Synthesized report across catalog, intake, batches, transfers, and customer balances ready to share on WhatsApp:
            </p>
            <textarea
              readOnly
              rows={11}
              value={whatsappText}
              style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.82rem', marginBottom: '0.9rem' }}
            />
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  navigator.clipboard?.writeText(whatsappText).catch(() => {});
                  setFlashMsg('Stock summary copied to clipboard!');
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
