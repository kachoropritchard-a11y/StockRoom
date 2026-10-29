import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type InventoryReports, type ProductItem } from '../api';
import { portalPath, useAuth } from '../auth';
import { AccessibleTabs, type TabDefinition } from '../components/AccessibleTabs';
import { Spinner } from '../components/Spinner';
import { useZim } from '../zimContext';
import { formatBulkStock, formatBulkReorder } from '../bulkStock';

type ReportSubTab = 'restock' | 'valuation' | 'sold' | 'writeoffs';
type RestockFilter = 'all' | 'reorder' | 'out' | 'healthy';

export function Reports() {
  const { user } = useAuth();
  const { formatMoney, subLabel, rates, fdms } = useZim();
  const base = user ? portalPath(user.role) : '/inventory';

  const [activeTab, setActiveTab] = useState<ReportSubTab>('restock');
  const [period, setPeriod] = useState<'today' | 'week' | 'month' | 'all'>('all');
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);
  const [selectedDeptId, setSelectedDeptId] = useState<number | 'all'>('all');
  const [products, setProducts] = useState<ProductItem[]>([]);

  const [reports, setReports] = useState<InventoryReports | null>(null);
  const [exportSection, setExportSection] = useState<'goods_restock' | 'stock_sold' | 'stock_write_offs' | 'valuation' | 'low_stock' | 'movements' | 'audit_logs'>('goods_restock');
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  // Sub-filters for Tab 1 (Restock Levels)
  const [restockFilter, setRestockFilter] = useState<RestockFilter>('all');
  const [restockSearch, setRestockSearch] = useState('');

  // Sub-filters for Tab 3 (Stock Sold)
  const [soldSearch, setSoldSearch] = useState('');

  // Sub-filters for Tab 4 (Write-offs)
  const [writeOffReasonFilter, setWriteOffReasonFilter] = useState<string>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [repRes, deptRes, prodRes] = await Promise.all([
        api.inventoryReports({
          period,
          departmentId: selectedDeptId === 'all' ? undefined : selectedDeptId,
        }),
        api.departments().catch(() => []),
        api.products('', { limit: 200 }).catch(() => ({ items: [] as ProductItem[] })),
      ]);
      setReports(repRes);
      setDepartments(deptRes);
      setProducts(prodRes.items);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [period, selectedDeptId]);

  useEffect(() => {
    load();
    const onSync = () => load();
    window.addEventListener('stockroom:sync', onSync);
    return () => window.removeEventListener('stockroom:sync', onSync);
  }, [load]);

  async function handleAuthorisedExport(format: 'csv' | 'json') {
    setError('');
    setMsg('');
    try {
      const params = new URLSearchParams({
        section: exportSection,
        format,
        period,
      });
      if (selectedDeptId !== 'all') {
        params.set('departmentId', String(selectedDeptId));
      }
      const res = await fetch(`/api/reports/export?${params.toString()}`, {
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'stockroom' },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? 'export_failed');
      }
      const text = await res.text();
      const blob = new Blob([text], {
        type: format === 'csv' ? 'text/csv;charset=utf-8;' : 'application/json;charset=utf-8;',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `stockroom-${exportSection}-${selectedDeptId === 'all' ? 'whole-system' : `dept-${selectedDeptId}`}-${new Date().toISOString().slice(0, 10)}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg(`Authorised ${exportSection.replace(/_/g, ' ')} ${format.toUpperCase()} export downloaded and recorded in audit log.`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (loading && !reports) return <Spinner label="Generating inventory reports" />;

  const totalValuation = (reports?.valuationByCategory ?? []).reduce((acc, c) => acc + c.totalValue, 0);
  const ownerSummary = reports?.ownerSummary;

  // Separate categories into ZIMRA 15% Standard-Rated vs 0% Zero-Rated / Exempt basic staples
  const categoriesWithTax = (reports?.valuationByCategory ?? []).map((c) => {
    const lower = c.categoryName.toLowerCase();
    const isZeroRated =
      lower.includes('grain') ||
      lower.includes('maize') ||
      lower.includes('meal') ||
      lower.includes('agro') ||
      lower.includes('med') ||
      lower.includes('milk');
    const vatRate = isZeroRated ? 0 : fdms.standardVatPct;
    const estOutputVatUsd = isZeroRated ? 0 : c.totalValue * (vatRate / 100);
    return {
      ...c,
      taxClass: isZeroRated ? '0% Zero-Rated / Exempt Staple' : `${vatRate}% Standard-Rated (VAT)`,
      vatRate,
      estOutputVatUsd,
    };
  });

  // 1. Restock evaluation dataset fallback
  const rawRestockList = reports?.allRestockLevels && reports.allRestockLevels.length > 0
    ? reports.allRestockLevels
    : (reports?.lowStockAlerts ?? []).map((a) => ({
        productId: a.productId,
        sku: a.sku,
        productName: a.productName,
        categoryName: a.categoryName,
        departmentId: null,
        departmentName: a.departmentName ?? 'General Store',
        unit: a.unit,
        currentStock: a.currentStock,
        reorderLevel: a.reorderLevel,
        shortfall: a.shortfall,
        unitCost: a.unitCost,
        sellingPrice: a.unitCost * 1.3,
        estimatedRestockCost: a.estimatedRestockCost,
        restockStatus: (a.currentStock <= 0 ? 'out_of_stock' : 'reorder_needed') as 'out_of_stock' | 'reorder_needed' | 'healthy',
      }));

  const filteredRestockList = rawRestockList.filter((item) => {
    if (restockFilter === 'reorder' && item.restockStatus !== 'reorder_needed' && item.restockStatus !== 'out_of_stock') return false;
    if (restockFilter === 'out' && item.restockStatus !== 'out_of_stock') return false;
    if (restockFilter === 'healthy' && item.restockStatus !== 'healthy') return false;
    if (restockSearch.trim()) {
      const q = restockSearch.toLowerCase();
      return item.productName.toLowerCase().includes(q) || item.sku.toLowerCase().includes(q) || item.departmentName.toLowerCase().includes(q);
    }
    return true;
  });

  const restockOutOfStockCount = rawRestockList.filter((i) => i.restockStatus === 'out_of_stock').length;
  const restockNeededCount = rawRestockList.filter((i) => i.restockStatus === 'reorder_needed' || i.restockStatus === 'out_of_stock').length;
  const restockTotalCostRequired = rawRestockList.reduce((acc, i) => acc + (i.shortfall > 0 ? i.shortfall * i.unitCost : 0), 0);

  // 2. Sold items dataset fallback
  const rawSoldItems = reports?.soldStockSummary?.items && reports.soldStockSummary.items.length > 0
    ? reports.soldStockSummary.items
    : (ownerSummary?.productStockFlow ?? [])
        .filter((p) => p.soldUnits > 0)
        .map((p) => ({
          productId: p.productId,
          sku: p.sku,
          productName: p.productName,
          departmentId: p.departmentId,
          departmentName: p.departmentName,
          categoryName: p.categoryName,
          unit: p.unit,
          soldUnits: p.soldUnits,
          avgSellingPrice: p.sellingPrice,
          unitCost: p.unitCost,
          revenue: p.revenue,
          cogs: p.cogs,
          grossProfit: p.grossProfit,
          grossMarginPct: p.revenue > 0 ? Math.round(((p.revenue - p.cogs) / p.revenue) * 1000) / 10 : 0,
        }));

  const filteredSoldItems = rawSoldItems.filter((item) => {
    if (!soldSearch.trim()) return true;
    const q = soldSearch.toLowerCase();
    return item.productName.toLowerCase().includes(q) || item.sku.toLowerCase().includes(q) || item.departmentName.toLowerCase().includes(q);
  });

  const totalSoldUnitsAgg = filteredSoldItems.reduce((acc, i) => acc + i.soldUnits, 0);
  const totalRevenueAgg = filteredSoldItems.reduce((acc, i) => acc + i.revenue, 0);
  const totalCogsAgg = filteredSoldItems.reduce((acc, i) => acc + i.cogs, 0);
  const totalGrossProfitAgg = totalRevenueAgg - totalCogsAgg;

  // 3. Write-off dataset fallback
  const rawWriteOffLog = reports?.writeOffSummary?.log ?? [];
  const writeOffReasons = reports?.writeOffSummary?.byReason ?? [];
  const filteredWriteOffLog = rawWriteOffLog.filter((w) => {
    if (writeOffReasonFilter === 'all') return true;
    return w.reason === writeOffReasonFilter;
  });

  const totalWriteOffUnitsAgg = filteredWriteOffLog.reduce((acc, w) => acc + w.quantity, 0);
  const totalWriteOffLossAgg = filteredWriteOffLog.reduce((acc, w) => acc + w.totalLossValue, 0);

  const tabs: TabDefinition<ReportSubTab>[] = [
    {
      key: 'restock',
      label: '1. Goods Restock Levels & Low Stock Alerts',
      badge: restockNeededCount,
      purpose: 'Check product restock thresholds, current stock on hand, shortfalls, and estimated restocking capital.',
    },
    {
      key: 'valuation',
      label: '2. Multi-Currency Valuation & ZIMRA Schedule',
      purpose: 'Stock valuation by category and warehouse converted across USD $, ZiG, and ZAR + ZIMRA 15% VAT schedules.',
    },
    {
      key: 'sold',
      label: '3. Stock Sold Off for Period',
      badge: rawSoldItems.length,
      purpose: 'Review stock units sold, selling prices, sales revenue, cost of goods (COGS), and profit margins by item and department.',
    },
    {
      key: 'writeoffs',
      label: '4. Non-Selling Write-Offs & Shrinkage',
      badge: rawWriteOffLog.length,
      purpose: 'Audit stock written off due to non-selling reasons: power cut spoilage, breakage, shelf expiry, damage, and pilferage.',
    },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Low-Stock Alerts &amp; Inventory Reports</h1>
          <span className="vernacular-sub">
            {subLabel(
              'Magwaro eZIMRA FDMS (15% VAT) • Hukoshi muUSD, ZiG neZAR • Zvakatengwa, Zvakatengeswa nePurofiti',
              'Imibiko yeZIMRA FDMS (15% VAT) • Inani Lempahla • Okuthengiweyo, Okuthengisiweyo leNzuzo',
            )}
          </span>
        </div>
        <div className="quick-actions">
          <button type="button" className="btn btn-outline" onClick={() => window.print()} title="Print formal executive report">
            🖨️ Formal Printout
          </button>
          <select
            aria-label="Export dataset"
            value={exportSection}
            onChange={(e) => setExportSection(e.target.value as typeof exportSection)}
          >
            <option value="goods_restock">Goods Restock Levels Dataset</option>
            <option value="stock_sold">Stock Sold Off for Period</option>
            <option value="stock_write_offs">Non-Selling Write-Offs &amp; Shrinkage</option>
            <option value="valuation">Stock Valuation Dataset</option>
            <option value="low_stock">Low-Stock Alerts Dataset</option>
            <option value="movements">Stock Movements Ledger</option>
            {user?.role === 'executive_manager' && <option value="audit_logs">Executive Audit Logs</option>}
          </select>
          <button type="button" className="btn btn-outline" onClick={() => handleAuthorisedExport('csv')}>
            ⬇ Export Professional CSV
          </button>
          <button type="button" className="btn btn-outline" onClick={() => handleAuthorisedExport('json')}>
            ⬇ Export JSON
          </button>
          <button type="button" className="btn btn-primary" onClick={load}>
            ↻ Refresh Reports
          </button>
        </div>
      </div>

      {/* Global Report Filters Bar: Department Scope & Time Period */}
      <section className="card" style={{ marginBottom: '1.25rem', padding: '0.85rem 1.25rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
          {/* Department Filter (Per Department & Whole System) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--muted)' }}>
              🏢 Department Report Scope:
            </span>
            <select
              style={{ minWidth: '220px', padding: '0.45rem 0.75rem', fontWeight: 600 }}
              value={selectedDeptId}
              onChange={(e) => setSelectedDeptId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            >
              <option value="all">🏢 All Departments (Whole System)</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  🏷️ {d.name}
                </option>
              ))}
            </select>
            {selectedDeptId !== 'all' && (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setSelectedDeptId('all')}
                title="Reset to whole system view"
              >
                Reset to Whole System
              </button>
            )}
          </div>

          {/* Time Period Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--muted)' }}>
              📅 Time Period:
            </span>
            <div className="topbar-seg-group" role="group" aria-label="Time period filter">
              {(['today', 'week', 'month', 'all'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`topbar-seg-btn ${period === p ? 'active' : ''}`}
                  onClick={() => setPeriod(p)}
                >
                  {p === 'today' ? 'Today' : p === 'week' ? 'Last 7 Days' : p === 'month' ? 'Last 30 Days' : 'All Time'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {error && <p className="form-error" role="alert">{error}</p>}
      {msg && <p className="form-success" role="status">{msg}</p>}

      <section className="card">
        {/* TIER 3: Horizontal In-Page Sub-Menu Bar */}
        <AccessibleTabs
          idPrefix="reports"
          ariaLabel="Inventory report sections"
          tabs={tabs}
          active={activeTab}
          onChange={setActiveTab}
        />

        {/* SUB-MENU 1: Goods Restock Levels & Low Stock Alerts */}
        {activeTab === 'restock' && (
          <div id="reports-panel-restock" role="tabpanel" aria-labelledby="reports-tab-restock">
            <div className="ops-kpi-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: '1.25rem' }}>
              <div className="kpi-card">
                <span className="kpi-label">Catalog SKUs Assessed</span>
                <strong className="kpi-value">{rawRestockList.length}</strong>
                <span className="kpi-hint">
                  {selectedDeptId === 'all' ? 'All shop departments' : 'Active department SKUs'}
                </span>
              </div>
              <div className="kpi-card">
                <span className="kpi-label">Out of Stock (Zero Stock)</span>
                <strong className="kpi-value neg" style={{ color: 'var(--danger)' }}>
                  {restockOutOfStockCount}
                </strong>
                <span className="kpi-hint">Requires immediate reorder</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-label">Below Reorder Threshold</span>
                <strong className="kpi-value" style={{ color: 'var(--zim-gold-500)' }}>
                  {restockNeededCount}
                </strong>
                <span className="kpi-hint">Approaching critical depletion</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-label">Est. Restock Capital Required</span>
                <strong className="kpi-value">{formatMoney(restockTotalCostRequired)}</strong>
                <span className="kpi-hint">
                  ZiG: {formatMoney(restockTotalCostRequired, 'ZiG')} · ZAR: {formatMoney(restockTotalCostRequired, 'ZAR')}
                </span>
              </div>
            </div>

            {/* Restock Status Filters & Search Bar */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className={`btn btn-sm ${restockFilter === 'all' ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setRestockFilter('all')}
                >
                  All Goods ({rawRestockList.length})
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${restockFilter === 'reorder' ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setRestockFilter('reorder')}
                >
                  ⚠️ Needs Restock ({restockNeededCount})
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${restockFilter === 'out' ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setRestockFilter('out')}
                >
                  ⛔ Out of Stock ({restockOutOfStockCount})
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${restockFilter === 'healthy' ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setRestockFilter('healthy')}
                >
                  ✅ Adequate Stock ({rawRestockList.filter((i) => i.restockStatus === 'healthy').length})
                </button>
              </div>
              <div style={{ minWidth: '240px' }}>
                <input
                  type="text"
                  placeholder="🔍 Search product or SKU..."
                  value={restockSearch}
                  onChange={(e) => setRestockSearch(e.target.value)}
                  style={{ width: '100%', padding: '0.4rem 0.75rem' }}
                />
              </div>
            </div>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Product Name</th>
                    <th>Department</th>
                    <th>Current Stock vs Reorder Level</th>
                    <th className="num">Shortfall</th>
                    <th className="num">Unit Cost</th>
                    <th className="num">Est. Restock Cost</th>
                    <th>Restock Status</th>
                    <th className="num">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRestockList.map((item) => {
                    const prod = products.find((p) => p.id === item.productId || p.sku === item.sku);
                    const maxVal = Math.max(1, item.reorderLevel, item.currentStock);
                    const pct = Math.min(100, Math.round((item.currentStock / maxVal) * 100));
                    return (
                      <tr key={item.productId}>
                        <td><code>{item.sku}</code></td>
                        <td><strong>{item.productName}</strong></td>
                        <td>{item.departmentName}</td>
                        <td style={{ minWidth: '170px' }}>
                          <div className="stock-level-cell">
                            <div className="stock-bar-track">
                              <div
                                className={`stock-bar-fill ${item.currentStock <= 0 ? 'out' : item.restockStatus === 'reorder_needed' ? 'low' : 'optimal'}`}
                                style={{ width: `${Math.max(6, pct)}%` }}
                              />
                            </div>
                            <span className={`stock-level-num ${item.currentStock <= 0 ? 'badge-danger-text' : ''}`}>
                              <strong>{formatBulkStock(item.currentStock, prod?.packagings, item.unit).shortText}</strong> ({item.currentStock} {item.unit})
                            </span>
                            <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: '2px' }}>
                              Reorder: <strong>{formatBulkReorder(item.reorderLevel, prod?.packagings, item.unit)}</strong>
                            </div>
                          </div>
                        </td>
                        <td className="num">
                          {item.shortfall > 0 ? (
                            <strong className="neg">+{formatBulkStock(item.shortfall, prod?.packagings, item.unit).text}</strong>
                          ) : (
                            <span className="muted">0</span>
                          )}
                        </td>
                        <td className="num">{formatMoney(item.unitCost)}</td>
                        <td className="num">
                          {item.estimatedRestockCost > 0 ? (
                            <strong>{formatMoney(item.estimatedRestockCost)}</strong>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td>
                          {item.restockStatus === 'out_of_stock' && (
                            <span className="status-pill out" style={{ fontWeight: 700 }}>
                              ⛔ Out of Stock
                            </span>
                          )}
                          {item.restockStatus === 'reorder_needed' && (
                            <span className="status-pill low" style={{ fontWeight: 700 }}>
                              ⚠️ Reorder Needed
                            </span>
                          )}
                          {item.restockStatus === 'healthy' && (
                            <span className="status-pill optimal">
                              ✓ Adequate Stock
                            </span>
                          )}
                        </td>
                        <td className="num">
                          <Link to={`${base}/procurement?productId=${item.productId}`} className="btn btn-primary btn-sm">
                            Restock via PO
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredRestockList.length === 0 && (
                    <tr>
                      <td colSpan={9} className="muted text-center" style={{ padding: '2rem' }}>
                        No products match the selected restock filter or search term.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* SUB-MENU 2: Multi-Currency Valuation & ZIMRA Schedule */}
        {activeTab === 'valuation' && (
          <div id="reports-panel-valuation" role="tabpanel" aria-labelledby="reports-tab-valuation">
            <div className="ops-kpi-row" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: '1.25rem' }}>
              <div className="kpi-card">
                <span className="kpi-label">Total Stock Value (USD $)</span>
                <strong className="kpi-value">{formatMoney(totalValuation, 'USD')}</strong>
                <span className="kpi-hint">Base Hard Currency Valuation</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-label">Total Stock Value (Zimbabwe Gold — ZiG)</span>
                <strong className="kpi-value">{formatMoney(totalValuation, 'ZiG')}</strong>
                <span className="kpi-hint">Rate: 1 USD = {rates.ZiG} ZiG</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-label">Total Stock Value (SA Rand — ZAR)</span>
                <strong className="kpi-value">{formatMoney(totalValuation, 'ZAR')}</strong>
                <span className="kpi-hint">Rate: 1 USD = R {rates.ZAR}</span>
              </div>
            </div>

            <div className="subcard" style={{ marginBottom: '1.25rem', borderLeft: '4px solid var(--emerald)' }}>
              <div className="section-head">
                <div>
                  <h3 style={{ margin: 0 }}>ZIMRA FDMS Fiscal Device &amp; 15% VAT Schedule</h3>
                  <span className="muted" style={{ fontSize: '0.82rem' }}>
                    TIN: <strong>{fdms.tinNumber}</strong> · VAT Reg: <strong>{fdms.vatNumber}</strong> · Device ID: <code>{fdms.deviceId}</code> · Fiscal Day #{fdms.fiscalDay} ({fdms.status})
                  </span>
                </div>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Product Category</th>
                      <th>ZIMRA VAT Classification</th>
                      <th className="num">SKUs</th>
                      <th className="num">Stock Cost (USD)</th>
                      <th className="num">Est. 15% Output VAT (USD)</th>
                      <th className="num">Est. 15% Output VAT (ZiG)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categoriesWithTax.map((c) => (
                      <tr key={c.categoryName}>
                        <td><strong>{c.categoryName}</strong></td>
                        <td>
                          <span className={`status-pill ${c.vatRate === 0 ? 'optimal' : 'low'}`}>
                            {c.taxClass}
                          </span>
                        </td>
                        <td className="num">{c.productCount}</td>
                        <td className="num">{formatMoney(c.totalValue, 'USD')}</td>
                        <td className="num">{formatMoney(c.estOutputVatUsd, 'USD')}</td>
                        <td className="num">{formatMoney(c.estOutputVatUsd, 'ZiG')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="dashboard-panels">
              <div className="subcard">
                <h3>Stock Valuation by Category</h3>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Category</th>
                        <th className="num">SKUs</th>
                        <th className="num">Total Units</th>
                        <th className="num">USD Value</th>
                        <th className="num">ZiG Value</th>
                        <th className="num">ZAR Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(reports?.valuationByCategory ?? []).map((c) => (
                        <tr key={c.categoryName}>
                          <td><strong>{c.categoryName}</strong></td>
                          <td className="num">{c.productCount}</td>
                          <td className="num">{c.totalQuantity.toLocaleString()}</td>
                          <td className="num"><strong>{formatMoney(c.totalValue, 'USD')}</strong></td>
                          <td className="num">{formatMoney(c.totalValue, 'ZiG')}</td>
                          <td className="num">{formatMoney(c.totalValue, 'ZAR')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="subcard">
                <h3>Stock Valuation by Warehouse</h3>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Warehouse</th>
                        <th>Branch</th>
                        <th className="num">Total Units</th>
                        <th className="num">USD Value</th>
                        <th className="num">ZiG Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(reports?.warehouseStockSummary ?? []).map((w) => (
                        <tr key={w.warehouseId}>
                          <td><strong>{w.warehouseName}</strong></td>
                          <td>{w.branchName}</td>
                          <td className="num">{w.totalQuantity.toLocaleString()}</td>
                          <td className="num"><strong>{formatMoney(w.totalValue, 'USD')}</strong></td>
                          <td className="num">{formatMoney(w.totalValue, 'ZiG')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SUB-MENU 3: Stock Sold Off for Period */}
        {activeTab === 'sold' && (
          <div id="reports-panel-sold" role="tabpanel" aria-labelledby="reports-tab-sold">
            <div className="ops-kpi-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: '1.25rem' }}>
              <div className="kpi-card">
                <span className="kpi-label">1. Units Sold Off</span>
                <strong className="kpi-value">{totalSoldUnitsAgg.toLocaleString()}</strong>
                <span className="kpi-hint">
                  Period: {period === 'today' ? 'Today' : period === 'week' ? 'Last 7 Days' : period === 'month' ? 'Last 30 Days' : 'All Time'}
                </span>
              </div>
              <div className="kpi-card">
                <span className="kpi-label">2. Total Sales Revenue</span>
                <strong className="kpi-value" style={{ color: 'var(--emerald)' }}>
                  {formatMoney(totalRevenueAgg)}
                </strong>
                <span className="kpi-hint">
                  ZiG: {formatMoney(totalRevenueAgg, 'ZiG')}
                </span>
              </div>
              <div className="kpi-card">
                <span className="kpi-label">3. Cost of Goods Sold (COGS)</span>
                <strong className="kpi-value">{formatMoney(totalCogsAgg)}</strong>
                <span className="kpi-hint">Wholesale replenishment cost</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-label">4. Gross Profit Earned</span>
                <strong className="kpi-value pos">{formatMoney(totalGrossProfitAgg)}</strong>
                <span className="kpi-hint">
                  Margin:{' '}
                  <strong>
                    {totalRevenueAgg > 0 ? `${Math.round(((totalRevenueAgg - totalCogsAgg) / totalRevenueAgg) * 1000) / 10}%` : '0%'}
                  </strong>
                </span>
              </div>
            </div>

            {/* Multi-Tender Breakdown */}
            {ownerSummary?.tenderBreakdown && (
              <div className="subcard" style={{ marginBottom: '1.25rem', borderLeft: '4px solid var(--zim-gold-500)' }}>
                <div className="section-head" style={{ marginBottom: '0.65rem' }}>
                  <h4 style={{ margin: 0 }}>Multi-Currency Tender Breakdown for Period</h4>
                  <span className="muted" style={{ fontSize: '0.8rem' }}>Reconciled sales by tender method</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
                  {Object.entries(ownerSummary.tenderBreakdown).map(([tender, val]) => (
                    <div
                      key={tender}
                      style={{
                        padding: '0.45rem 0.85rem',
                        background: 'var(--surface)',
                        border: '1px solid var(--line)',
                        borderRadius: '6px',
                        fontSize: '0.84rem',
                      }}
                    >
                      <span className="muted" style={{ marginRight: '0.4rem' }}>{tender.replace(/_/g, ' ')}:</span>
                      <strong>{formatMoney(val)}</strong>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Department Performance Split if viewing Whole System */}
            {selectedDeptId === 'all' && ownerSummary?.byDepartment && ownerSummary.byDepartment.length > 0 && (
              <div className="subcard" style={{ marginBottom: '1.25rem' }}>
                <h3>Department Performance Summary (Sales vs Cost)</h3>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Department</th>
                        <th className="num">Active SKUs</th>
                        <th className="num">Units Sold</th>
                        <th className="num">Sales Revenue</th>
                        <th className="num">Cost of Sales</th>
                        <th className="num">Gross Profit Earned</th>
                        <th className="num">Closing Stock at Hand</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ownerSummary.byDepartment.map((d) => (
                        <tr key={d.departmentName}>
                          <td><strong>{d.departmentName}</strong></td>
                          <td className="num">{d.skuCount}</td>
                          <td className="num"><strong>{d.soldUnits.toLocaleString()}</strong></td>
                          <td className="num" style={{ color: 'var(--emerald)' }}>
                            <strong>{formatMoney(d.revenue)}</strong>
                          </td>
                          <td className="num">{formatMoney(d.cogs)}</td>
                          <td className="num pos"><strong>{formatMoney(d.grossProfit)}</strong></td>
                          <td className="num">{formatMoney(d.stockAtHandCostValue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Itemized Sold Goods Table */}
            <div className="section-head" style={{ marginBottom: '0.75rem' }}>
              <div>
                <h3 style={{ margin: 0 }}>Itemized Stock Sold Off ({filteredSoldItems.length} SKUs)</h3>
                <span className="vernacular-sub" style={{ fontSize: '0.82rem' }}>
                  Quantities sold off, selling prices, revenues, and gross margins for the period.
                </span>
              </div>
              <div style={{ minWidth: '240px' }}>
                <input
                  type="text"
                  placeholder="🔍 Search sold item or SKU..."
                  value={soldSearch}
                  onChange={(e) => setSoldSearch(e.target.value)}
                  style={{ width: '100%', padding: '0.4rem 0.75rem' }}
                />
              </div>
            </div>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>SKU &amp; Product</th>
                    <th>Department</th>
                    <th className="num">Units Sold</th>
                    <th className="num">Avg Selling Price</th>
                    <th className="num">Unit Cost</th>
                    <th className="num">Total Sales Revenue</th>
                    <th className="num">Cost of Goods (COGS)</th>
                    <th className="num">Gross Profit</th>
                    <th className="num">Margin %</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSoldItems.map((item) => {
                    const prod = products.find((p) => p.id === item.productId || p.sku === item.sku);
                    return (
                      <tr key={item.productId}>
                        <td>
                          <strong>{item.productName}</strong> <code>({item.sku})</code>
                        </td>
                        <td>{item.departmentName}</td>
                        <td className="num">
                          <strong>{formatBulkStock(item.soldUnits, prod?.packagings, item.unit).text}</strong>
                        </td>
                      <td className="num">{formatMoney(item.avgSellingPrice)}</td>
                      <td className="num">{formatMoney(item.unitCost)}</td>
                      <td className="num" style={{ color: 'var(--emerald)' }}>
                        <strong>{formatMoney(item.revenue)}</strong>
                      </td>
                      <td className="num">{formatMoney(item.cogs)}</td>
                      <td className="num pos">
                        <strong>{formatMoney(item.grossProfit)}</strong>
                      </td>
                      <td className="num">
                        <span className={`status-pill ${item.grossMarginPct >= 20 ? 'optimal' : 'low'}`}>
                          {item.grossMarginPct}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
                  {filteredSoldItems.length === 0 && (
                    <tr>
                      <td colSpan={9} className="muted text-center" style={{ padding: '2rem' }}>
                        No stock sales recorded for the selected department and period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* SUB-MENU 4: Non-Selling Write-Offs & Shrinkage */}
        {activeTab === 'writeoffs' && (
          <div id="reports-panel-writeoffs" role="tabpanel" aria-labelledby="reports-tab-writeoffs">
            <div className="ops-kpi-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: '1.25rem' }}>
              <div className="kpi-card">
                <span className="kpi-label">Total Financial Loss (USD $)</span>
                <strong className="kpi-value neg" style={{ color: 'var(--danger)' }}>
                  {formatMoney(totalWriteOffLossAgg)}
                </strong>
                <span className="kpi-hint">
                  ZiG: {formatMoney(totalWriteOffLossAgg, 'ZiG')} · ZAR: {formatMoney(totalWriteOffLossAgg, 'ZAR')}
                </span>
              </div>
              <div className="kpi-card">
                <span className="kpi-label">Total Units Written Off</span>
                <strong className="kpi-value">{totalWriteOffUnitsAgg.toLocaleString()}</strong>
                <span className="kpi-hint">{filteredWriteOffLog.length} write-off incident(s)</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-label">Primary Loss Cause</span>
                <strong className="kpi-value" style={{ fontSize: '1.15rem', color: 'var(--charcoal)' }}>
                  {writeOffReasons[0]?.reason ? writeOffReasons[0].reason.slice(0, 26) + '...' : 'None Recorded'}
                </strong>
                <span className="kpi-hint">
                  {writeOffReasons[0]?.lossValue ? formatMoney(writeOffReasons[0].lossValue) : '$0.00'} loss
                </span>
              </div>
              <div className="kpi-card">
                <span className="kpi-label">Shrinkage Scope</span>
                <strong className="kpi-value" style={{ fontSize: '1.15rem' }}>
                  {selectedDeptId === 'all' ? 'All Departments' : 'Selected Dept'}
                </strong>
                <span className="kpi-hint">Non-selling spoilage &amp; damage</span>
              </div>
            </div>

            {/* Reason Loss Analysis Mini Cards */}
            {writeOffReasons.length > 0 && (
              <div className="subcard" style={{ marginBottom: '1.25rem', borderLeft: '4px solid var(--danger)' }}>
                <div className="section-head" style={{ marginBottom: '0.75rem' }}>
                  <h4 style={{ margin: 0 }}>Loss Breakdown by Non-Selling Cause</h4>
                  <span className="muted" style={{ fontSize: '0.82rem' }}>
                    Identifies whether shrinkage is driven by power cuts, shelf expiry, transit breakage, or pilferage.
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '0.75rem' }}>
                  {writeOffReasons.map((r) => {
                    const pctOfLoss = totalWriteOffLossAgg > 0 ? Math.round((r.lossValue / totalWriteOffLossAgg) * 100) : 0;
                    return (
                      <div
                        key={r.reason}
                        style={{
                          padding: '0.75rem',
                          background: 'var(--surface)',
                          border: '1px solid var(--line)',
                          borderRadius: '8px',
                        }}
                      >
                        <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.35rem' }}>
                          {r.reason}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                          <span className="neg" style={{ fontWeight: 700, fontSize: '1.05rem' }}>
                            {formatMoney(r.lossValue)}
                          </span>
                          <span className="muted" style={{ fontSize: '0.8rem' }}>
                            {r.units} units ({pctOfLoss}%)
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Reason Filter Buttons */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '1rem', alignItems: 'center' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--muted)', marginRight: '0.25rem' }}>
                Filter Reason:
              </span>
              <button
                type="button"
                className={`btn btn-sm ${writeOffReasonFilter === 'all' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setWriteOffReasonFilter('all')}
              >
                All Reasons ({rawWriteOffLog.length})
              </button>
              {writeOffReasons.map((r) => (
                <button
                  key={r.reason}
                  type="button"
                  className={`btn btn-sm ${writeOffReasonFilter === r.reason ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setWriteOffReasonFilter(r.reason)}
                >
                  {r.reason.split('(')[0]?.trim() || r.reason} ({r.count})
                </button>
              ))}
            </div>

            {/* Detailed Write-Off Ledger Table */}
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date Logged</th>
                    <th>Reference</th>
                    <th>Product &amp; SKU</th>
                    <th>Department</th>
                    <th>Warehouse / Store</th>
                    <th>Reason for Loss</th>
                    <th className="num">Units Lost</th>
                    <th className="num">Unit Cost</th>
                    <th className="num">Financial Loss (USD)</th>
                    <th>Authorised By</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredWriteOffLog.map((w) => (
                    <tr key={`${w.documentId}-${w.productId}`}>
                      <td>{w.createdAt.slice(0, 16).replace('T', ' ')}</td>
                      <td><code>{w.reference}</code></td>
                      <td>
                        <strong>{w.productName}</strong> <code>({w.sku})</code>
                      </td>
                      <td>{w.departmentName}</td>
                      <td>{w.warehouseName}</td>
                      <td>
                        <span className="status-pill out" style={{ fontSize: '0.78rem' }}>
                          {w.reason}
                        </span>
                      </td>
                      <td className="num neg">
                        <strong>−{w.quantity} {w.unit}</strong>
                      </td>
                      <td className="num">{formatMoney(w.unitCost)}</td>
                      <td className="num neg">
                        <strong>{formatMoney(w.totalLossValue)}</strong>
                      </td>
                      <td>
                        <span className="muted" style={{ fontSize: '0.82rem' }}>
                          👤 {w.createdByName}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {filteredWriteOffLog.length === 0 && (
                    <tr>
                      <td colSpan={10} className="muted text-center" style={{ padding: '2rem' }}>
                        No non-selling write-offs or shrinkage incidents recorded for this period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
