import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type InventoryReports } from '../api';
import { portalPath, useAuth } from '../auth';
import { AccessibleTabs, type TabDefinition } from '../components/AccessibleTabs';
import { Spinner } from '../components/Spinner';

type ReportTab = 'alerts' | 'valuation' | 'consumption';

export function Reports() {
  const { user } = useAuth();
  const base = user ? portalPath(user.role) : '/inventory';

  const [activeTab, setActiveTab] = useState<ReportTab>('alerts');
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
  const totalConsumedValue = (reports?.departmentConsumption ?? []).reduce((acc, d) => acc + d.consumedValue, 0);
  const totalDocs = (reports?.movementSummary ?? []).reduce((acc, m) => acc + m.documentCount, 0);

  const tabs: TabDefinition<ReportTab>[] = [
    {
      key: 'alerts',
      label: '1. Low-Stock Reorder Queue',
      badge: reports?.lowStockAlerts.length ?? 0,
      purpose: 'Products currently at or below their reorder level, ranked by urgency with one-click Purchase Order restocking.',
    },
    {
      key: 'valuation',
      label: '2. Valuation by Category & Warehouse',
      purpose: 'Live stock valuation breakdown across product categories and warehouse locations.',
    },
    {
      key: 'consumption',
      label: '3. Department Consumption & Ledger Summary',
      purpose: 'Track cumulative department issues, write-offs, and document activity across the ledger.',
    },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Low-Stock Alerts &amp; Inventory Reports</h1>
          <p className="muted">Authoritative stock valuation, reorder alerts, department consumption and ledger movement analytics.</p>
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

      <section className="kpi-grid" aria-label="Report highlights">
        <article className="kpi-card">
          <span className="kpi-label">Total Stock Valuation</span>
          <strong className="kpi-value">${totalValuation.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
          <span className="kpi-hint">Across all active categories</span>
        </article>
        <article className="kpi-card">
          <span className="kpi-label">Low-Stock Alerts</span>
          <strong className="kpi-value" style={{ color: (reports?.lowStockAlerts.length ?? 0) > 0 ? 'var(--danger)' : undefined }}>
            {reports?.lowStockAlerts.length ?? 0}
          </strong>
          <span className="kpi-hint">Products at or below reorder threshold</span>
        </article>
        <article className="kpi-card">
          <span className="kpi-label">Department Consumption</span>
          <strong className="kpi-value">${totalConsumedValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
          <span className="kpi-hint">Cumulative value of issues &amp; write-offs</span>
        </article>
        <article className="kpi-card">
          <span className="kpi-label">Posted Ledger Documents</span>
          <strong className="kpi-value">{totalDocs}</strong>
          <span className="kpi-hint">Immutable audit trail</span>
        </article>
      </section>

      <section className="card">
        <AccessibleTabs
          idPrefix="reports"
          ariaLabel="Inventory report sections"
          tabs={tabs}
          active={activeTab}
          onChange={setActiveTab}
        />

        {activeTab === 'alerts' && (
          <div id="reports-panel-alerts" role="tabpanel" aria-labelledby="reports-tab-alerts">
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
                        <td className="num">${a.unitCost.toFixed(2)}</td>
                        <td className="num">${a.estimatedRestockCost.toFixed(2)}</td>
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

        {activeTab === 'valuation' && (
          <div id="reports-panel-valuation" role="tabpanel" aria-labelledby="reports-tab-valuation">
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
                        <th className="num">Stock Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(reports?.valuationByCategory ?? []).map((c) => (
                        <tr key={c.categoryName}>
                          <td><strong>{c.categoryName}</strong></td>
                          <td className="num">{c.productCount}</td>
                          <td className="num">{c.totalQuantity.toLocaleString()}</td>
                          <td className="num">${c.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
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
                        <th className="num">Active SKUs</th>
                        <th className="num">Total Units</th>
                        <th className="num">Stock Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(reports?.warehouseStockSummary ?? []).map((w) => (
                        <tr key={w.warehouseId}>
                          <td><strong>{w.warehouseName}</strong></td>
                          <td>{w.branchName}</td>
                          <td className="num">{w.skuCount}</td>
                          <td className="num">{w.totalQuantity.toLocaleString()}</td>
                          <td className="num">${w.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'consumption' && (
          <div id="reports-panel-consumption" role="tabpanel" aria-labelledby="reports-tab-consumption">
            <div className="dashboard-panels">
              <div className="subcard">
                <h3>Department Consumption &amp; Write-Off Report</h3>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Department</th>
                        <th>Branch</th>
                        <th className="num">Issues</th>
                        <th className="num">Write-Offs</th>
                        <th className="num">Units Consumed</th>
                        <th className="num">Cost Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(reports?.departmentConsumption ?? []).map((d) => (
                        <tr key={d.departmentId}>
                          <td><strong>{d.departmentName}</strong></td>
                          <td>{d.branchName}</td>
                          <td className="num">{d.issueCount}</td>
                          <td className="num">{d.writeOffCount}</td>
                          <td className="num">{d.consumedQuantity.toLocaleString()}</td>
                          <td className="num">${d.consumedValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
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
