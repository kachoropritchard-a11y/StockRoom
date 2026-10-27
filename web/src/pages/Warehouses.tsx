import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, type BalanceItem, type InventoryReports } from '../api';
import { portalPath, useAuth } from '../auth';
import { Spinner } from '../components/Spinner';

export function Warehouses() {
  const { user } = useAuth();
  const isExec = user?.role === 'executive_manager';
  const base = user ? portalPath(user.role) : '/inventory';

  const [branches, setBranches] = useState<{ id: number; name: string; city: string | null }[]>([]);
  const [warehouses, setWarehouses] = useState<{ id: number; branchId: number; branchName?: string; name: string; active: number }[]>([]);
  const [departments, setDepartments] = useState<{ id: number; branchId: number; branchName?: string; name: string; active: number }[]>([]);
  const [reports, setReports] = useState<InventoryReports | null>(null);
  const [selectedWhId, setSelectedWhId] = useState<number | undefined>(undefined);
  const [balances, setBalances] = useState<BalanceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  // Executive creation forms
  const [whBranchId, setWhBranchId] = useState('');
  const [whName, setWhName] = useState('');
  const [deptBranchId, setDeptBranchId] = useState('');
  const [deptName, setDeptName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [brRes, whRes, dpRes, repRes, balRes] = await Promise.all([
        api.branches(),
        api.warehouses(),
        api.departments(),
        api.inventoryReports(),
        api.balances(selectedWhId),
      ]);
      setBranches(brRes);
      setWarehouses(whRes);
      setDepartments(dpRes);
      setReports(repRes);
      setBalances(balRes.items);
      if (!whBranchId && brRes[0]) setWhBranchId(String(brRes[0].id));
      if (!deptBranchId && brRes[0]) setDeptBranchId(String(brRes[0].id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [selectedWhId, whBranchId, deptBranchId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreateWarehouse(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMsg('');
    try {
      await api.createWarehouse({ branchId: Number(whBranchId), name: whName.trim() });
      setWhName('');
      setMsg('Warehouse created.');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleCreateDepartment(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMsg('');
    try {
      await api.createDepartment({ branchId: Number(deptBranchId), name: deptName.trim() });
      setDeptName('');
      setMsg('Department created.');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Warehouses &amp; Departments</h1>
          <p className="muted">Inspect warehouse stock locations, branch assignments, and department stock consumption.</p>
        </div>
        <div className="quick-actions">
          <Link to={`${base}/operations`} className="btn btn-primary">New Requisition / Transfer</Link>
        </div>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      {msg && <p className="form-success" role="status">{msg}</p>}

      {loading && !reports ? (
        <Spinner label="Loading warehouses and departments" />
      ) : (
        <>
          <div className="dashboard-panels">
            <section className="card">
              <div className="section-head">
                <h2>Warehouses ({warehouses.length})</h2>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Warehouse</th>
                      <th>Branch</th>
                      <th className="num">Active SKUs</th>
                      <th className="num">Total Units</th>
                      <th className="num">Stock Value</th>
                      <th>Inspect</th>
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
                        <td>
                          <button
                            type="button"
                            className={`btn ${selectedWhId === w.warehouseId ? 'btn-primary' : 'btn-outline'} btn-sm`}
                            onClick={() => setSelectedWhId(selectedWhId === w.warehouseId ? undefined : w.warehouseId)}
                          >
                            {selectedWhId === w.warehouseId ? 'Showing' : 'Filter Stock'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {isExec && (
                <>
                  <hr className="divider" />
                  <h3>Add Warehouse</h3>
                  <form className="inline-form" onSubmit={handleCreateWarehouse}>
                    <select value={whBranchId} onChange={(e) => setWhBranchId(e.target.value)} required>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                    <input value={whName} onChange={(e) => setWhName(e.target.value)} placeholder="Warehouse name" required />
                    <button className="btn btn-outline" type="submit">+ Add Warehouse</button>
                  </form>
                </>
              )}
            </section>

            <section className="card">
              <div className="section-head">
                <h2>Departments &amp; Consumption ({departments.length})</h2>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Department</th>
                      <th>Branch</th>
                      <th className="num">Issues</th>
                      <th className="num">Write-Offs</th>
                      <th className="num">Consumed Qty</th>
                      <th className="num">Consumed Value</th>
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

              {isExec && (
                <>
                  <hr className="divider" />
                  <h3>Add Department</h3>
                  <form className="inline-form" onSubmit={handleCreateDepartment}>
                    <select value={deptBranchId} onChange={(e) => setDeptBranchId(e.target.value)} required>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                    <input value={deptName} onChange={(e) => setDeptName(e.target.value)} placeholder="Department name" required />
                    <button className="btn btn-outline" type="submit">+ Add Department</button>
                  </form>
                </>
              )}
            </section>
          </div>

          <section className="card" style={{ marginTop: '1.25rem' }}>
            <div className="section-head">
              <h2>
                Warehouse Stock On Hand{' '}
                {selectedWhId ? `— ${warehouses.find((w) => w.id === selectedWhId)?.name ?? ''}` : '(All Accessible Warehouses)'}
              </h2>
              <select value={selectedWhId ?? ''} onChange={(e) => setSelectedWhId(e.target.value ? Number(e.target.value) : undefined)}>
                <option value="">All Warehouses</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name} ({w.branchName})</option>
                ))}
              </select>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Warehouse</th>
                    <th>SKU</th>
                    <th>Product</th>
                    <th className="num">On Hand</th>
                    <th className="num">Unit Cost</th>
                    <th className="num">Stock Value</th>
                    <th>Health</th>
                  </tr>
                </thead>
                <tbody>
                  {balances.map((b) => (
                    <tr key={`${b.productId}-${b.warehouseId}`}>
                      <td>{b.warehouseName}</td>
                      <td><code>{b.sku}</code></td>
                      <td><strong>{b.productName}</strong></td>
                      <td className="num">{b.quantity} {b.unit}</td>
                      <td className="num">${b.unitCost.toFixed(2)}</td>
                      <td className="num">${b.stockValue.toFixed(2)}</td>
                      <td>
                        {b.lowStock ? (
                          <span className="badge badge-write_off">Low stock (≤ {b.reorderLevel})</span>
                        ) : (
                          <span className="badge badge-receipt">Healthy</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {balances.length === 0 && (
                    <tr>
                      <td colSpan={7} className="muted">No stock balances recorded for this warehouse selection yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
