import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type ProductItem, type PurchaseOrderSummary } from '../api';
import { AccessibleTabs, type TabDefinition } from '../components/AccessibleTabs';
import { Spinner } from '../components/Spinner';
import { useZim } from '../zimContext';

type IntakeSubTab = 'intake' | 'history' | 'creditors';

interface CreditorItem {
  id: number;
  supplierId: number | null;
  supplierName: string;
  invoiceRef: string;
  departmentName: string;
  totalAmount: number;
  paidAmount: number;
  balanceOwed: number;
  currencyCode: string;
  dueDate: string | null;
  notes: string | null;
  status: string;
  updatedAt: string;
}

export function StockIntake() {
  const { subLabel, formatMoney } = useZim();
  const [activeTab, setActiveTab] = useState<IntakeSubTab>('intake');

  const [products, setProducts] = useState<ProductItem[]>([]);
  const [warehouses, setWarehouses] = useState<{ id: number; name: string }[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: number; name: string; phone?: string | null }[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderSummary[]>([]);
  const [creditors, setCreditors] = useState<CreditorItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  // Fast Intake Form State
  const [supplierId, setSupplierId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [invoiceRef, setInvoiceRef] = useState('');
  const [productId, setProductId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [quantity, setQuantity] = useState('10');
  const [unitCost, setUnitCost] = useState('2.50');
  const [batchNum, setBatchNum] = useState('');
  const [busy, setBusy] = useState(false);

  // New Supplier Quick Modal State
  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [newSupName, setNewSupName] = useState('');
  const [newSupPhone, setNewSupPhone] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, wRes, sRes, poRes, smeRes] = await Promise.all([
        api.products('', { limit: 200 }),
        api.warehouses(),
        api.suppliers(),
        api.purchaseOrders(),
        api.smeOverview().catch(() => null),
      ]);
      setProducts(pRes.items);
      setWarehouses(wRes);
      setSuppliers(sRes);
      setPurchaseOrders(poRes.items);
      if (smeRes) setCreditors(smeRes.creditors || []);

      if (wRes[0]) setWarehouseId((prev) => prev || String(wRes[0].id));
      if (sRes[0]) setSupplierId((prev) => prev || String(sRes[0].id));
      if (pRes.items[0]) {
        const first = pRes.items[0];
        setProductId((prev) => {
          if (prev) return prev;
          setUnitId(String(first.baseUnitId));
          setUnitCost(first.unitCost.toFixed(2));
          return String(first.id);
        });
      }
    } catch (err) {
      setError((err as Error).message);
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

  const selectedProduct = products.find((p) => String(p.id) === productId);
  const availableUnits = selectedProduct
    ? [
        { id: selectedProduct.baseUnitId, label: `${selectedProduct.baseUnit} (Base Single Unit × 1)`, factor: 1 },
        ...selectedProduct.packagings.map((g) => ({
          id: g.unitId,
          label: `${g.unit} (Bulk Pack × ${g.factor} ${selectedProduct.baseUnit})`,
          factor: g.factor,
        })),
      ]
    : [];

  const selectedUnitObj = availableUnits.find((u) => String(u.id) === unitId) ?? availableUnits[0];
  const factor = selectedUnitObj?.factor ?? 1;
  const qtyEntered = Math.max(0, Number(quantity) || 0);
  const costEntered = Math.max(0, Number(unitCost) || 0);
  const totalCost = qtyEntered * costEntered;
  const totalSinglesAdded = qtyEntered * factor;
  const trueCostPerSingle = totalSinglesAdded > 0 ? totalCost / totalSinglesAdded : 0;

  async function handleFastIntake(e: FormEvent) {
    e.preventDefault();
    if (!supplierId || !warehouseId || !productId || qtyEntered <= 0) {
      setError('Please select supplier, store location, product, and positive quantity.');
      return;
    }
    setError('');
    setMsg('');
    setBusy(true);
    try {
      const ref = invoiceRef.trim() || `GRN-${Date.now().toString().slice(-6)}`;
      const res = await api.postStock('receipts', {
        warehouseId: Number(warehouseId),
        supplierId: Number(supplierId),
        reference: ref,
        lines: [
          {
            productId: Number(productId),
            unitId: Number(unitId),
            quantity: qtyEntered,
            unitCost: costEntered,
            batchNumber: batchNum.trim() || undefined,
          },
        ],
      });

      setMsg(
        `✓ Stock Intake #${res.document.id} (${ref}) posted: +${totalSinglesAdded} ${selectedProduct?.baseUnit ?? 'units'} automatically credited to inventory!`,
      );
      setInvoiceRef('');
      setBatchNum('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleAddSupplier(e: FormEvent) {
    e.preventDefault();
    if (!newSupName.trim()) return;
    try {
      const res = await api.createSupplier({ name: newSupName.trim(), phone: newSupPhone.trim() || undefined });
      const newSup = {
        id: res.id,
        name: newSupName.trim(),
        phone: newSupPhone.trim() || null,
      };
      setSuppliers((prev) => [...prev, newSup]);
      setSupplierId(String(res.id));
      setNewSupName('');
      setNewSupPhone('');
      setShowAddSupplier(false);
      setMsg(`Supplier "${newSup.name}" added successfully.`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const tabs: TabDefinition<IntakeSubTab>[] = [
    {
      key: 'intake',
      label: '1. Fast Stock Intake (GRN)',
      badge: undefined,
      purpose: 'Record goods bought from suppliers and automatically break bulk into single shelf units.',
    },
    {
      key: 'history',
      label: '2. Purchase Orders & Deliveries',
      badge: purchaseOrders.length,
      purpose: 'Track supplier delivery notes, purchase orders, and receiving history.',
    },
    {
      key: 'creditors',
      label: '3. Supplier Balances Owed',
      badge: creditors.filter((c) => c.status !== 'SETTLED').length,
      purpose: 'Manage trade credit and balances owed to suppliers.',
    },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Stock Intake Deck</h1>
          <span className="vernacular-sub">
            {subLabel(
              'Kugamuchira Zvinhu Zvakatengwa muSystem • Kupatsanura Mabhero Nekukasira',
              'Ukungena Kwempahla Yesitolo • Ukwamukela Impahla Ethengiweyo',
            )}
          </span>
        </div>
        <div className="quick-actions">
          <button type="button" className="btn btn-outline" onClick={() => setShowAddSupplier(true)}>
            + Add New Supplier
          </button>
        </div>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      {msg && <p className="form-success" role="status">{msg}</p>}

      {/* Quick Add Supplier Modal */}
      {showAddSupplier && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="add-supplier-title">
          <div className="modal-card animate-scale-up" style={{ maxWidth: '420px' }}>
            <div className="modal-header">
              <h3 id="add-supplier-title" style={{ margin: 0 }}>Add New Goods Supplier</h3>
              <button type="button" className="btn btn-ghost" onClick={() => setShowAddSupplier(false)}>✕</button>
            </div>
            <form onSubmit={handleAddSupplier} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <label>
                Supplier / Business Name
                <input
                  type="text"
                  placeholder="e.g. National Foods Ltd"
                  value={newSupName}
                  onChange={(e) => setNewSupName(e.target.value)}
                  required
                  autoFocus
                />
              </label>
              <label>
                Phone / WhatsApp Number
                <input
                  type="text"
                  placeholder="e.g. +263 772 123 456"
                  value={newSupPhone}
                  onChange={(e) => setNewSupPhone(e.target.value)}
                />
              </label>
              <div className="form-actions" style={{ marginTop: '0.5rem' }}>
                <button type="button" className="btn btn-outline" onClick={() => setShowAddSupplier(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save Supplier</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <section className="card">
        {/* TIER 3: Horizontal In-Page Sub-Menu Bar */}
        <AccessibleTabs
          idPrefix="stock-intake"
          ariaLabel="Stock intake sections"
          tabs={tabs}
          active={activeTab}
          onChange={setActiveTab}
        />

        {/* SUB-MENU 1: Fast Stock Intake (GRN) */}
        {activeTab === 'intake' && (
          <div id="stock-intake-panel-intake" role="tabpanel" aria-labelledby="stock-intake-tab-intake">
            <div
              className="subcard"
              style={{
                marginBottom: '1.25rem',
                borderLeft: '4px solid var(--emerald)',
                background: 'var(--surface-alt)',
              }}
            >
              <h3 style={{ margin: '0 0 0.35rem', color: 'var(--charcoal)' }}>
                Direct Supplier Stock Intake (Goods Received Note)
              </h3>
              <p style={{ margin: 0, fontSize: '0.86rem', color: 'var(--muted)', lineHeight: 1.5 }}>
                Enter stock purchased from wholesale suppliers or distributors. If you receive goods in bulk cartons,
                bales, or crates, select the container unit and the system will automatically break bulk into individual
                shelf units in real-time.
              </p>
            </div>

            <form className="form-grid subcard" style={{ marginBottom: '1.25rem' }} onSubmit={handleFastIntake}>
              <label>
                Supplier
                <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Receiving Store / Yard
                <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Supplier Invoice / Receipt Ref
                <input
                  type="text"
                  placeholder="e.g. INV-88219 or NF-0412"
                  value={invoiceRef}
                  onChange={(e) => setInvoiceRef(e.target.value)}
                />
              </label>

              <label>
                Product Received
                <select
                  value={productId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setProductId(id);
                    const p = products.find((x) => String(x.id) === id);
                    if (p) {
                      setUnitId(String(p.baseUnitId));
                      setUnitCost(p.unitCost.toFixed(2));
                    }
                  }}
                  required
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku}) — Stock: {p.totalStock} {p.baseUnit}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Container / Packaging Unit
                <select value={unitId} onChange={(e) => setUnitId(e.target.value)} required>
                  {availableUnits.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Quantity Received ({selectedUnitObj?.label ? selectedUnitObj.label.split(' ')[0] : 'units'})
                <input
                  type="number"
                  min="0.001"
                  step="any"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  required
                />
              </label>

              <label>
                Unit Purchase Price ($ USD)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={unitCost}
                  onChange={(e) => setUnitCost(e.target.value)}
                  required
                />
              </label>

              <label>
                Batch / Expiry / Lot Code (Optional)
                <input
                  type="text"
                  placeholder="e.g. BATCH-2026-11"
                  value={batchNum}
                  onChange={(e) => setBatchNum(e.target.value)}
                />
              </label>

              {/* Automatic Break-Bulk Calculation Preview */}
              <div
                style={{
                  gridColumn: '1 / -1',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '1rem',
                  padding: '1rem',
                  background: 'var(--surface)',
                  border: '1.5px solid var(--line)',
                  borderRadius: '10px',
                }}
              >
                <div>
                  <span className="muted" style={{ fontSize: '0.78rem', textTransform: 'uppercase' }}>
                    Total Invoice Amount
                  </span>
                  <div style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--charcoal)', marginTop: '0.2rem' }}>
                    {formatMoney(totalCost)}
                  </div>
                  <span className="muted" style={{ fontSize: '0.75rem' }}>
                    {formatMoney(totalCost, 'ZiG')} · {formatMoney(totalCost, 'ZAR')}
                  </span>
                </div>

                <div>
                  <span className="muted" style={{ fontSize: '0.78rem', textTransform: 'uppercase' }}>
                    Auto Break-Bulk Shelf Units
                  </span>
                  <div style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--emerald)', marginTop: '0.2rem' }}>
                    +{totalSinglesAdded.toLocaleString()} {selectedProduct?.baseUnit ?? 'singles'}
                  </div>
                  <span className="muted" style={{ fontSize: '0.75rem' }}>
                    Ratio: 1 {selectedUnitObj?.label ? selectedUnitObj.label.split(' ')[0] : 'pack'} = {factor}{' '}
                    {selectedProduct?.baseUnit}
                  </span>
                </div>

                <div>
                  <span className="muted" style={{ fontSize: '0.78rem', textTransform: 'uppercase' }}>
                    True Single Unit Cost
                  </span>
                  <div style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--charcoal)', marginTop: '0.2rem' }}>
                    {formatMoney(trueCostPerSingle)}
                  </div>
                  <span className="muted" style={{ fontSize: '0.75rem' }}>
                    Suggested Retail: {formatMoney(trueCostPerSingle * 1.3)} (30% margin)
                  </span>
                </div>
              </div>

              <div className="form-actions" style={{ gridColumn: '1 / -1' }}>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? 'Posting to Ledger…' : '✓ Receive Stock into System'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* SUB-MENU 2: Purchase Orders & Intake History */}
        {activeTab === 'history' && (
          <div id="stock-intake-panel-history" role="tabpanel" aria-labelledby="stock-intake-tab-history">
            <div className="section-head" style={{ marginBottom: '0.75rem' }}>
              <div>
                <h3 style={{ margin: 0 }}>Goods Intake &amp; Purchase Orders History</h3>
                <span className="vernacular-sub" style={{ fontSize: '0.82rem' }}>
                  Authoritative record of supplier orders, delivery statuses, and completed intake receipts.
                </span>
              </div>
            </div>

            {loading ? (
              <div style={{ padding: '3rem', textAlign: 'center' }}>
                <Spinner label="Loading purchase orders" />
                <p className="muted" style={{ marginTop: '0.5rem' }}>Loading intake history…</p>
              </div>
            ) : purchaseOrders.length === 0 ? (
              <div className="empty-state-box" style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
                <p className="muted" style={{ margin: 0 }}>
                  No supplier orders logged yet. Use the Fast Stock Intake tab to record your first delivery.
                </p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>PO / Ref #</th>
                      <th>Supplier</th>
                      <th>Store Location</th>
                      <th className="num">Line Items</th>
                      <th className="num">Total Value</th>
                      <th>Status</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchaseOrders.map((po) => (
                      <tr key={po.id}>
                        <td>
                          <code>{po.reference}</code>
                        </td>
                        <td>
                          <strong>{po.supplierName}</strong>
                        </td>
                        <td>{po.warehouseName}</td>
                        <td className="num">{po.lineCount}</td>
                        <td className="num">
                          <strong>{formatMoney(po.totalValue)}</strong>
                        </td>
                        <td>
                          <span
                            className={`status-pill ${
                              po.status === 'received'
                                ? 'optimal'
                                : po.status === 'approved'
                                ? 'warn'
                                : 'low'
                            }`}
                          >
                            {po.status.toUpperCase()}
                          </span>
                        </td>
                        <td>{po.createdAt.slice(0, 10)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* SUB-MENU 3: Supplier Balances Owed */}
        {activeTab === 'creditors' && (
          <div id="stock-intake-panel-creditors" role="tabpanel" aria-labelledby="stock-intake-tab-creditors">
            <div className="section-head" style={{ marginBottom: '0.75rem' }}>
              <div>
                <h3 style={{ margin: 0 }}>Supplier Trade Credit &amp; Balances Owed</h3>
                <span className="vernacular-sub" style={{ fontSize: '0.82rem' }}>
                  Unsettled supplier invoices and delivery balances.
                </span>
              </div>
            </div>

            {creditors.length === 0 ? (
              <div className="empty-state-box" style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
                <p className="muted" style={{ margin: 0 }}>
                  ✓ All supplier invoices are settled. No trade credit balances currently owed.
                </p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Supplier</th>
                      <th>Invoice Ref</th>
                      <th>Department Scope</th>
                      <th className="num">Total Billed</th>
                      <th className="num">Paid</th>
                      <th className="num">Balance Owed</th>
                      <th>Due Date</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {creditors.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <strong>{c.supplierName}</strong>
                        </td>
                        <td>
                          <code>{c.invoiceRef}</code>
                        </td>
                        <td>{c.departmentName}</td>
                        <td className="num">{formatMoney(c.totalAmount)}</td>
                        <td className="num">{formatMoney(c.paidAmount)}</td>
                        <td className="num neg">
                          <strong style={{ color: c.balanceOwed > 0 ? 'var(--danger)' : 'var(--emerald)' }}>
                            {formatMoney(c.balanceOwed)}
                          </strong>
                        </td>
                        <td>{c.dueDate || '—'}</td>
                        <td>
                          <span
                            className={`status-pill ${
                              c.status === 'SETTLED' ? 'optimal' : c.status === 'PARTIAL' ? 'warn' : 'low'
                            }`}
                          >
                            {c.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>
    </>
  );
}
