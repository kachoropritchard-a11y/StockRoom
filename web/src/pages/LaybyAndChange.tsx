import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type ProductItem } from '../api';
import { AccessibleTabs, type TabDefinition } from '../components/AccessibleTabs';
import { Spinner } from '../components/Spinner';
import { useZim } from '../zimContext';
import { formatBulkStock } from '../bulkStock';

type LaybySubTab = 'layby' | 'credit' | 'change';

interface LaybyRow {
  id: number;
  receiptRef: string;
  customerName: string;
  customerPhone: string;
  productId: number | null;
  productName: string;
  departmentName: string;
  warehouseName: string;
  orderedQty: number;
  collectedQty: number;
  remainingQty: number;
  unit: string;
  totalPaid: number;
  status: 'AWAITING_COLLECTION' | 'PARTIAL_COLLECTED' | 'COMPLETED';
  createdAt: string;
}

interface DebtorRow {
  id: number;
  customerName: string;
  phone: string;
  departmentName: string;
  creditLimit: number;
  balance: number;
  dueDate: string;
  itemsSummary: string;
  status: 'CURRENT' | 'DUE_SOON' | 'OVERDUE' | 'CLEARED';
  updatedAt: string;
}

interface ChangeVoucherRow {
  id: number;
  voucherCode: string;
  customerName: string;
  customerPhone: string | null;
  amountUsd: number;
  departmentName: string;
  status: 'UNREDEEMED' | 'REDEEMED';
  createdByName: string;
  createdAt: string;
  redeemedAt: string | null;
}

export function LaybyAndChange() {
  const { formatMoney, subLabel } = useZim();
  const [activeTab, setActiveTab] = useState<LaybySubTab>('layby');
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  // Data
  const [laybys, setLaybys] = useState<LaybyRow[]>([]);
  const [debtors, setDebtors] = useState<DebtorRow[]>([]);
  const [changeVouchers, setChangeVouchers] = useState<ChangeVoucherRow[]>([]);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [warehouses, setWarehouses] = useState<{ id: number; name: string }[]>([]);

  // Filters & Search
  const [laybySearch, setLaybySearch] = useState('');
  const [laybyStatusFilter, setLaybyStatusFilter] = useState<string>('all');
  const [debtorSearch, setDebtorSearch] = useState('');
  const [debtorStatusFilter, setDebtorStatusFilter] = useState<string>('all');
  const [changeSearch, setChangeSearch] = useState('');
  const [changeStatusFilter, setChangeStatusFilter] = useState<string>('all');

  // Modals & Forms: Lay-by
  const [showAddLayby, setShowAddLayby] = useState(false);
  const [laybyCustomerName, setLaybyCustomerName] = useState('');
  const [laybyCustomerPhone, setLaybyCustomerPhone] = useState('');
  const [laybyReceiptRef, setLaybyReceiptRef] = useState('');
  const [laybyProductId, setLaybyProductId] = useState('');
  const [laybyWarehouse, setLaybyWarehouse] = useState('Main Warehouse');
  const [laybyDept, setLaybyDept] = useState('Hardware & Building');
  const [laybyQty, setLaybyQty] = useState('10');
  const [laybyUnit, setLaybyUnit] = useState('bags');
  const [laybyTotalPaid, setLaybyTotalPaid] = useState('125.00');

  // Collection modal
  const [collectingItem, setCollectingItem] = useState<LaybyRow | null>(null);
  const [collectQty, setCollectQty] = useState('1');
  const [collectNotes, setCollectNotes] = useState('');

  // Modals & Forms: Chikwereti (Customer Debt)
  const [showAddDebtor, setShowAddDebtor] = useState(false);
  const [debName, setDebName] = useState('');
  const [debPhone, setDebPhone] = useState('');
  const [debDept, setDebDept] = useState('Groceries');
  const [debLimit, setDebLimit] = useState('100.00');
  const [debBalance, setDebBalance] = useState('25.00');
  const [debDueDate, setDebDueDate] = useState('');
  const [debItems, setDebItems] = useState('2x 10kg Meal, 2L Cooking Oil');

  // Repay Debt Modal
  const [repayingDebtor, setRepayingDebtor] = useState<DebtorRow | null>(null);
  const [repayAmount, setRepayAmount] = useState('10.00');

  // Modals & Forms: Change Voucher
  const [showAddChange, setShowAddChange] = useState(false);
  const [changeCustName, setChangeCustName] = useState('Walk-In Customer');
  const [changeCustPhone, setChangeCustPhone] = useState('');
  const [changeAmount, setChangeAmount] = useState('0.50');
  const [changeDept, setChangeDept] = useState('Groceries Till #1');
  const [lastIssuedCode, setLastIssuedCode] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [smeRes, pRes, wRes] = await Promise.all([
        api.smeOverview(),
        api.products('', { limit: 150 }),
        api.warehouses(),
      ]);
      setLaybys(smeRes.laybys || []);
      setDebtors(smeRes.debtors || []);
      setChangeVouchers(smeRes.changeVouchers || []);
      setProducts(pRes.items);
      setWarehouses(wRes);
      if (pRes.items[0] && !laybyProductId) {
        setLaybyProductId(String(pRes.items[0].id));
        setLaybyUnit(pRes.items[0].baseUnit);
      }
      if (wRes[0]) {
        setLaybyWarehouse(wRes[0].name);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [laybyProductId]);

  useEffect(() => {
    loadData();
    const onSync = () => loadData();
    window.addEventListener('stockroom:sync', onSync);
    return () => window.removeEventListener('stockroom:sync', onSync);
  }, [loadData]);

  // Handle Register Lay-by
  async function handleCreateLayby(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMsg('');
    const selectedProd = products.find((p) => String(p.id) === laybyProductId);
    const prodName = selectedProd ? selectedProd.name : 'Custom Reserved Stock';
    const ref = laybyReceiptRef.trim() || `RCP-LAY-${Date.now().toString().slice(-5)}`;

    try {
      await api.createLayby({
        receiptRef: ref,
        customerName: laybyCustomerName.trim(),
        customerPhone: laybyCustomerPhone.trim(),
        productName: prodName,
        departmentName: laybyDept,
        warehouseName: laybyWarehouse,
        orderedQty: Number(laybyQty) || 1,
        unit: laybyUnit.trim() || selectedProd?.baseUnit || 'each',
        totalPaid: Number(laybyTotalPaid) || 0,
      });

      setShowAddLayby(false);
      setLaybyCustomerName('');
      setLaybyCustomerPhone('');
      setLaybyReceiptRef('');
      setMsg(`✓ Paid & Uncollected stock reservation created for ${laybyCustomerName || 'customer'} (${ref}).`);
      await loadData();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Handle Collect Lay-by Stock
  async function handleCollectSubmit(e: FormEvent) {
    e.preventDefault();
    if (!collectingItem) return;
    setError('');
    setMsg('');
    const qtyToCollect = Number(collectQty);
    if (qtyToCollect <= 0 || qtyToCollect > collectingItem.remainingQty) {
      setError(`Collection quantity must be between 1 and ${collectingItem.remainingQty}`);
      return;
    }

    try {
      const res = await api.collectLayby(collectingItem.id, qtyToCollect);
      setCollectingItem(null);
      setCollectQty('1');
      setCollectNotes('');
      setMsg(`✓ Dispatched ${qtyToCollect} ${collectingItem.unit} to ${collectingItem.customerName}. Remaining in store: ${res.remainingQty} ${collectingItem.unit}.`);
      await loadData();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Handle Create Debtor (Chikwereti)
  async function handleCreateDebtor(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMsg('');
    try {
      const due = debDueDate || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
      await api.createDebtor({
        customerName: debName.trim(),
        phone: debPhone.trim(),
        departmentName: debDept,
        creditLimit: Number(debLimit) || 100,
        balance: Number(debBalance) || 0,
        dueDate: due,
        itemsSummary: debItems.trim(),
      });
      setShowAddDebtor(false);
      setDebName('');
      setDebPhone('');
      setDebBalance('25.00');
      setDebItems('');
      setMsg(`✓ Customer credit account (Chikwereti) created for ${debName}.`);
      await loadData();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Handle Repay Debtor
  async function handleRepaySubmit(e: FormEvent) {
    e.preventDefault();
    if (!repayingDebtor) return;
    setError('');
    setMsg('');
    const amt = Number(repayAmount);
    if (amt <= 0) {
      setError('Repayment amount must be positive.');
      return;
    }
    try {
      const res = await api.repayDebtor(repayingDebtor.id, amt);
      setRepayingDebtor(null);
      setRepayAmount('10.00');
      setMsg(`✓ Payment of ${formatMoney(amt, 'USD')} recorded for ${repayingDebtor.customerName}. New balance: ${formatMoney(res.balance, 'USD')}.`);
      await loadData();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Handle Issue Change Slip
  async function handleIssueChange(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMsg('');
    const amt = Number(changeAmount);
    if (amt <= 0) {
      setError('Please enter a positive change amount.');
      return;
    }

    try {
      const res = await api.createChangeVoucher({
        customerName: changeCustName.trim() || 'Walk-In Customer',
        customerPhone: changeCustPhone.trim() || undefined,
        amountUsd: amt,
        departmentName: changeDept.trim(),
      });
      setLastIssuedCode(res.voucherCode);
      setShowAddChange(false);
      setChangeCustName('Walk-In Customer');
      setChangeCustPhone('');
      setChangeAmount('0.50');
      setMsg(`✓ Customer change slip #${res.voucherCode} issued for ${formatMoney(amt, 'USD')}! Ready to hand to customer.`);
      await loadData();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Handle Redeem Change Slip
  async function handleRedeemChange(id: number, code: string, amt: number) {
    setError('');
    setMsg('');
    try {
      await api.redeemChangeVoucher(id);
      setMsg(`✓ Change voucher #${code} for ${formatMoney(amt, 'USD')} marked as redeemed / paid out.`);
      await loadData();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // KPI Calculations
  const pendingLaybys = laybys.filter((l) => l.status !== 'COMPLETED');
  const totalLaybyValue = pendingLaybys.reduce((sum, l) => sum + l.totalPaid, 0);

  const activeDebtors = debtors.filter((d) => d.status !== 'CLEARED');
  const totalDebtorBalance = activeDebtors.reduce((sum, d) => sum + d.balance, 0);

  const unredeemedChange = changeVouchers.filter((c) => c.status === 'UNREDEEMED');
  const totalChangeLiability = unredeemedChange.reduce((sum, c) => sum + c.amountUsd, 0);

  // Filtered Lists
  const filteredLaybys = laybys.filter((l) => {
    if (laybyStatusFilter !== 'all' && l.status !== laybyStatusFilter) return false;
    if (laybySearch.trim()) {
      const q = laybySearch.toLowerCase();
      return (
        l.customerName.toLowerCase().includes(q) ||
        l.customerPhone.toLowerCase().includes(q) ||
        l.receiptRef.toLowerCase().includes(q) ||
        l.productName.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const filteredDebtors = debtors.filter((d) => {
    if (debtorStatusFilter !== 'all' && d.status !== debtorStatusFilter) return false;
    if (debtorSearch.trim()) {
      const q = debtorSearch.toLowerCase();
      return (
        d.customerName.toLowerCase().includes(q) ||
        d.phone.toLowerCase().includes(q) ||
        d.itemsSummary.toLowerCase().includes(q) ||
        d.departmentName.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const filteredChange = changeVouchers.filter((c) => {
    if (changeStatusFilter !== 'all' && c.status !== changeStatusFilter) return false;
    if (changeSearch.trim()) {
      const q = changeSearch.toLowerCase();
      return (
        c.voucherCode.toLowerCase().includes(q) ||
        c.customerName.toLowerCase().includes(q) ||
        (c.customerPhone && c.customerPhone.toLowerCase().includes(q)) ||
        c.departmentName.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const tabs: TabDefinition<LaybySubTab>[] = [
    {
      key: 'layby',
      label: '1. Paid & Uncollected Stock (Lay-by)',
      badge: pendingLaybys.length,
      purpose: 'Manage goods paid for by customers that are still awaiting pickup from the store floor or yard.',
    },
    {
      key: 'credit',
      label: '2. Customer Credit & Debt (Chikwereti)',
      badge: activeDebtors.length,
      purpose: 'Manage trusted customer credit ledgers, goods taken on credit, and debt repayments.',
    },
    {
      key: 'change',
      label: '3. Customer Till Change Management',
      badge: unredeemedChange.length,
      purpose: 'Manage and redeem change credit balances when the till lacks sufficient small change or coins.',
    },
  ];

  if (loading && laybys.length === 0 && debtors.length === 0 && changeVouchers.length === 0) {
    return <Spinner label="Loading Customer Balances & Lay-By..." fullPage />;
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Lay-By, Customer Debt (Chikwereti) &amp; Till Change</h1>
          <span className="vernacular-sub">
            {subLabel(
              'Zvinhu Zvakabhadharwa • Chikwereti cheVatengi • Mari yeChange Inosara paTill',
              'Impahla Ebhadaliweyo • Isikwelede Sabathengi • Inthshintshi Esele e-Till',
              'Hardware Yard Pickups, Lay-By Stock, Customer Debt Ledger (Chikwereti) & Till Change Slips',
            )}
          </span>
        </div>
        <div className="quick-actions">
          {activeTab === 'layby' && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowAddLayby(true)}
            >
              + New Lay-by / Paid Order
            </button>
          )}
          {activeTab === 'credit' && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowAddDebtor(true)}
            >
              + Record Customer Credit (Chikwereti)
            </button>
          )}
          {activeTab === 'change' && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowAddChange(true)}
            >
              + Issue Customer Change Slip
            </button>
          )}
        </div>
      </div>

      <AccessibleTabs
        idPrefix="layby-change"
        ariaLabel="Layby, Chikwereti and Customer Change Tabs"
        tabs={tabs}
        active={activeTab}
        onChange={(k) => setActiveTab(k)}
      />

      {msg && <div className="alert alert-success" style={{ marginBottom: '1rem' }}>{msg}</div>}
      {error && <div className="alert alert-danger" style={{ marginBottom: '1rem' }}>{error}</div>}

      {/* LAST ISSUED CHANGE SLIP BANNER */}
      {lastIssuedCode && (
        <div className="card" style={{ marginBottom: '1.25rem', border: '2px solid var(--accent, #0284c7)', backgroundColor: 'rgba(2, 132, 199, 0.08)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--accent, #0284c7)' }}>
                🎫 Customer Change Slip Generated: <code>{lastIssuedCode}</code>
              </div>
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.9rem' }}>
                Hand this voucher code or slip to the customer. When they return on their next purchase or when the till has coins, look up code <strong>{lastIssuedCode}</strong> to redeem.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setLastIssuedCode(null)}
            >
              Dismiss Slip
            </button>
          </div>
        </div>
      )}

      {/* ================= TAB 1: PAID & UNCOLLECTED STOCK / LAY-BY ================= */}
      {activeTab === 'layby' && (
        <>
          {/* KPI Cards */}
          <div className="metrics-grid" style={{ marginBottom: '1.25rem' }}>
            <div className="metric-card">
              <span className="metric-label">Awaiting Collection</span>
              <div className="metric-value">{laybys.filter((l) => l.status === 'AWAITING_COLLECTION').length}</div>
              <span className="metric-sub">Orders fully in store/yard</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Partial Collections</span>
              <div className="metric-value">{laybys.filter((l) => l.status === 'PARTIAL_COLLECTED').length}</div>
              <span className="metric-sub">Partially picked up</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Reserved Stock Value</span>
              <div className="metric-value" style={{ color: 'var(--success, #16a34a)' }}>
                {formatMoney(totalLaybyValue, 'USD')}
              </div>
              <span className="metric-sub">Already paid by customers</span>
            </div>
          </div>

          {/* Controls Bar */}
          <div className="card" style={{ marginBottom: '1.25rem', padding: '0.75rem 1rem' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: '0.75rem', flex: 1, minWidth: '280px' }}>
                <input
                  type="text"
                  className="input"
                  placeholder="Search customer, phone, receipt ref, or product..."
                  value={laybySearch}
                  onChange={(e) => setLaybySearch(e.target.value)}
                  style={{ flex: 1 }}
                />
                <select
                  className="input"
                  style={{ width: 'auto' }}
                  value={laybyStatusFilter}
                  onChange={(e) => setLaybyStatusFilter(e.target.value)}
                >
                  <option value="all">All Statuses ({laybys.length})</option>
                  <option value="AWAITING_COLLECTION">Awaiting Collection</option>
                  <option value="PARTIAL_COLLECTED">Partially Collected</option>
                  <option value="COMPLETED">Completed</option>
                </select>
              </div>
              <div style={{ fontSize: '0.875rem', opacity: 0.8 }}>
                Showing {filteredLaybys.length} of {laybys.length} reservations
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="card">
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Receipt Ref</th>
                    <th>Customer Name &amp; Phone</th>
                    <th>Reserved Product</th>
                    <th>Location / Dept</th>
                    <th style={{ textAlign: 'right' }}>Ordered</th>
                    <th style={{ textAlign: 'right' }}>Collected</th>
                    <th style={{ textAlign: 'right' }}>Remaining</th>
                    <th style={{ textAlign: 'right' }}>Total Paid</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'center' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLaybys.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{ textAlign: 'center', padding: '2.5rem', opacity: 0.7 }}>
                        No paid &amp; uncollected stock found matching criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredLaybys.map((l) => (
                      <tr key={l.id}>
                        <td>
                          <strong>{l.receiptRef}</strong>
                          <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>{l.createdAt.slice(0, 10)}</div>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{l.customerName}</div>
                          <div style={{ fontSize: '0.8rem', opacity: 0.8 }}>📞 {l.customerPhone || 'No phone'}</div>
                        </td>
                        <td>
                          <strong>{l.productName}</strong>
                        </td>
                        <td>
                          <div>{l.departmentName}</div>
                          <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>{l.warehouseName}</div>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {(() => {
                            const prod = products.find((p) => p.id === l.productId);
                            return prod ? formatBulkStock(l.orderedQty, prod.packagings, l.unit).text : `${l.orderedQty} ${l.unit}`;
                          })()}
                        </td>
                        <td style={{ textAlign: 'right', color: l.collectedQty > 0 ? 'var(--accent, #0284c7)' : undefined }}>
                          {(() => {
                            const prod = products.find((p) => p.id === l.productId);
                            return prod ? formatBulkStock(l.collectedQty, prod.packagings, l.unit).text : `${l.collectedQty} ${l.unit}`;
                          })()}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: l.remainingQty > 0 ? 'var(--warning, #eab308)' : 'var(--success, #16a34a)' }}>
                          {(() => {
                            const prod = products.find((p) => p.id === l.productId);
                            return prod ? formatBulkStock(l.remainingQty, prod.packagings, l.unit).text : `${l.remainingQty} ${l.unit}`;
                          })()}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>
                          {formatMoney(l.totalPaid, 'USD')}
                        </td>
                        <td>
                          <span
                            className={`badge ${
                              l.status === 'COMPLETED'
                                ? 'badge-success'
                                : l.status === 'PARTIAL_COLLECTED'
                                  ? 'badge-warning'
                                  : 'badge-primary'
                            }`}
                          >
                            {l.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {l.remainingQty > 0 ? (
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              onClick={() => {
                                setCollectingItem(l);
                                setCollectQty(String(l.remainingQty));
                              }}
                            >
                              📦 Dispatch Stock
                            </button>
                          ) : (
                            <span style={{ fontSize: '0.8rem', color: 'var(--success, #16a34a)', fontWeight: 600 }}>
                              ✓ Fully Picked Up
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ================= TAB 2: CUSTOMER CREDIT & DEBT (CHIKWERETI) ================= */}
      {activeTab === 'credit' && (
        <>
          {/* KPI Cards */}
          <div className="metrics-grid" style={{ marginBottom: '1.25rem' }}>
            <div className="metric-card">
              <span className="metric-label">Total Chikwereti Owed</span>
              <div className="metric-value" style={{ color: totalDebtorBalance > 0 ? 'var(--danger, #dc2626)' : 'var(--success, #16a34a)' }}>
                {formatMoney(totalDebtorBalance, 'USD')}
              </div>
              <span className="metric-sub">Outstanding customer debt</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Active Debtors</span>
              <div className="metric-value">{activeDebtors.length}</div>
              <span className="metric-sub">Accounts with balance</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Overdue Debtors</span>
              <div className="metric-value" style={{ color: 'var(--danger, #dc2626)' }}>
                {debtors.filter((d) => d.status === 'OVERDUE').length}
              </div>
              <span className="metric-sub">Past repayment due date</span>
            </div>
          </div>

          {/* Controls Bar */}
          <div className="card" style={{ marginBottom: '1.25rem', padding: '0.75rem 1rem' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: '0.75rem', flex: 1, minWidth: '280px' }}>
                <input
                  type="text"
                  className="input"
                  placeholder="Search debtor name, phone, items taken, or department..."
                  value={debtorSearch}
                  onChange={(e) => setDebtorSearch(e.target.value)}
                  style={{ flex: 1 }}
                />
                <select
                  className="input"
                  style={{ width: 'auto' }}
                  value={debtorStatusFilter}
                  onChange={(e) => setDebtorStatusFilter(e.target.value)}
                >
                  <option value="all">All Debtors ({debtors.length})</option>
                  <option value="CURRENT">Current</option>
                  <option value="DUE_SOON">Due Soon</option>
                  <option value="OVERDUE">Overdue</option>
                  <option value="CLEARED">Cleared / Settled</option>
                </select>
              </div>
              <div style={{ fontSize: '0.875rem', opacity: 0.8 }}>
                Showing {filteredDebtors.length} of {debtors.length} customer credit accounts
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="card">
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Customer Name &amp; Phone</th>
                    <th>Department</th>
                    <th>Items Taken on Credit</th>
                    <th style={{ textAlign: 'right' }}>Credit Limit</th>
                    <th style={{ textAlign: 'right' }}>Balance Owed</th>
                    <th>Due Date</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'center' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDebtors.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', padding: '2.5rem', opacity: 0.7 }}>
                        No customer credit accounts found matching criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredDebtors.map((d) => (
                      <tr key={d.id}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{d.customerName}</div>
                          <div style={{ fontSize: '0.8rem', opacity: 0.8 }}>📞 {d.phone}</div>
                        </td>
                        <td>{d.departmentName}</td>
                        <td>
                          <span style={{ fontSize: '0.88rem' }}>{d.itemsSummary || 'General goods'}</span>
                        </td>
                        <td style={{ textAlign: 'right' }}>{formatMoney(d.creditLimit, 'USD')}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, fontSize: '1.05rem', color: d.balance > 0 ? 'var(--danger, #dc2626)' : 'var(--success, #16a34a)' }}>
                          {formatMoney(d.balance, 'USD')}
                        </td>
                        <td>
                          <div>{d.dueDate}</div>
                          <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>Updated {d.updatedAt.slice(0, 10)}</div>
                        </td>
                        <td>
                          <span
                            className={`badge ${
                              d.status === 'CLEARED'
                                ? 'badge-success'
                                : d.status === 'OVERDUE'
                                  ? 'badge-danger'
                                  : d.status === 'DUE_SOON'
                                    ? 'badge-warning'
                                    : 'badge-primary'
                            }`}
                          >
                            {d.status}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {d.balance > 0 ? (
                            <button
                              type="button"
                              className="btn btn-sm btn-success"
                              onClick={() => {
                                setRepayingDebtor(d);
                                setRepayAmount(String(d.balance));
                              }}
                            >
                              💵 Repay Debt
                            </button>
                          ) : (
                            <span style={{ fontSize: '0.8rem', color: 'var(--success, #16a34a)', fontWeight: 600 }}>
                              ✓ Settled
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ================= TAB 3: CUSTOMER TILL CHANGE MANAGEMENT ================= */}
      {activeTab === 'change' && (
        <>
          {/* Explanation Banner */}
          <div className="card" style={{ marginBottom: '1.25rem', backgroundColor: 'var(--card-subtle-bg, rgba(0,0,0,0.02))' }}>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
              <div style={{ fontSize: '1.8rem' }}>🪙</div>
              <div>
                <h3 style={{ margin: '0 0 0.25rem', fontSize: '1rem' }}>Till Small-Change &amp; Insufficient Cash Management</h3>
                <p style={{ margin: 0, fontSize: '0.875rem', opacity: 0.85 }}>
                  In multi-currency and cash transactions, cashiers frequently run short of USD coins ($0.10, $0.25, $0.50, $1.00 notes). When a customer leaves their change or agrees to store credit, issue a <strong>Change Voucher</strong> here. When the customer returns or till coins are replenished, one-click redeem pays out or offsets their purchase.
                </p>
              </div>
            </div>
          </div>

          {/* KPI Cards */}
          <div className="metrics-grid" style={{ marginBottom: '1.25rem' }}>
            <div className="metric-card">
              <span className="metric-label">Total Change Liability</span>
              <div className="metric-value" style={{ color: totalChangeLiability > 0 ? 'var(--warning, #eab308)' : 'var(--success, #16a34a)' }}>
                {formatMoney(totalChangeLiability, 'USD')}
              </div>
              <span className="metric-sub">Owed to walk-in customers</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Unredeemed Change Slips</span>
              <div className="metric-value">{unredeemedChange.length}</div>
              <span className="metric-sub">Active customer slips</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Settled / Redeemed Slips</span>
              <div className="metric-value" style={{ color: 'var(--success, #16a34a)' }}>
                {changeVouchers.filter((c) => c.status === 'REDEEMED').length}
              </div>
              <span className="metric-sub">Cleared at till</span>
            </div>
          </div>

          {/* Controls Bar */}
          <div className="card" style={{ marginBottom: '1.25rem', padding: '0.75rem 1rem' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: '0.75rem', flex: 1, minWidth: '280px' }}>
                <input
                  type="text"
                  className="input"
                  placeholder="Search voucher code (CHG-xxxx), customer name, or phone..."
                  value={changeSearch}
                  onChange={(e) => setChangeSearch(e.target.value)}
                  style={{ flex: 1 }}
                />
                <select
                  className="input"
                  style={{ width: 'auto' }}
                  value={changeStatusFilter}
                  onChange={(e) => setChangeStatusFilter(e.target.value)}
                >
                  <option value="all">All Slips ({changeVouchers.length})</option>
                  <option value="UNREDEEMED">Unredeemed / Owed ({unredeemedChange.length})</option>
                  <option value="REDEEMED">Redeemed / Settled</option>
                </select>
              </div>
              <div style={{ fontSize: '0.875rem', opacity: 0.8 }}>
                Showing {filteredChange.length} of {changeVouchers.length} change vouchers
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="card">
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Voucher Code</th>
                    <th>Customer Name &amp; Phone</th>
                    <th>Department / Till</th>
                    <th>Issued By</th>
                    <th>Date Issued</th>
                    <th style={{ textAlign: 'right' }}>Change Amount</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'center' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredChange.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', padding: '2.5rem', opacity: 0.7 }}>
                        No change slips found matching criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredChange.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <code>{c.voucherCode}</code>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{c.customerName}</div>
                          {c.customerPhone && <div style={{ fontSize: '0.8rem', opacity: 0.8 }}>📞 {c.customerPhone}</div>}
                        </td>
                        <td>{c.departmentName}</td>
                        <td>{c.createdByName}</td>
                        <td>
                          <div>{c.createdAt.slice(0, 10)}</div>
                          <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>{c.createdAt.slice(11, 16)}</div>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700, fontSize: '1.05rem', color: c.status === 'UNREDEEMED' ? 'var(--warning, #eab308)' : undefined }}>
                          {formatMoney(c.amountUsd, 'USD')}
                        </td>
                        <td>
                          <span className={`badge ${c.status === 'UNREDEEMED' ? 'badge-warning' : 'badge-success'}`}>
                            {c.status === 'UNREDEEMED' ? 'OWED / ACTIVE' : 'REDEEMED'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {c.status === 'UNREDEEMED' ? (
                            <button
                              type="button"
                              className="btn btn-sm btn-success"
                              onClick={() => handleRedeemChange(c.id, c.voucherCode, c.amountUsd)}
                            >
                              ✓ Redeem / Payout Change
                            </button>
                          ) : (
                            <span style={{ fontSize: '0.8rem', color: 'var(--success, #16a34a)' }}>
                              Settled {c.redeemedAt?.slice(0, 10)}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ================= MODAL: DISPATCH / COLLECT STOCK ================= */}
      {collectingItem && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: '520px' }}>
            <h3>Dispatch Stock to Customer</h3>
            <p style={{ opacity: 0.85, fontSize: '0.9rem', marginBottom: '1rem' }}>
              Recording stock collection for receipt <strong>{collectingItem.receiptRef}</strong>.
            </p>

            <div style={{ backgroundColor: 'var(--card-subtle-bg, rgba(0,0,0,0.03))', padding: '0.75rem', borderRadius: '6px', marginBottom: '1rem' }}>
              <div><strong>Customer:</strong> {collectingItem.customerName} ({collectingItem.customerPhone || 'No phone'})</div>
              <div><strong>Product:</strong> {collectingItem.productName}</div>
              <div><strong>Total Ordered:</strong> {collectingItem.orderedQty} {collectingItem.unit}</div>
              <div><strong>Already Collected:</strong> {collectingItem.collectedQty} {collectingItem.unit}</div>
              <div style={{ fontWeight: 700, color: 'var(--accent, #0284c7)' }}>
                Remaining Available for Pickup: {collectingItem.remainingQty} {collectingItem.unit}
              </div>
            </div>

            <form onSubmit={handleCollectSubmit}>
              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label className="label">Quantity to Dispatch Now ({collectingItem.unit}) *</label>
                <input
                  type="number"
                  className="input"
                  min="0.001"
                  max={collectingItem.remainingQty}
                  step="any"
                  value={collectQty}
                  onChange={(e) => setCollectQty(e.target.value)}
                  required
                />
              </div>

              <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                <label className="label">Collector Name / Vehicle Reg / Notes (Optional)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. VaChigumba, Isuzu KB 250 reg AGE-4122"
                  value={collectNotes}
                  onChange={(e) => setCollectNotes(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setCollectingItem(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                >
                  Confirm Stock Dispatch
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL: ADD LAY-BY RESERVATION ================= */}
      {showAddLayby && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: '580px' }}>
            <h3>+ Register Paid &amp; Uncollected Stock / Lay-by</h3>
            <p style={{ opacity: 0.85, fontSize: '0.9rem', marginBottom: '1rem' }}>
              Record goods paid for that will be collected later by truck or customer.
            </p>

            <form onSubmit={handleCreateLayby}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <div className="form-group">
                  <label className="label">Customer Name *</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. VaChigumba (Stand #412)"
                    value={laybyCustomerName}
                    onChange={(e) => setLaybyCustomerName(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="label">Customer Phone *</label>
                  <input
                    type="tel"
                    className="input"
                    placeholder="+263 77..."
                    value={laybyCustomerPhone}
                    onChange={(e) => setLaybyCustomerPhone(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <div className="form-group">
                  <label className="label">Receipt / Order Ref</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="Leave blank for auto-ref"
                    value={laybyReceiptRef}
                    onChange={(e) => setLaybyReceiptRef(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="label">Holding Department</label>
                  <input
                    type="text"
                    className="input"
                    value={laybyDept}
                    onChange={(e) => setLaybyDept(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                <label className="label">Select Product *</label>
                <select
                  className="input"
                  value={laybyProductId}
                  onChange={(e) => {
                    setLaybyProductId(e.target.value);
                    const prod = products.find((p) => String(p.id) === e.target.value);
                    if (prod) setLaybyUnit(prod.baseUnit);
                  }}
                  required
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      [{p.sku}] {p.name} — Current Stock: {formatBulkStock(p.totalStock, p.packagings, p.baseUnit).text}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '1.25rem' }}>
                <div className="form-group">
                  <label className="label">Ordered Qty *</label>
                  <input
                    type="number"
                    className="input"
                    min="0.001"
                    step="any"
                    value={laybyQty}
                    onChange={(e) => setLaybyQty(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="label">Unit *</label>
                  <input
                    type="text"
                    className="input"
                    value={laybyUnit}
                    onChange={(e) => setLaybyUnit(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="label">Total Paid ($ USD) *</label>
                  <input
                    type="number"
                    className="input"
                    min="0"
                    step="0.01"
                    value={laybyTotalPaid}
                    onChange={(e) => setLaybyTotalPaid(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowAddLayby(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                >
                  Save Lay-by Order
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL: ADD CHIKWERETI DEBTOR ================= */}
      {showAddDebtor && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: '540px' }}>
            <h3>+ Record Customer Credit (Chikwereti)</h3>
            <p style={{ opacity: 0.85, fontSize: '0.9rem', marginBottom: '1rem' }}>
              Record goods taken on credit by trusted customers with a repayment due date.
            </p>

            <form onSubmit={handleCreateDebtor}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <div className="form-group">
                  <label className="label">Customer Name *</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. Mai Tanaka or Mr. Dube"
                    value={debName}
                    onChange={(e) => setDebName(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="label">Phone Number *</label>
                  <input
                    type="tel"
                    className="input"
                    placeholder="+263 7..."
                    value={debPhone}
                    onChange={(e) => setDebPhone(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                <label className="label">Items Taken on Credit *</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. 2x 10kg Roller Meal, 2L Cooking Oil, 2kg Sugar"
                  value={debItems}
                  onChange={(e) => setDebItems(e.target.value)}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '1.25rem' }}>
                <div className="form-group">
                  <label className="label">Amount Owed ($ USD) *</label>
                  <input
                    type="number"
                    className="input"
                    min="0.01"
                    step="0.01"
                    value={debBalance}
                    onChange={(e) => setDebBalance(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="label">Credit Limit ($ USD)</label>
                  <input
                    type="number"
                    className="input"
                    min="1"
                    step="0.01"
                    value={debLimit}
                    onChange={(e) => setDebLimit(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="label">Repayment Due Date</label>
                  <input
                    type="date"
                    className="input"
                    value={debDueDate}
                    onChange={(e) => setDebDueDate(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowAddDebtor(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                >
                  Save Credit Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL: REPAY DEBT ================= */}
      {repayingDebtor && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: '440px' }}>
            <h3>Record Debt Repayment</h3>
            <p style={{ opacity: 0.85, fontSize: '0.9rem', marginBottom: '1rem' }}>
              Customer: <strong>{repayingDebtor.customerName}</strong> ({repayingDebtor.phone})
            </p>

            <div style={{ backgroundColor: 'var(--card-subtle-bg, rgba(0,0,0,0.03))', padding: '0.75rem', borderRadius: '6px', marginBottom: '1rem' }}>
              <div>Current Balance Owed: <strong style={{ color: 'var(--danger, #dc2626)', fontSize: '1.1rem' }}>{formatMoney(repayingDebtor.balance, 'USD')}</strong></div>
              <div style={{ fontSize: '0.85rem', opacity: 0.85, marginTop: '0.2rem' }}>Items: {repayingDebtor.itemsSummary}</div>
            </div>

            <form onSubmit={handleRepaySubmit}>
              <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                <label className="label">Amount Paid ($ USD) *</label>
                <input
                  type="number"
                  className="input"
                  min="0.01"
                  max={repayingDebtor.balance}
                  step="0.01"
                  value={repayAmount}
                  onChange={(e) => setRepayAmount(e.target.value)}
                  required
                  style={{ fontSize: '1.15rem', fontWeight: 700 }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setRepayingDebtor(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                >
                  Confirm Payment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL: ISSUE CUSTOMER CHANGE SLIP ================= */}
      {showAddChange && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: '500px' }}>
            <h3>+ Issue Customer Change Slip</h3>
            <p style={{ opacity: 0.85, fontSize: '0.9rem', marginBottom: '1rem' }}>
              Record change owed to a customer when the till has insufficient USD small notes or coins.
            </p>

            <form onSubmit={handleIssueChange}>
              <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                <label className="label">Customer Name</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. Gogo Ndlovu or Walk-In Customer"
                  value={changeCustName}
                  onChange={(e) => setChangeCustName(e.target.value)}
                />
              </div>

              <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                <label className="label">Customer Phone (Optional)</label>
                <input
                  type="tel"
                  className="input"
                  placeholder="+263 7..."
                  value={changeCustPhone}
                  onChange={(e) => setChangeCustPhone(e.target.value)}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1.25rem' }}>
                <div className="form-group">
                  <label className="label">Change Amount ($ USD) *</label>
                  <input
                    type="number"
                    className="input"
                    min="0.01"
                    max="100"
                    step="0.01"
                    value={changeAmount}
                    onChange={(e) => setChangeAmount(e.target.value)}
                    required
                    style={{ fontSize: '1.1rem', fontWeight: 700 }}
                  />
                  <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.35rem' }}>
                    {['0.25', '0.50', '0.75', '1.00', '2.00'].map((val) => (
                      <button
                        type="button"
                        key={val}
                        className="btn btn-sm"
                        style={{ padding: '0.15rem 0.4rem', fontSize: '0.75rem' }}
                        onClick={() => setChangeAmount(val)}
                      >
                        ${val}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="form-group">
                  <label className="label">Till / Department</label>
                  <input
                    type="text"
                    className="input"
                    value={changeDept}
                    onChange={(e) => setChangeDept(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowAddChange(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                >
                  Generate Change Slip
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
