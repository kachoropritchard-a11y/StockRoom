import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Summary } from '../api';
import { portalPath, useAuth } from '../auth';
import { Spinner } from '../components/Spinner';

export function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState('');
  const basePath = user ? portalPath(user.role) : '/inventory';

  useEffect(() => {
    api.summary().then(setData).catch((e: Error) => setError(e.message));
  }, []);

  const cards = data
    ? [
        ...(data.totalStockValue !== undefined
          ? [{ label: 'Total Stock Value', value: `$${data.totalStockValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }]
          : []),
        ...(data.products !== undefined ? [{ label: 'Active Products', value: data.products }] : []),
        ...(data.lowStockCount !== undefined ? [{ label: 'Low-Stock Alerts', value: data.lowStockCount, alert: data.lowStockCount > 0 }] : []),
        ...(data.pendingCountSheets !== undefined ? [{ label: 'Draft Count Sheets', value: data.pendingCountSheets }] : []),
        { label: 'Branches', value: data.branches },
        { label: 'Warehouses', value: data.warehouses },
        { label: 'Departments', value: data.departments },
        ...(data.users !== null ? [{ label: 'Active users', value: data.users }] : []),
      ]
    : [];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Welcome, {user?.name}</h1>
          <p className="muted">Authoritative stock ledger overview, live warehouse valuations and operational alerts.</p>
        </div>
        <div className="action-row">
          <Link className="btn btn-primary" to={`${basePath}/operations`}>
            + Record Stock Movement
          </Link>
          <Link className="btn btn-outline" to={`${basePath}/products`}>
            View Products &amp; Balances
          </Link>
        </div>
      </div>

      {error && <p className="form-error" role="alert">Could not load the dashboard. {error}</p>}
      {!data && !error && <Spinner label="Loading dashboard" />}

      <div className="kpi-grid">
        {cards.map((c) => (
          <div className={`card kpi${'alert' in c && c.alert ? ' kpi-alert' : ''}`} key={c.label}>
            <span className="kpi-label">{c.label}</span>
            <span className="kpi-value">{c.value}</span>
          </div>
        ))}
      </div>

      {data?.warehouseSummary && (
        <div className="dashboard-panels">
          <section className="card">
            <div className="section-head">
              <h2>Stock by Warehouse</h2>
              <Link to={`${basePath}/products`}>All balances →</Link>
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
              <h2>Low-Stock Alerts</h2>
              <Link to={`${basePath}/operations`}>Receive stock →</Link>
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
                    </tr>
                  </thead>
                  <tbody>
                    {data.lowStockItems.map((item) => (
                      <tr key={item.productId}>
                        <td><code>{item.sku}</code></td>
                        <td>{item.productName}</td>
                        <td className="num badge-danger-text">{item.quantity} {item.unit}</td>
                        <td className="num">{item.reorderLevel} {item.unit}</td>
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

      {data?.recentMovements && data.recentMovements.length > 0 && (
        <section className="card" style={{ marginTop: '1.25rem' }}>
          <div className="section-head">
            <h2>Recent Ledger Movements</h2>
            <Link to={`${basePath}/operations`}>Full ledger →</Link>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Doc #</th>
                  <th>Type</th>
                  <th>Reference</th>
                  <th>Product</th>
                  <th>Warehouse</th>
                  <th className="num">Entered</th>
                  <th className="num">Base Delta</th>
                </tr>
              </thead>
              <tbody>
                {data.recentMovements.map((m) => (
                  <tr key={m.id}>
                    <td>#{m.documentId}</td>
                    <td><span className={`badge badge-${m.type}`}>{m.type.replace('_', ' ')}</span></td>
                    <td>{m.reference ?? '—'}</td>
                    <td><strong>{m.productName}</strong> <span className="muted">({m.sku})</span></td>
                    <td>{m.warehouseName}</td>
                    <td className="num">{m.quantity} {m.unit}</td>
                    <td className={`num ${m.baseChange >= 0 ? 'pos' : 'neg'}`}>
                      {m.baseChange > 0 ? `+${m.baseChange}` : m.baseChange}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
