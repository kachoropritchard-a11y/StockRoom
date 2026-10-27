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

const INITIAL_DEBTORS: ChikweretiRecord[] = [
  {
    id: 'CK-01',
    customerName: 'Sekuru Mutasa (Mhondoro A1 Plot)',
    phone: '+263 77 319 4401',
    category: 'A1 / A2 Farmer (Agro)',
    itemsTaken: '4 × Compound D Fertilizer 50kg, 2 × Maize Seed 10kg',
    totalUsd: 210.0,
    paidUsd: 90.0,
    dueDate: '2026-11-15 (Harvest Advance)',
  },
  {
    id: 'CK-02',
    customerName: 'Mai Chipo Tuckshop (Budiriro 5)',
    phone: '+263 71 884 2210',
    category: 'Tuckshop / Regular',
    itemsTaken: '2 Cases Roil Cooking Oil, 3 Bales Roller Meal',
    totalUsd: 96.0,
    paidUsd: 60.0,
    dueDate: '2026-10-30',
  },
  {
    id: 'CK-03',
    customerName: 'Moyo Civil Contractors',
    phone: '+263 78 400 9182',
    category: 'Builder / Contractor',
    itemsTaken: '20 × PPC Cement 50kg',
    totalUsd: 250.0,
    paidUsd: 250.0,
    dueDate: 'Paid in Full',
  },
];

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

  // Sub-Menu 2: Chikwereti Debtors Book state
  const [debtors, setDebtors] = useState<ChikweretiRecord[]>(INITIAL_DEBTORS);
  const [ckName, setCkName] = useState('');
  const [ckPhone, setCkPhone] = useState('');
  const [ckCat, setCkCat] = useState<ChikweretiRecord['category']>('Tuckshop / Regular');
  const [ckItems, setCkItems] = useState('');
  const [ckTotalUsd, setCkTotalUsd] = useState('45');
  const [ckDue, setCkDue] = useState('2026-11-07');

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
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Warehouse / Yard Zone</th>
                      <th>Branch</th>
                      <th className="num">Active SKUs</th>
                      <th className="num">Total Units</th>
                      <th className="num">Stock Value</th>
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
                        <td className="num"><strong>{formatMoney(w.totalValue)}</strong></td>
                        <td className="num">
                          <button
                            type="button"
                            className={`btn ${selectedWhId === w.warehouseId ? 'btn-primary' : 'btn-outline'} btn-sm`}
                            onClick={() => setSelectedWhId(selectedWhId === w.warehouseId ? undefined : w.warehouseId)}
                          >
                            {selectedWhId === w.warehouseId ? 'Showing Only This' : 'Inspect Zone'}
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
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!ckName.trim()) return;
                  setDebtors((prev) => [
                    {
                      id: `CK-0${prev.length + 1}`,
                      customerName: ckName.trim(),
                      phone: ckPhone.trim() || '+263 77 000 0000',
                      category: ckCat,
                      itemsTaken: ckItems.trim() || 'Assorted Store Goods',
                      totalUsd: Number(ckTotalUsd) || 0,
                      paidUsd: 0,
                      dueDate: ckDue,
                    },
                    ...prev,
                  ]);
                  setCkName('');
                  setCkPhone('');
                  setCkItems('');
                  setMsg('Recorded new customer credit ("Chikwereti") account.');
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
                    {debtors.map((d) => {
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
                                  onClick={() => {
                                    setDebtors((prev) =>
                                      prev.map((x) => (x.id === d.id ? { ...x, paidUsd: x.totalUsd, dueDate: 'Paid in Full' } : x)),
                                    );
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
                    })}
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
    </>
  );
}
