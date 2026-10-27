import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type InventoryReports } from '../api';
import { portalPath, useAuth } from '../auth';
import { AccessibleTabs, type TabDefinition } from '../components/AccessibleTabs';
import { Spinner } from '../components/Spinner';
import { useZim } from '../zimContext';

type ReportSubTab = 'zimra' | 'valuation' | 'profit';

export function Reports() {
  const { user } = useAuth();
  const { formatMoney, subLabel, rates, fdms } = useZim();
  const base = user ? portalPath(user.role) : '/inventory';

  const [activeTab, setActiveTab] = useState<ReportSubTab>('zimra');
  const [reports, setReports] = useState<InventoryReports | null>(null);
  const [exportSection, setExportSection] = useState<'valuation' | 'low_stock' | 'movements' | 'audit_logs'>('valuation');
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReports(await api.inventoryReports());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

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
      const res = await fetch(`/api/reports/export?section=${encodeURIComponent(exportSection)}&format=${format}`, {
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
      a.download = `stockroom-${exportSection}-${new Date().toISOString().slice(0, 10)}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg(`Authorised ${exportSection.replace('_', ' ')} ${format.toUpperCase()} export downloaded and recorded in the audit log.`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (loading && !reports) return <Spinner label="Generating inventory reports" />;

  const totalValuation = (reports?.valuationByCategory ?? []).reduce((acc, c) => acc + c.totalValue, 0);

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

  const tabs: TabDefinition<ReportSubTab>[] = [
    {
      key: 'zimra',
      label: '1. ZIMRA FDMS & 15% VAT Compliance',
      badge: reports?.lowStockAlerts.length ?? 0,
      purpose: 'Separate 15% standard-rated stock from 0% zero-rated/exempt basic staples and review low-stock reorder alerts.',
    },
    {
      key: 'valuation',
      label: '2. Multi-Currency Valuation (USD/ZiG/ZAR)',
      purpose: 'Stock valuation by category and warehouse converted simultaneously across USD $, ZiG, and South African Rand (ZAR).',
    },
    {
      key: 'profit',
      label: '3. Item Profit & Fast Movers',
      purpose: 'Inspect department consumption, fast-moving lines, estimated gross margins, and ledger document activity.',
    },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Low-Stock Alerts &amp; Inventory Reports</h1>
          <span className="vernacular-sub">
            {subLabel(
              'Magwaro eZIMRA FDMS (15% VAT) • Hukoshi muUSD, ZiG neZAR • Zvinhu Zvinofamba',
              'Imibiko yeZIMRA FDMS (15% VAT) • Inani Lempahla (USD/ZiG/ZAR)',
            )}
          </span>
        </div>
        <div className="quick-actions">
          <select
            aria-label="Export dataset"
            value={exportSection}
            onChange={(e) => setExportSection(e.target.value as 'valuation' | 'low_stock' | 'movements' | 'audit_logs')}
          >
            <option value="valuation">Stock Valuation Dataset</option>
            <option value="low_stock">Low-Stock Alerts Dataset</option>
            <option value="movements">Stock Movements Ledger</option>
            {user?.role === 'executive_manager' && <option value="audit_logs">Executive Audit Logs</option>}
          </select>
          <button type="button" className="btn btn-outline" onClick={() => handleAuthorisedExport('csv')}>
            ⬇ Export CSV
          </button>
          <button type="button" className="btn btn-outline" onClick={() => handleAuthorisedExport('json')}>
            ⬇ Export JSON
          </button>
          <button type="button" className="btn btn-primary" onClick={load}>
            ↻ Refresh Reports
          </button>
        </div>
      </div>

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

        {/* SUB-MENU 1: ZIMRA FDMS & 15% VAT Compliance + Reorder Queue */}
        {activeTab === 'zimra' && (
          <div id="reports-panel-zimra" role="tabpanel" aria-labelledby="reports-tab-zimra">
            <div className="subcard" style={{ marginBottom: '1.25rem', borderLeft: '4px solid var(--zim-green-700)' }}>
              <div className="section-head">
                <div>
                  <h3>ZIMRA FDMS Fiscal Device &amp; 15% VAT Schedule</h3>
                  <span className="muted" style={{ fontSize: '0.82rem' }}>
                    TIN: <strong>{fdms.tinNumber}</strong> · VAT Reg: <strong>{fdms.vatNumber}</strong> · Device ID:{' '}
                    <code>{fdms.deviceId}</code> · Fiscal Day #{fdms.fiscalDay} ({fdms.status})
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

            <div className="section-head">
              <h3>Low-Stock Reorder Alerts ({reports?.lowStockAlerts.length ?? 0})</h3>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Product</th>
                    <th>Category</th>
                    <th>Stock vs Reorder Threshold</th>
                    <th className="num">Shortfall</th>
                    <th className="num">Unit Cost</th>
                    <th className="num">Est. Restock Cost</th>
                    <th className="num">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {(reports?.lowStockAlerts ?? []).map((a) => {
                    const pct = Math.min(100, Math.round((a.currentStock / Math.max(1, a.reorderLevel)) * 100));
                    return (
                      <tr key={a.productId}>
                        <td><code>{a.sku}</code></td>
                        <td><strong>{a.productName}</strong></td>
                        <td>{a.categoryName}</td>
                        <td style={{ minWidth: '170px' }}>
                          <div className="stock-level-cell">
                            <div className="stock-bar-track">
                              <div className={`stock-bar-fill ${a.currentStock <= 0 ? 'out' : 'low'}`} style={{ width: `${Math.max(8, pct)}%` }} />
                            </div>
                            <span className="stock-level-num badge-danger-text">
                              {a.currentStock} / {a.reorderLevel} {a.unit}
                            </span>
                          </div>
                        </td>
                        <td className="num">{a.shortfall} {a.unit}</td>
                        <td className="num">{formatMoney(a.unitCost)}</td>
                        <td className="num">{formatMoney(a.estimatedRestockCost)}</td>
                        <td className="num">
                          <Link to={`${base}/procurement?productId=${a.productId}`} className="btn btn-primary btn-sm">
                            Restock via PO
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                  {(reports?.lowStockAlerts.length ?? 0) === 0 && (
                    <tr>
                      <td colSpan={8} className="muted">All products are currently above their reorder thresholds.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* SUB-MENU 2: Multi-Currency Valuation (USD/ZiG/ZAR) */}
        {activeTab === 'valuation' && (
          <div id="reports-panel-valuation" role="tabpanel" aria-labelledby="reports-tab-valuation">
            <div className="ops-kpi-row" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
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

        {/* SUB-MENU 3: Item Profit & Fast Movers */}
        {activeTab === 'profit' && (
          <div id="reports-panel-profit" role="tabpanel" aria-labelledby="reports-tab-profit">
            <div className="dashboard-panels">
              <div className="subcard">
                <h3>Department Consumption, Fast Movers &amp; Est. Gross Margin</h3>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Department</th>
                        <th>Branch</th>
                        <th className="num">Issues</th>
                        <th className="num">Units Moved</th>
                        <th className="num">Cost Value</th>
                        <th className="num">Est. Retail (28% Margin)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(reports?.departmentConsumption ?? []).map((d) => (
                        <tr key={d.departmentId}>
                          <td><strong>{d.departmentName}</strong></td>
                          <td>{d.branchName}</td>
                          <td className="num">{d.issueCount}</td>
                          <td className="num">{d.consumedQuantity.toLocaleString()}</td>
                          <td className="num">{formatMoney(d.consumedValue)}</td>
                          <td className="num pos"><strong>{formatMoney(d.consumedValue * 1.28)}</strong></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="subcard">
                <h3>Ledger Activity by Document Type</h3>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Document Type</th>
                        <th className="num">Documents</th>
                        <th className="num">Movement Lines</th>
                        <th className="num">Net Base Delta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(reports?.movementSummary ?? []).map((m) => (
                        <tr key={m.type}>
                          <td><span className={`badge badge-${m.type}`}>{m.type.replace('_', ' ')}</span></td>
                          <td className="num">{m.documentCount}</td>
                          <td className="num">{m.lineCount}</td>
                          <td className={`num ${m.netBaseChange >= 0 ? 'pos' : 'neg'}`}>
                            <strong>{m.netBaseChange > 0 ? `+${m.netBaseChange}` : m.netBaseChange}</strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
