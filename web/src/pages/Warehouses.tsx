import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, type BalanceItem, type InventoryReports, type ProductItem } from '../api';
import { portalPath, useAuth } from '../auth';
import { AccessibleTabs, type TabDefinition } from '../components/AccessibleTabs';
import { QuickTransferModal } from '../components/QuickTransferModal';
import { Spinner } from '../components/Spinner';
import { useZim } from '../zimContext';
import { formatBulkStock, formatBulkReorder } from '../bulkStock';

type DeptSubTab = 'zones' | 'stock';

export function Warehouses() {
  const { user } = useAuth();
  const { formatMoney, subLabel } = useZim();
  const isExec = user?.role === 'executive_manager';
  const base = user ? portalPath(user.role) : '/inventory';

  const [activeTab, setActiveTab] = useState<DeptSubTab>('zones');
  const [showManageDrawer, setShowManageDrawer] = useState(false);
  const [branches, setBranches] = useState<{ id: number; name: string; city: string | null }[]>([]);
  const [warehouses, setWarehouses] = useState<{ id: number; branchId: number; branchName?: string; name: string; active: number }[]>([]);
  const [departments, setDepartments] = useState<{ id: number; branchId: number; branchName?: string; name: string; code?: string; active: number }[]>([]);
  const [reports, setReports] = useState<InventoryReports | null>(null);
  const [selectedWhId, setSelectedWhId] = useState<number | undefined>(undefined);
  const [balances, setBalances] = useState<BalanceItem[]>([]);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [transferTarget, setTransferTarget] = useState<{ productId?: number; warehouseId?: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  // Executive creation forms
  const [whBranchId, setWhBranchId] = useState('');
  const [whName, setWhName] = useState('');
  const [deptBranchId, setDeptBranchId] = useState('');
  const [deptName, setDeptName] = useState('');

  // Department Editing state
  const [editingDept, setEditingDept] = useState<{
    id: number;
    name: string;
    branchId: number;
    active: boolean;
    isPosDepartment: boolean;
  } | null>(null);
  const [editDeptSaving, setEditDeptSaving] = useState(false);

  const [posDeptId, setPosDeptId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [brRes, whRes, dpRes, repRes, balRes, posRes, prodRes] = await Promise.all([
        api.branches(),
        api.warehouses(),
        api.departments(),
        api.inventoryReports(),
        api.balances(selectedWhId),
        api.posCatalog().catch(() => null),
        api.products('', { limit: 200 }).catch(() => ({ items: [] as ProductItem[] })),
      ]);
      setBranches(brRes);
      setWarehouses(whRes);
      setDepartments(dpRes);
      setReports(repRes);
      setBalances(balRes.items);
      setProducts(prodRes.items);
      if (posRes) {
        setPosDeptId(posRes.posDepartmentId ?? null);
      }
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
      setShowManageDrawer(false);
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
      setShowManageDrawer(false);
      setMsg('Department created.');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDeleteDepartment(deptId: number, name: string) {
    if (!window.confirm(`Are you sure you want to delete the department "${name}"?`)) return;
    setError('');
    setMsg('');
    try {
      await api.deleteDepartment(deptId);
      setMsg(`Department "${name}" removed.`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleSaveEditDepartment(e: FormEvent) {
    e.preventDefault();
    if (!editingDept) return;
    setError('');
    setMsg('');
    setEditDeptSaving(true);
    try {
      await api.updateDepartment(editingDept.id, {
        name: editingDept.name.trim(),
        branchId: editingDept.branchId,
        active: editingDept.active,
        isPosDepartment: editingDept.isPosDepartment,
      });
      setMsg(`Department "${editingDept.name}" updated successfully.`);
      setEditingDept(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEditDeptSaving(false);
    }
  }

  async function handleDeleteWarehouse(whId: number, name: string) {
    if (!window.confirm(`Are you sure you want to delete the warehouse "${name}"?`)) return;
    setError('');
    setMsg('');
    try {
      await api.deleteWarehouse(whId);
      setMsg(`Warehouse "${name}" removed.`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const tabs: TabDefinition<DeptSubTab>[] = [
    {
      key: 'zones',
      label: '1. Store & Yard Zones',
      badge: warehouses.length + departments.length,
      purpose: 'Inspect each warehouse store, hardware yard zone, and internal department consumption.',
    },
    {
      key: 'stock',
      label: '2. Live Stock Balances',
      badge: balances.length,
      purpose: 'Inspect on-shelf inventory levels, valuation, and inter-zone transfer shortcuts.',
    },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Store Departments &amp; Storage Yards</h1>
          <span className="vernacular-sub">
            {subLabel(
              'Matura neZvikamu zveChitoro',
              'Izigaba Zesitolo Lamathala',
              'Storefloor Departments, Retail Checkout Counters & Storage Yards',
            )}
          </span>
        </div>
        <div className="quick-actions">
          <button type="button" className="btn btn-outline" onClick={() => setShowManageDrawer((s) => !s)}>
            {showManageDrawer ? '✕ Close Form' : '+ Add Store / Department'}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setTransferTarget({})}>
            ⇄ Quick Transfer Stock
          </button>
          <Link to={`${base}/transfers`} className="btn btn-outline">
            Open Department Transfers
          </Link>
        </div>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      {msg && <p className="form-success" role="status">{msg}</p>}

      {showManageDrawer && isExec && (
        <section className="card" style={{ marginBottom: '1.2rem' }}>
          <div className="dashboard-panels">
            <div className="subcard">
              <h3>Add New Store / Warehouse Zone</h3>
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
                  <button className="btn btn-primary" type="submit">+ Add Store</button>
                </div>
              </form>
            </div>

            <div className="subcard">
              <h3>Add New Internal Department</h3>
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
                  <input value={deptName} onChange={(e) => setDeptName(e.target.value)} placeholder="e.g. Sales Department / Front Store" required />
                  <span className="muted" style={{ fontSize: '0.74rem', marginTop: '0.2rem' }}>
                    ⚡ Department Code is auto-generated by the system (e.g. DPT-001)
                  </span>
                </label>
                <div className="form-actions">
                  <button className="btn btn-primary" type="submit">+ Add Department</button>
                </div>
              </form>
            </div>
          </div>
        </section>
      )}

      {loading && !reports ? (
        <Spinner label="Loading warehouses and departments" />
      ) : (
        <section className="card">
          {/* TIER 3: Horizontal In-Page Sub-Menu Bar */}
          <AccessibleTabs
            idPrefix="warehouses"
            ariaLabel="Departments and store zones sub-menus"
            tabs={tabs}
            active={activeTab}
            onChange={setActiveTab}
          />

          {/* SUB-MENU 1: Store & Yard Zones */}
          {activeTab === 'zones' && (
            <div id="warehouses-panel-zones" role="tabpanel" aria-labelledby="warehouses-tab-zones">
              {/* Active Storefloor Departments */}
              <div className="section-head" style={{ marginBottom: '0.75rem' }}>
                <div>
                  <h3 style={{ margin: 0 }}>Active Storefloor Departments</h3>
                  <span className="vernacular-sub" style={{ fontSize: '0.78rem' }}>
                    Departments configured for your storefloor, retail counters, and POS checkout ({departments.length} registered).
                  </span>
                </div>
                {isExec && (
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowManageDrawer(true)}>
                    + Add Department
                  </button>
                )}
              </div>
              <div className="table-wrap" style={{ marginBottom: '1.75rem' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Department Name</th>
                      <th>Branch</th>
                      <th>POS Checkout Binding</th>
                      <th>Status</th>
                      {isExec && <th className="num">Action</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {departments.length === 0 ? (
                      <tr>
                        <td colSpan={isExec ? 6 : 5} className="muted text-center" style={{ padding: '2rem' }}>
                          No departments configured yet. Click &quot;+ Add Department&quot; above to add one.
                        </td>
                      </tr>
                    ) : (
                      departments.map((dept) => {
                        const isPos = dept.id === posDeptId;
                        return (
                          <tr key={dept.id}>
                            <td><code>{dept.code ?? `DPT-${String(dept.id).padStart(3, '0')}`}</code></td>
                            <td><strong>{dept.name}</strong></td>
                            <td>{dept.branchName ?? 'Main Branch'}</td>
                            <td>
                              {isPos ? (
                                <span className="status-pill optimal" style={{ fontWeight: 700 }}>
                                  🎯 Active POS Checkout Counter
                                </span>
                              ) : (
                                <span className="muted" style={{ fontSize: '0.82rem' }}>
                                  Standard Department
                                </span>
                              )}
                            </td>
                            <td>
                              <span className={`status-pill ${dept.active ? 'optimal' : 'out'}`}>
                                {dept.active ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            {isExec && (
                              <td className="num" style={{ whiteSpace: 'nowrap' }}>
                                <button
                                  type="button"
                                  className="btn btn-outline btn-sm"
                                  style={{ marginRight: '0.4rem' }}
                                  onClick={() =>
                                    setEditingDept({
                                      id: dept.id,
                                      name: dept.name,
                                      branchId: dept.branchId,
                                      active: dept.active === 1,
                                      isPosDepartment: isPos,
                                    })
                                  }
                                >
                                  ✏️ Edit
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-outline btn-sm"
                                  style={{ color: 'var(--danger)', borderColor: 'var(--line)' }}
                                  onClick={() => handleDeleteDepartment(dept.id, dept.name)}
                                  title="Delete this department"
                                >
                                  🗑 Delete
                                </button>
                              </td>
                            )}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Warehouses & Physical Storage Yards */}
              <div className="section-head" style={{ marginBottom: '0.75rem' }}>
                <div>
                  <h3 style={{ margin: 0 }}>Warehouses &amp; Physical Storage Yards</h3>
                  <span className="vernacular-sub" style={{ fontSize: '0.78rem' }}>
                    Physical bulk storerooms, hardware timber yards, and warehouses.
                  </span>
                </div>
                {isExec && (
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowManageDrawer(true)}>
                    + Add Warehouse
                  </button>
                )}
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Warehouse / Yard Zone</th>
                      <th>Branch</th>
                      <th className="num">Active SKUs</th>
                      <th className="num">Total Units</th>
                      <th className="num">Stock Value</th>
                      <th className="num">Inspect Zone</th>
                      {isExec && <th className="num">Action</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {warehouses.length === 0 ? (
                      <tr>
                        <td colSpan={isExec ? 7 : 6} className="muted text-center" style={{ padding: '2rem' }}>
                          No warehouses registered.
                        </td>
                      </tr>
                    ) : (
                      warehouses.map((wh) => {
                        const summary = (reports?.warehouseStockSummary ?? []).find((s) => s.warehouseId === wh.id);
                        const skuCount = summary?.skuCount ?? 0;
                        const totalUnits = summary?.totalQuantity ?? 0;
                        const totalValue = summary?.totalValue ?? 0;
                        return (
                          <tr key={wh.id}>
                            <td><strong>{wh.name}</strong></td>
                            <td>{wh.branchName ?? 'Main Branch'}</td>
                            <td className="num">{skuCount}</td>
                            <td className="num">{totalUnits.toLocaleString()}</td>
                            <td className="num"><strong>{formatMoney(totalValue)}</strong></td>
                            <td className="num">
                              <button
                                type="button"
                                className={`btn ${selectedWhId === wh.id ? 'btn-primary' : 'btn-outline'} btn-sm`}
                                onClick={() => setSelectedWhId(selectedWhId === wh.id ? undefined : wh.id)}
                              >
                                {selectedWhId === wh.id ? 'Showing Only This' : 'Inspect Zone'}
                              </button>
                            </td>
                            {isExec && (
                              <td className="num">
                                <button
                                  type="button"
                                  className="btn btn-outline btn-sm"
                                  style={{ color: 'var(--danger)', borderColor: 'var(--line)' }}
                                  onClick={() => handleDeleteWarehouse(wh.id, wh.name)}
                                  title="Delete warehouse (if empty)"
                                >
                                  🗑 Delete
                                </button>
                              </td>
                            )}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="subcard" style={{ marginTop: '1.25rem' }}>
                <div className="section-head">
                  <h3>
                    Stock On Hand — {selectedWhId ? warehouses.find((w) => w.id === selectedWhId)?.name : 'All Store & Yard Zones'}
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
                        <th>Zone / Store</th>
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
                        const matchProd = products.find((p) => p.id === b.productId);
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
                                <span className="stock-level-num">
                                  <strong>{formatBulkStock(b.quantity, matchProd?.packagings, b.unit).text}</strong>
                                </span>
                              </div>
                            </td>
                            <td className="num">{formatMoney(b.stockValue)}</td>
                            <td>
                              <span className={`status-pill ${statusClass}`}>
                                {b.lowStock ? `Low (≤ ${formatBulkReorder(b.reorderLevel, matchProd?.packagings, b.unit)})` : 'In Stock'}
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
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* SUB-MENU 2: Live Stock Balances */}
          {activeTab === 'stock' && (
            <div id="warehouses-panel-stock" role="tabpanel" aria-labelledby="warehouses-tab-stock">
              <div className="section-head">
                <div>
                  <h3>
                    Stock On Hand — {selectedWhId ? warehouses.find((w) => w.id === selectedWhId)?.name : 'All Store & Yard Zones'}
                  </h3>
                  <span className="vernacular-sub" style={{ fontSize: '0.78rem' }}>
                    Live on-shelf inventory levels, valuation, and inter-zone transfers ({balances.length} balance records).
                  </span>
                </div>
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
                      <th>Zone / Store</th>
                      <th>SKU</th>
                      <th>Product</th>
                      <th>Stock Level</th>
                      <th className="num">Stock Value</th>
                      <th>Status</th>
                      <th className="num">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {balances.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="muted text-center" style={{ padding: '2rem' }}>
                          No stock balances found in this zone.
                        </td>
                      </tr>
                    ) : (
                      balances.map((b) => {
                        const matchProd = products.find((p) => p.id === b.productId);
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
                                <span className="stock-level-num">
                                  <strong>{formatBulkStock(b.quantity, matchProd?.packagings, b.unit).text}</strong>
                                </span>
                              </div>
                            </td>
                            <td className="num">{formatMoney(b.stockValue)}</td>
                            <td>
                              <span className={`status-pill ${statusClass}`}>
                                {b.lowStock ? `Low (≤ ${formatBulkReorder(b.reorderLevel, matchProd?.packagings, b.unit)})` : 'In Stock'}
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
                      })
                    )}
                  </tbody>
                </table>
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

      {editingDept && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="edit-dept-title" onClick={() => setEditingDept(null)}>
          <div className="modal-card" style={{ maxWidth: '480px' }} onClick={(e) => e.stopPropagation()}>
            <div className="section-head" style={{ marginBottom: '1rem' }}>
              <div>
                <h3 id="edit-dept-title" style={{ margin: 0 }}>Edit Storefloor Department</h3>
                <span className="muted" style={{ fontSize: '0.82rem' }}>
                  Update department name, assigned branch, active status or POS checkout binding.
                </span>
              </div>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditingDept(null)}>✕</button>
            </div>
            <form onSubmit={handleSaveEditDepartment}>
              <div className="form-grid" style={{ gap: '0.9rem' }}>
                <label>
                  Department Name
                  <input
                    type="text"
                    value={editingDept.name}
                    onChange={(e) => setEditingDept({ ...editingDept, name: e.target.value })}
                    required
                    placeholder="e.g. Sales Department / Front Store"
                  />
                </label>
                <label>
                  Assigned Branch
                  <select
                    value={editingDept.branchId}
                    onChange={(e) => setEditingDept({ ...editingDept, branchId: Number(e.target.value) })}
                    required
                  >
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginTop: '0.3rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={editingDept.active}
                      onChange={(e) => setEditingDept({ ...editingDept, active: e.target.checked })}
                    />
                    <span>Active Department (available for sales and inventory)</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={editingDept.isPosDepartment}
                      onChange={(e) => setEditingDept({ ...editingDept, isPosDepartment: e.target.checked })}
                    />
                    <span><strong>Set as Active POS Counter Department</strong> (used for checkout till)</span>
                  </label>
                </div>
                <div className="form-actions" style={{ marginTop: '0.75rem', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                  <button type="button" className="btn btn-outline" onClick={() => setEditingDept(null)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={editDeptSaving}>
                    {editDeptSaving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
