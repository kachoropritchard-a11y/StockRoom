import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type InventoryReports } from '../api';
import { portalPath, useAuth } from '../auth';
import { Spinner } from '../components/Spinner';

export function Reports() {
  const { user } = useAuth();
  const base = user ? portalPath(user.role) : '/inventory';

  const [reports, setReports] = useState<InventoryReports | null>(null);
  const [loading, setLoading] = useState(true);
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
  }, [load]);

  function handleExportCsv() {
    if (!reports) return;
    const rows = [
      ['Section', 'Name / SKU', 'Secondary', 'Quantity', 'Value (USD)'],
      ...reports.valuationByCategory.map((c) => [
        'Category Valuation',
        c.categoryName,
        `${c.productCount} SKUs`,
        String(c.totalQuantity),
        c.totalValue.toFixed(2),
      ]),
      ...reports.warehouseStockSummary.map((w) => [
        'Warehouse Valuation',
        w.warehouseName,
        w.branchName,
        String(w.totalQuantity),
        w.totalValue.toFixed(2),
      ]),
      ...reports.departmentConsumption.map((d) => [
        'Department Consumption',
        d.departmentName,
        `${d.issueCount} issues / ${d.writeOffCount} write-offs`,
        String(d.consumedQuantity),
        d.consumedValue.toFixed(2),
      ]),
      ...reports.lowStockAlerts.map((a) => [
        'Low-Stock Alert',
        `${a.sku} - ${a.productName}`,
        `Reorder <= ${a.reorderLevel} ${a.unit}`,
        String(a.currentStock),
        a.estimatedRestockCost.toFixed(2),
      ]),
    ];
    const csv = rows.map((r) => r.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stockroom-inventory-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading && !reports) return <Spinner label="Generating inventory reports" />;

  const totalValuation = (reports?.valuationByCategory ?? []).reduce((acc, c) => acc + c.totalValue, 0);
  const totalConsumedValue = (reports?.departmentConsumption ?? []).reduce((acc, d) => acc + d.consumedValue, 0);
  const totalDocs = (reports?.movementSummary ?? []).reduce((acc, m) => acc + m.documentCount, 0);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Low-Stock Alerts &amp; Inventory Reports</h1>
          <p className="muted">Authoritative stock valuation, reorder alerts, department consumption and ledger movement analytics.</p>
        </div>
        <div className="quick-actions">
          <button type="button" className="btn btn-outline" onClick={handleExportCsv}>
            Export Report CSV
          </button>
          <button type="button" className="btn btn-primary" onClick={load}>
            Refresh Reports
          </button>
        </div>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

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

      {/* Low-Stock Alerts Table */}
      <section className="card" style={{ marginTop: '1.25rem' }}>
        <div className="section-head">
          <h2>Low-Stock Alerts &amp; Reorder Action Queue ({reports?.lowStockAlerts.length ?? 0})</h2>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Product</th>
                <th>Category</th>
                <th className="num">On Hand</th>
                <th className="num">Reorder Level</th>
                <th className="num">Shortfall</th>
                <th className="num">Unit Cost</th>
                <th className="num">Est. Restock Cost</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {(reports?.lowStockAlerts ?? []).map((a) => (
                <tr key={a.productId}>
                  <td><code>{a.sku}</code></td>
                  <td><strong>{a.productName}</strong></td>
                  <td>{a.categoryName}</td>
                  <td className="num badge-danger-text"><strong>{a.currentStock} {a.unit}</strong></td>
                  <td className="num">{a.reorderLevel} {a.unit}</td>
                  <td className="num">{a.shortfall} {a.unit}</td>
                  <td className="num">${a.unitCost.toFixed(2)}</td>
                  <td className="num">${a.estimatedRestockCost.toFixed(2)}</td>
                  <td>
                    <Link to={`${base}/procurement?productId=${a.productId}`} className="btn btn-primary btn-sm">
                      Restock via PO
                    </Link>
                  </td>
                </tr>
              ))}
              {(reports?.lowStockAlerts.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={9} className="muted">All products are currently above their reorder thresholds.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="dashboard-panels" style={{ marginTop: '1.25rem' }}>
        {/* Valuation by Category */}
        <section className="card">
          <h2>Stock Valuation by Category</h2>
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
        </section>

        {/* Warehouse Valuation Summary */}
        <section className="card">
          <h2>Stock Valuation by Warehouse</h2>
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
        </section>
      </div>

      <div className="dashboard-panels" style={{ marginTop: '1.25rem' }}>
        {/* Department Consumption Report */}
        <section className="card">
          <h2>Department Consumption &amp; Write-Off Report</h2>
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
        </section>

        {/* Movement Summary by Document Type */}
        <section className="card">
          <h2>Ledger Activity by Document Type</h2>
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
        </section>
      </div>
    </>
  );
}
