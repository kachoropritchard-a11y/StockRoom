import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, type BalanceItem, type InventoryReports } from '../api';
import { portalPath, useAuth } from '../auth';
import { AccessibleTabs, type TabDefinition } from '../components/AccessibleTabs';
import { QuickTransferModal } from '../components/QuickTransferModal';
import { Spinner } from '../components/Spinner';

type WhTab = 'warehouses' | 'departments' | 'manage';

export function Warehouses() {
  const { user } = useAuth();
  const isExec = user?.role === 'executive_manager';
  const base = user ? portalPath(user.role) : '/inventory';

  const [activeTab, setActiveTab] = useState<WhTab>('warehouses');
  const [branches, setBranches] = useState<{ id: number; name: string; city: string | null }[]>([]);
  const [warehouses, setWarehouses] = useState<{ id: number; branchId: number; branchName?: string; name: string; active: number }[]>([]);
  const [departments, setDepartments] = useState<{ id: number; branchId: number; branchName?: string; name: string; active: number }[]>([]);
  const [reports, setReports] = useState<InventoryReports | null>(null);
  const [selectedWhId, setSelectedWhId] = useState<number | undefined>(undefined);
  const [balances, setBalances] = useState<BalanceItem[]>([]);
  const [transferTarget, setTransferTarget] = useState<{ productId?: number; warehouseId?: number } | null>(null);
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
      if (brRes[0]) {
        const defaultBr = String(brRes[0].id);
        setWhBranchId((prev) => prev || defaultBr);
        setDeptBranchId((prev) => prev || defaultBr);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [selectedWhId]);

  useEffect(() => {
    load();
    const onSync = () => load();
    window.addEventListener('stockroom:sync', onSync);
    return () => window.removeEventListener('stockroom:sync', onSync);
  }, [load]);

  async function handleCreateWarehouse(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMsg('');
    try {
      await api.createWarehouse({ branchId: Number(whBranchId), name: whName.trim() });
      setWhName('');
      setMsg('Warehouse created.');
      setActiveTab('warehouses');
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
      setActiveTab('departments');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const tabs: TabDefinition<WhTab>[] = [
    {
      key: 'warehouses',
      label: '1. Warehouses & Stock On Hand',
      badge: warehouses.length,
      purpose: 'Inspect each warehouse location, total units, USD valuation, and filter stock-on-hand by warehouse.',
    },
    {
      key: 'departments',
      label: '2. Departments & Consumption',
      badge: departments.length,
      purpose: 'Track internal departments, stock issue counts, write-offs, and cumulative consumption cost.',
    },
    ...(isExec
      ? [
          {
            key: 'manage' as const,
            label: '3. + Add Warehouse / Department',
            purpose: 'Register new warehouse stores or internal branch departments.',
          },
        ]
      : []),
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Warehouses &amp; Departments</h1>
          <p className="muted">Inspect warehouse stock locations, branch assignments, and department stock consumption.</p>
        </div>
        <div className="quick-actions">
          <button type="button" className="btn btn-primary" onClick={() => setTransferTarget({})}>
            ⇄ Quick Transfer Stock
          </button>
          <Link to={`${base}/operations`} className="btn btn-outline">
            New Requisition / Issue
          </Link>
        </div>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      {msg && <p className="form-success" role="status">{msg}</p>}

      {loading && !reports ? (
        <Spinner label="Loading warehouses and departments" />
      ) : (
        <section className="card">
          <AccessibleTabs
            idPrefix="warehouses"
            ariaLabel="Warehouses and departments tabs"
            tabs={tabs}
            active={activeTab}
            onChange={setActiveTab}
          />

          {activeTab === 'warehouses' && (
            <div id="warehouses-panel-warehouses" role="tabpanel" aria-labelledby="warehouses-tab-warehouses">
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Warehouse</th>
                      <th>Branch</th>
                      <th className="num">Active SKUs</th>
                      <th className="num">Total Units</th>
                      <th className="num">Stock Value (USD)</th>
                      <th className="num">Filter Stock</th>
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
                        <td className="num">
                          <button
                            type="button"
                            className={`btn ${selectedWhId === w.warehouseId ? 'btn-primary' : 'btn-outline'} btn-sm`}
                            onClick={() => setSelectedWhId(selectedWhId === w.warehouseId ? undefined : w.warehouseId)}
                          >
                            {selectedWhId === w.warehouseId ? 'Showing Only This' : 'Inspect Stock'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="subcard" style={{ marginTop: '1.25rem' }}>
                <div className="section-head">
                  <h3>
                    Stock On Hand — {selectedWhId ? warehouses.find((w) => w.id === selectedWhId)?.name : 'All Warehouses'}
                  </h3>
                  <select
                    aria-label="Filter stock by warehouse"
                    value={selectedWhId ?? ''}
                    onChange={(e) => setSelectedWhId(e.target.value ? Number(e.target.value) : undefined)}
                  >
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
                        <th>Stock Level</th>
                        <th className="num">Stock Value</th>
                        <th>Status</th>
                        <th className="num">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {balances.map((b) => {
                        const statusClass = b.quantity <= 0 ? 'out' : b.lowStock ? 'low' : 'optimal';
                        const pct = b.reorderLevel > 0 ? Math.min(100, Math.round((b.quantity / (b.reorderLevel * 2)) * 100)) : 80;
                        return (
                          <tr key={`${b.productId}-${b.warehouseId}`}>
                            <td>{b.warehouseName}</td>
                            <td><code>{b.sku}</code></td>
                            <td><strong>{b.productName}</strong></td>
                            <td style={{ minWidth: '150px' }}>
                              <div className="stock-level-cell">
                                <div className="stock-bar-track">
                                  <div className={`stock-bar-fill ${statusClass}`} style={{ width: `${Math.max(8, pct)}%` }} />
                                </div>
                                <span className="stock-level-num">{b.quantity} {b.unit}</span>
                              </div>
                            </td>
                            <td className="num">${b.stockValue.toFixed(2)}</td>
                            <td>
                              <span className={`status-pill ${statusClass}`}>
                                {b.lowStock ? `Low (≤ ${b.reorderLevel})` : 'In Stock'}
                              </span>
                            </td>
                            <td className="num">
                              <button
                                type="button"
                                className="btn btn-outline btn-sm"
                                onClick={() => setTransferTarget({ productId: b.productId, warehouseId: b.warehouseId })}
                              >
                                ⇄ Transfer
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      {balances.length === 0 && (
                        <tr>
                          <td colSpan={7} className="muted">No stock balances recorded for this warehouse selection yet.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'departments' && (
            <div id="warehouses-panel-departments" role="tabpanel" aria-labelledby="warehouses-tab-departments">
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Department</th>
                      <th>Branch</th>
                      <th className="num">Posted Issues</th>
                      <th className="num">Write-Offs</th>
                      <th className="num">Total Consumed Units</th>
                      <th className="num">Consumed Value (USD)</th>
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
          )}

          {activeTab === 'manage' && isExec && (
            <div id="warehouses-panel-manage" role="tabpanel" aria-labelledby="warehouses-tab-manage">
              <div className="dashboard-panels">
                <div className="subcard">
                  <h3>Add New Warehouse</h3>
                  <form className="form-grid" onSubmit={handleCreateWarehouse}>
                    <label>
                      Branch
                      <select value={whBranchId} onChange={(e) => setWhBranchId(e.target.value)} required>
                        {branches.map((b) => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Warehouse Name
                      <input value={whName} onChange={(e) => setWhName(e.target.value)} placeholder="e.g. Mutare Regional Store" required />
                    </label>
                    <div className="form-actions">
                      <button className="btn btn-primary" type="submit">+ Add Warehouse</button>
                    </div>
                  </form>
                </div>

                <div className="subcard">
                  <h3>Add New Department</h3>
                  <form className="form-grid" onSubmit={handleCreateDepartment}>
                    <label>
                      Branch
                      <select value={deptBranchId} onChange={(e) => setDeptBranchId(e.target.value)} required>
                        {branches.map((b) => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Department Name
                      <input value={deptName} onChange={(e) => setDeptName(e.target.value)} placeholder="e.g. Wholesale Dispatch" required />
                    </label>
                    <div className="form-actions">
                      <button className="btn btn-primary" type="submit">+ Add Department</button>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      <QuickTransferModal
        open={!!transferTarget}
        initialProductId={transferTarget?.productId}
        initialFromWarehouseId={transferTarget?.warehouseId}
        onClose={() => setTransferTarget(null)}
        onSuccess={(m) => {
          setMsg(m);
          load();
        }}
      />
    </>
  );
}
