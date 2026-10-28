import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, type BalanceItem, type InventoryReports } from '../api';
import { portalPath, useAuth } from '../auth';
import { AccessibleTabs, type TabDefinition } from '../components/AccessibleTabs';
import { QuickTransferModal } from '../components/QuickTransferModal';
import { Spinner } from '../components/Spinner';
import { useZim } from '../zimContext';

type DeptSubTab = 'zones' | 'chikwereti';

interface ChikweretiRecord {
  id: string;
  customerName: string;
  phone: string;
  category: 'Tuckshop / Regular' | 'A1 / A2 Farmer (Agro)' | 'Builder / Contractor';
  itemsTaken: string;
  totalUsd: number;
  paidUsd: number;
  dueDate: string;
}

export function Warehouses() {
  const { user } = useAuth();
  const { formatMoney, subLabel } = useZim();
  const isExec = user?.role === 'executive_manager';
  const base = user ? portalPath(user.role) : '/inventory';

  const [activeTab, setActiveTab] = useState<DeptSubTab>('zones');
  const [showManageDrawer, setShowManageDrawer] = useState(false);
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

  // Department Editing state
  const [editingDept, setEditingDept] = useState<{
    id: number;
    name: string;
    branchId: number;
    active: boolean;
    isPosDepartment: boolean;
  } | null>(null);
  const [editDeptSaving, setEditDeptSaving] = useState(false);

  // Sub-Menu 2: Chikwereti Debtors Book state
  const [debtors, setDebtors] = useState<ChikweretiRecord[]>([]);
  const [posDeptId, setPosDeptId] = useState<number | null>(null);
  const [posDeptName, setPosDeptName] = useState<string>('');
  const [ckName, setCkName] = useState('');
  const [ckPhone, setCkPhone] = useState('');
  const [ckCat, setCkCat] = useState<ChikweretiRecord['category']>('Tuckshop / Regular');
  const [ckItems, setCkItems] = useState('');
  const [ckTotalUsd, setCkTotalUsd] = useState('45');
  const [ckDue, setCkDue] = useState('2026-11-07');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [brRes, whRes, dpRes, repRes, balRes, smeRes, posRes] = await Promise.all([
        api.branches(),
        api.warehouses(),
        api.departments(),
        api.inventoryReports(),
        api.balances(selectedWhId),
        api.smeOverview().catch(() => null),
        api.posCatalog().catch(() => null),
      ]);
      setBranches(brRes);
      setWarehouses(whRes);
      setDepartments(dpRes);
      setReports(repRes);
      setBalances(balRes.items);
      if (posRes) {
        setPosDeptId(posRes.posDepartmentId ?? null);
        setPosDeptName(posRes.posDepartmentName ?? '');
      }
      if (smeRes) {
        setDebtors(
          (smeRes.debtors || []).map((d) => ({
            id: String(d.id),
            customerName: d.customerName,
            phone: d.phone,
            category:
              d.departmentName.toLowerCase().includes('hardware') || d.departmentName.toLowerCase().includes('build')
                ? 'Builder / Contractor'
                : d.departmentName.toLowerCase().includes('agro')
                  ? 'A1 / A2 Farmer (Agro)'
                  : 'Tuckshop / Regular',
            itemsTaken: d.itemsSummary,
            totalUsd: d.balance > 0 ? d.balance : d.creditLimit,
            paidUsd: d.balance === 0 ? d.creditLimit : 0,
            dueDate: d.status === 'CLEARED' ? 'Paid in Full' : d.dueDate,
          })),
        );
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
      key: 'chikwereti',
      label: '2. Customer Credit & Farmers Debtors Book ("Chikwereti")',
      badge: debtors.filter((d) => d.totalUsd > d.paidUsd).length,
      purpose: 'Track customer credit ("Chikwereti"), A1/A2 farmer input advances, and send 1-tap WhatsApp payment reminders.',
    },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>3. Warehouses &amp; Depts — Store Zones &amp; &quot;Chikwereti&quot; Book</h1>
          <span className="vernacular-sub">
            {subLabel(
              'Matura, Zvikamu zveChitoro & Bhuku reChikwereti cheVatengi neVarimi',
              'Izigaba Zesitolo &ugwalo Lwezikwelede Zabathengi Labalimi',
            )}
          </span>
        </div>
        <div className="quick-actions">
          {isExec && (
            <button type="button" className="btn btn-outline" onClick={() => setShowManageDrawer((s) => !s)}>
              {showManageDrawer ? '✕ Close Form' : '+ Add Store / Department'}
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={() => setTransferTarget({})}>
            ⇄ Quick Transfer Stock
          </button>
          <Link to={`${base}/transfers`} className="btn btn-outline">
            Open Break-Bulk &amp; Transfers
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
                  <input value={deptName} onChange={(e) => setDeptName(e.target.value)} placeholder="e.g. Butchery / Bakery" required />
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
                        <td colSpan={isExec ? 5 : 4} className="muted text-center" style={{ padding: '2rem' }}>
                          No departments configured yet. Click &quot;+ Add Department&quot; above to add one.
                        </td>
                      </tr>
                    ) : (
                      departments.map((dept) => {
                        const isPos = dept.id === posDeptId;
                        return (
                          <tr key={dept.id}>
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
                            <td className="num">{formatMoney(b.stockValue)}</td>
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
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* SUB-MENU 2: Customer Credit & Farmers Debtors Book ("Chikwereti") */}
          {activeTab === 'chikwereti' && (
            <div id="warehouses-panel-chikwereti" role="tabpanel" aria-labelledby="warehouses-tab-chikwereti">
              <div className="section-head">
                <div>
                  <h2>Customer Credit &amp; Farmers Debtors Book (&quot;Chikwereti&quot;)</h2>
                  <span className="vernacular-sub">
                    {subLabel(
                      'Bhuku reChikwereti (Vatengi veTuckshop, Varimi veA1/A2 neVavaki)',
                      'Ugwalo Lwezikwelede Zabathengi Labalimi',
                    )}
                  </span>
                </div>
              </div>

              <form
                className="form-grid subcard"
                style={{ marginBottom: '1.25rem' }}
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!ckName.trim()) return;
                  await api
                    .createDebtor({
                      customerName: ckName.trim(),
                      phone: ckPhone.trim() || '+263 77 000 0000',
                      departmentName: ckCat,
                      creditLimit: Math.max(100, Number(ckTotalUsd) * 2),
                      balance: Number(ckTotalUsd) || 0,
                      dueDate: ckDue,
                      itemsSummary: ckItems.trim() || 'Assorted Store Goods',
                    })
                    .catch(() => null);
                  setCkName('');
                  setCkPhone('');
                  setCkItems('');
                  setMsg('Recorded new customer credit ("Chikwereti") account.');
                  await load();
                }}
              >
                <label>
                  Customer / Farmer Name
                  <input value={ckName} onChange={(e) => setCkName(e.target.value)} placeholder="e.g. Baba Tawanda" required />
                </label>
                <label>
                  WhatsApp Phone
                  <input value={ckPhone} onChange={(e) => setCkPhone(e.target.value)} placeholder="+263 77..." required />
                </label>
                <label>
                  Account Type
                  <select value={ckCat} onChange={(e) => setCkCat(e.target.value as ChikweretiRecord['category'])}>
                    <option value="Tuckshop / Regular">Tuckshop / Regular Customer</option>
                    <option value="A1 / A2 Farmer (Agro)">A1 / A2 Farmer (Agro Inputs)</option>
                    <option value="Builder / Contractor">Builder / Hardware Account</option>
                  </select>
                </label>
                <label>
                  Goods Taken on Credit
                  <input value={ckItems} onChange={(e) => setCkItems(e.target.value)} placeholder="e.g. 2 × Fertilizer 50kg" required />
                </label>
                <label>
                  Credit Amount (USD $)
                  <input type="number" step="0.01" value={ckTotalUsd} onChange={(e) => setCkTotalUsd(e.target.value)} required />
                </label>
                <label>
                  Promised Payment Date
                  <input value={ckDue} onChange={(e) => setCkDue(e.target.value)} required />
                </label>
                <div className="form-actions">
                  <button type="submit" className="btn btn-primary">+ Log Chikwereti</button>
                </div>
              </form>

              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Customer / Farmer</th>
                      <th>Category</th>
                      <th>Items Taken on Credit</th>
                      <th className="num">Total Credit</th>
                      <th className="num">Paid</th>
                      <th className="num">Balance Owed</th>
                      <th>Due Date</th>
                      <th className="num">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {debtors.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="muted text-center" style={{ padding: '2.5rem', color: 'var(--muted)' }}>
                          No customer credit accounts logged yet. Use the form above to record customer credit (&quot;Chikwereti&quot;).
                        </td>
                      </tr>
                    ) : (
                      debtors.map((d) => {
                        const owed = Math.max(0, d.totalUsd - d.paidUsd);
                      const waReminder = `Mhoroi / Salibonani ${d.customerName}, friendly reminder from Great Zimbabwe Stockroom regarding your credit balance of ${formatMoney(owed)} for (${d.itemsTaken}) due on ${d.dueDate}. Thank you / Tatenda!`;
                      return (
                        <tr key={d.id}>
                          <td>
                            <strong>{d.customerName}</strong>
                            <div className="muted" style={{ margin: 0, fontSize: '0.78rem' }}>{d.phone}</div>
                          </td>
                          <td>{d.category}</td>
                          <td>{d.itemsTaken}</td>
                          <td className="num">{formatMoney(d.totalUsd)}</td>
                          <td className="num pos">{formatMoney(d.paidUsd)}</td>
                          <td className="num">
                            <strong className={owed > 0 ? 'neg' : 'pos'}>{formatMoney(owed)}</strong>
                          </td>
                          <td>
                            <span className={`status-pill ${owed === 0 ? 'optimal' : 'low'}`}>
                              {owed === 0 ? 'Paid in Full' : d.dueDate}
                            </span>
                          </td>
                          <td className="num">
                            {owed > 0 && (
                              <div className="action-row" style={{ justifyContent: 'flex-end' }}>
                                <a
                                  href={`https://wa.me/?text=${encodeURIComponent(waReminder)}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="btn btn-whatsapp btn-sm"
                                >
                                  📲 WhatsApp Reminder
                                </a>
                                <button
                                  type="button"
                                  className="btn btn-outline btn-sm"
                                  onClick={async () => {
                                    const numId = Number(d.id);
                                    if (Number.isFinite(numId) && numId > 0) {
                                      await api.repayDebtor(numId, owed).catch(() => null);
                                      await load();
                                    } else {
                                      setDebtors((prev) =>
                                        prev.map((x) => (x.id === d.id ? { ...x, paidUsd: x.totalUsd, dueDate: 'Paid in Full' } : x)),
                                      );
                                    }
                                    setMsg(`Marked ${d.customerName}'s Chikwereti balance as settled!`);
                                  }}
                                >
                                  ✓ Clear Debt
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    }))}
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
                    placeholder="e.g. Butchery / Bakery"
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
