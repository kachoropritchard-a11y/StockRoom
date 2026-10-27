import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type ProductItem, type PurchaseOrderDetail, type PurchaseOrderSummary } from '../api';
import { AccessibleTabs, type TabDefinition } from '../components/AccessibleTabs';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Spinner } from '../components/Spinner';

type ProcTab = 'orders' | 'create-po' | 'suppliers';

export function Procurement() {
  const [searchParams] = useSearchParams();
  const prefillProductId = searchParams.get('productId');

  const [activeTab, setActiveTab] = useState<ProcTab>(prefillProductId ? 'create-po' : 'orders');
  const [suppliers, setSuppliers] = useState<{ id: number; name: string; email: string | null; phone: string | null; active: number }[]>([]);
  const [warehouses, setWarehouses] = useState<{ id: number; name: string }[]>([]);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderSummary[]>([]);
  const [selectedPo, setSelectedPo] = useState<PurchaseOrderDetail | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  // Supplier form
  const [supName, setSupName] = useState('');
  const [supEmail, setSupEmail] = useState('');
  const [supPhone, setSupPhone] = useState('');

  // New PO form
  const [poSupplierId, setPoSupplierId] = useState('');
  const [poWarehouseId, setPoWarehouseId] = useState('');
  const [poRef, setPoRef] = useState('');
  const [poNotes, setPoNotes] = useState('');
  const [poApproveNow, setPoApproveNow] = useState(true);
  const [poProductId, setPoProductId] = useState('');
  const [poUnitId, setPoUnitId] = useState('');
  const [poQty, setPoQty] = useState('50');
  const [poCost, setPoCost] = useState('3.50');

  // Partial / Full Delivery state for selectedPo
  const [grnRef, setGrnRef] = useState('');
  const [deliveryQty, setDeliveryQty] = useState<Record<number, string>>({});
  const [deliveryBatch, setDeliveryBatch] = useState<Record<number, string>>({});
  const [deliveryExpiry, setDeliveryExpiry] = useState<Record<number, string>>({});

  // Confirm Dialog state
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    description: string;
    danger?: boolean;
    run: () => Promise<void>;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, wRes, pRes, poRes] = await Promise.all([
        api.suppliers(),
        api.warehouses(),
        api.products('', { limit: 200 }),
        api.purchaseOrders(statusFilter || undefined),
      ]);
      setSuppliers(sRes);
      setWarehouses(wRes);
      setProducts(pRes.items);
      setPurchaseOrders(poRes.items);
      if (sRes[0]) setPoSupplierId((prev) => prev || String(sRes[0].id));
      if (wRes[0]) setPoWarehouseId((prev) => prev || String(wRes[0].id));
      const initialProduct =
        (prefillProductId && pRes.items.find((x) => String(x.id) === prefillProductId)) || pRes.items[0];
      if (initialProduct) {
        setPoProductId((prev) => {
          if (prev) return prev;
          setPoUnitId(String(initialProduct.baseUnitId));
          setPoCost(String(initialProduct.unitCost || 1));
          return String(initialProduct.id);
        });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, prefillProductId]);

  useEffect(() => {
    load();
    const onSync = () => load();
    window.addEventListener('stockroom:sync', onSync);
    return () => window.removeEventListener('stockroom:sync', onSync);
  }, [load]);

  const currentPoProduct = products.find((p) => String(p.id) === poProductId);
  const availableUnits = currentPoProduct
    ? [
        { id: currentPoProduct.baseUnitId, label: `${currentPoProduct.baseUnit} (base × 1)` },
        ...currentPoProduct.packagings.map((g) => ({ id: g.unitId, label: `${g.unit} (× ${g.factor} ${currentPoProduct.baseUnit})` })),
      ]
    : [];

  async function inspectPo(id: number) {
    setError('');
    try {
      const detail = await api.purchaseOrder(id);
      setSelectedPo(detail);
      setActiveTab('orders');
      setGrnRef(`${detail.reference}-GRN-${detail.receipts.length + 1}`);
      const initialQty: Record<number, string> = {};
      for (const l of detail.lines) {
        initialQty[l.productId] = String(l.remainingQuantity);
      }
      setDeliveryQty(initialQty);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleCreateSupplier(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMsg('');
    try {
      await api.createSupplier({
        name: supName.trim(),
        email: supEmail.trim() || undefined,
        phone: supPhone.trim() || undefined,
      });
      setSupName('');
      setSupEmail('');
      setSupPhone('');
      setMsg('Supplier added.');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleToggleSupplier(s: { id: number; name: string; active: number }) {
    setError('');
    try {
      await api.updateSupplier(s.id, { active: !s.active });
      setMsg(`Supplier "${s.name}" marked ${s.active ? 'inactive' : 'active'}.`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleCreatePo(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMsg('');
    try {
      const created = await api.createPurchaseOrder({
        supplierId: Number(poSupplierId),
        warehouseId: Number(poWarehouseId),
        reference: poRef.trim() || `PO-${Date.now().toString().slice(-5)}`,
        notes: poNotes.trim() || undefined,
        approveImmediately: poApproveNow,
        lines: [
          {
            productId: Number(poProductId),
            unitId: Number(poUnitId),
            orderedQuantity: Number(poQty),
            unitCost: Number(poCost),
          },
        ],
      });
      setPoRef('');
      setPoNotes('');
      setSelectedPo(created);
      setActiveTab('orders');
      setGrnRef(`${created.reference}-GRN-1`);
      setDeliveryQty({ [created.lines[0].productId]: String(created.lines[0].remainingQuantity) });
      setMsg(`Purchase Order ${created.reference} created (${created.status}).`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function promptReceiveDelivery(e: FormEvent) {
    e.preventDefault();
    if (!selectedPo) return;
    const linesToReceive = selectedPo.lines
      .map((l) => ({
        productId: l.productId,
        productName: l.productName,
        unit: l.unit,
        quantity: Number(deliveryQty[l.productId] ?? 0),
        batchNumber: deliveryBatch[l.productId]?.trim() || undefined,
        expiryDate: deliveryExpiry[l.productId]?.trim() || undefined,
      }))
      .filter((l) => l.quantity > 0);

    if (linesToReceive.length === 0) {
      setError('Enter a positive delivery quantity for at least one line item.');
      return;
    }

    const summaryText = linesToReceive.map((l) => `${l.quantity} ${l.unit} of ${l.productName}`).join(', ');
    setConfirmAction({
      title: `Confirm Goods Receipt against ${selectedPo.reference}`,
      description: `Post receipt (${grnRef || 'auto-reference'}) into ${selectedPo.warehouseName} for: ${summaryText}? This will immediately update the authoritative stock ledger.`,
      run: async () => {
        const res = await api.receivePurchaseOrder(selectedPo.id, {
          reference: grnRef.trim() || undefined,
          lines: linesToReceive.map(({ productId, quantity, batchNumber, expiryDate }) => ({
            productId,
            quantity,
            batchNumber,
            expiryDate,
          })),
        });
        setSelectedPo(res.purchaseOrder);
        const nextQty: Record<number, string> = {};
        for (const l of res.purchaseOrder.lines) nextQty[l.productId] = String(l.remainingQuantity);
        setDeliveryQty(nextQty);
        setMsg(`Goods Receipt Document #${res.document.id} posted. PO status is now "${res.purchaseOrder.status}".`);
        await load();
      },
    });
  }

  const tabs: TabDefinition<ProcTab>[] = [
    {
      key: 'orders',
      label: '1. Purchase Orders & Receiving',
      badge: purchaseOrders.length,
      purpose: 'View purchase orders, approve drafts, and receive partial or full deliveries directly into warehouse stock.',
    },
    {
      key: 'create-po',
      label: '2. + Create Purchase Order',
      purpose: 'Issue a new Purchase Order to a supplier with destination warehouse, unit conversion and agreed cost.',
    },
    {
      key: 'suppliers',
      label: '3. Supplier Directory',
      badge: suppliers.length,
      purpose: 'Manage approved suppliers, contact emails/phones, and active status.',
    },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Suppliers, Purchase Orders &amp; Receiving</h1>
          <p className="muted">Manage suppliers, issue purchase orders, and record full or partial deliveries into warehouse stock.</p>
        </div>
        <div className="quick-actions">
          <button type="button" className="btn btn-primary" onClick={() => setActiveTab('create-po')}>
            + New Purchase Order
          </button>
          <button type="button" className="btn btn-outline" onClick={() => setActiveTab('suppliers')}>
            Supplier Directory
          </button>
        </div>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      {msg && <p className="form-success" role="status">{msg}</p>}

      <section className="card">
        <AccessibleTabs
          idPrefix="procurement"
          ariaLabel="Procurement and supplier tabs"
          tabs={tabs}
          active={activeTab}
          onChange={setActiveTab}
        />

        {/* TAB 1: Purchase Orders & Receiving */}
        {activeTab === 'orders' && (
          <div id="procurement-panel-orders" role="tabpanel" aria-labelledby="procurement-tab-orders">
            <div className="section-head">
              <h2>Purchase Orders ({purchaseOrders.length})</h2>
              <select
                aria-label="Filter purchase orders by status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">All Statuses</option>
                <option value="draft">Draft</option>
                <option value="approved">Approved (Ready to Receive)</option>
                <option value="partial">Partial Delivery</option>
                <option value="received">Fully Received</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            {loading ? (
              <Spinner label="Loading purchase orders" />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>PO Ref</th>
                      <th>Supplier</th>
                      <th>Destination Warehouse</th>
                      <th className="num">Order Value</th>
                      <th>Status</th>
                      <th>Created</th>
                      <th className="num">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchaseOrders.map((po) => (
                      <tr key={po.id}>
                        <td><strong>{po.reference}</strong></td>
                        <td>{po.supplierName}</td>
                        <td>{po.warehouseName}</td>
                        <td className="num">${po.totalValue.toFixed(2)}</td>
                        <td>
                          <span className={`badge badge-${po.status === 'received' ? 'receipt' : po.status === 'partial' ? 'transfer' : po.status === 'cancelled' ? 'write_off' : 'count'}`}>
                            {po.status}
                          </span>
                        </td>
                        <td>{po.createdAt.slice(0, 10)}</td>
                        <td className="num">
                          <div className="action-row" style={{ justifyContent: 'flex-end' }}>
                            <button type="button" className="btn btn-outline btn-sm" onClick={() => inspectPo(po.id)}>
                              {po.status === 'approved' || po.status === 'partial' ? 'Receive / Inspect' : 'Inspect'}
                            </button>
                            {po.status === 'draft' && (
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                onClick={() =>
                                  setConfirmAction({
                                    title: `Approve Purchase Order ${po.reference}`,
                                    description: `Approve ${po.reference} (${po.supplierName}) so warehouse staff can receive deliveries against it?`,
                                    run: async () => {
                                      const updated = await api.approvePurchaseOrder(po.id);
                                      setSelectedPo(updated);
                                      setMsg(`Purchase Order ${po.reference} approved.`);
                                      await load();
                                    },
                                  })
                                }
                              >
                                Approve
                              </button>
                            )}
                            {(po.status === 'draft' || po.status === 'approved') && (
                              <button
                                type="button"
                                className="btn btn-outline btn-sm"
                                onClick={() =>
                                  setConfirmAction({
                                    title: `Cancel Purchase Order ${po.reference}`,
                                    description: `Are you sure you want to cancel ${po.reference}? No deliveries will be permitted once cancelled.`,
                                    danger: true,
                                    run: async () => {
                                      const updated = await api.cancelPurchaseOrder(po.id);
                                      setSelectedPo(updated);
                                      setMsg(`Purchase Order ${po.reference} cancelled.`);
                                      await load();
                                    },
                                  })
                                }
                              >
                                Cancel
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {purchaseOrders.length === 0 && (
                      <tr>
                        <td colSpan={7} className="muted">No purchase orders match this filter.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {selectedPo && (
              <div className="subcard" style={{ marginTop: '1.25rem' }}>
                <div className="section-head">
                  <div>
                    <h3>
                      {selectedPo.reference} — {selectedPo.supplierName} → {selectedPo.warehouseName} ({selectedPo.status})
                    </h3>
                    {selectedPo.notes && <p className="muted" style={{ margin: '.25rem 0 0' }}>{selectedPo.notes}</p>}
                  </div>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setSelectedPo(null)}>
                    Close Panel
                  </button>
                </div>

                <form onSubmit={promptReceiveDelivery}>
                  <div className="table-wrap" style={{ marginTop: '.75rem' }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>SKU</th>
                          <th>Product</th>
                          <th>Fulfillment Progress</th>
                          <th className="num">Remaining</th>
                          <th className="num">Unit Cost</th>
                          {(selectedPo.status === 'approved' || selectedPo.status === 'partial') && (
                            <>
                              <th>Receive Now</th>
                              <th>Batch / Lot</th>
                              <th>Expiry Date</th>
                            </>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {selectedPo.lines.map((l) => {
                          const pct = Math.min(100, Math.round((l.receivedQuantity / Math.max(1, l.orderedQuantity)) * 100));
                          return (
                            <tr key={l.id}>
                              <td><code>{l.sku}</code></td>
                              <td><strong>{l.productName}</strong></td>
                              <td style={{ minWidth: '160px' }}>
                                <div className="stock-level-cell">
                                  <div className="stock-bar-track">
                                    <div className="stock-bar-fill optimal" style={{ width: `${pct}%` }} />
                                  </div>
                                  <span className="stock-level-num">
                                    {l.receivedQuantity} / {l.orderedQuantity} {l.unit}
                                  </span>
                                </div>
                              </td>
                              <td className="num"><strong>{l.remainingQuantity} {l.unit}</strong></td>
                              <td className="num">${l.unitCost.toFixed(2)}</td>
                              {(selectedPo.status === 'approved' || selectedPo.status === 'partial') && (
                                <>
                                  <td>
                                    <input
                                      type="number"
                                      step="0.001"
                                      min="0"
                                      max={l.remainingQuantity}
                                      disabled={l.remainingQuantity <= 0}
                                      value={deliveryQty[l.productId] ?? '0'}
                                      onChange={(e) => setDeliveryQty((prev) => ({ ...prev, [l.productId]: e.target.value }))}
                                      style={{ maxWidth: '110px' }}
                                    />
                                  </td>
                                  <td>
                                    <input
                                      placeholder="Batch #"
                                      disabled={l.remainingQuantity <= 0}
                                      value={deliveryBatch[l.productId] ?? ''}
                                      onChange={(e) => setDeliveryBatch((prev) => ({ ...prev, [l.productId]: e.target.value }))}
                                      style={{ maxWidth: '130px' }}
                                    />
                                  </td>
                                  <td>
                                    <input
                                      type="date"
                                      disabled={l.remainingQuantity <= 0}
                                      value={deliveryExpiry[l.productId] ?? ''}
                                      onChange={(e) => setDeliveryExpiry((prev) => ({ ...prev, [l.productId]: e.target.value }))}
                                    />
                                  </td>
                                </>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {(selectedPo.status === 'approved' || selectedPo.status === 'partial') && (
                    <div className="inline-form" style={{ marginTop: '1rem' }}>
                      <input
                        value={grnRef}
                        onChange={(e) => setGrnRef(e.target.value)}
                        placeholder="Goods Receipt Reference (e.g. GRN-2026-104)"
                        style={{ maxWidth: '280px' }}
                      />
                      <button type="submit" className="btn btn-primary">
                        Post Delivery to Warehouse Stock
                      </button>
                    </div>
                  )}
                </form>

                {selectedPo.receipts.length > 0 && (
                  <p className="muted" style={{ marginTop: '.75rem', marginBottom: 0 }}>
                    Posted Receipt Documents:{' '}
                    {selectedPo.receipts.map((r) => `#${r.documentId} (${r.reference ?? 'GRN'} on ${r.createdAt.slice(0, 10)})`).join(' • ')}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: Create Purchase Order */}
        {activeTab === 'create-po' && (
          <div id="procurement-panel-create-po" role="tabpanel" aria-labelledby="procurement-tab-create-po">
            <h2>Issue New Purchase Order</h2>
            <form className="form-grid" onSubmit={handleCreatePo}>
              <label>
                Supplier
                <select value={poSupplierId} onChange={(e) => setPoSupplierId(e.target.value)} required>
                  {suppliers.filter((s) => s.active).map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Destination Warehouse
                <select value={poWarehouseId} onChange={(e) => setPoWarehouseId(e.target.value)} required>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </label>
              <label>
                PO Reference
                <input value={poRef} onChange={(e) => setPoRef(e.target.value)} placeholder="e.g. PO-2026-108" required />
              </label>
              <label>
                Product
                <select
                  value={poProductId}
                  onChange={(e) => {
                    setPoProductId(e.target.value);
                    const p = products.find((x) => String(x.id) === e.target.value);
                    if (p) {
                      setPoUnitId(String(p.baseUnitId));
                      setPoCost(String(p.unitCost || 1));
                    }
                  }}
                  required
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku}) — On hand: {p.totalStock} {p.baseUnit}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Order Unit
                <select value={poUnitId} onChange={(e) => setPoUnitId(e.target.value)} required>
                  {availableUnits.map((u) => (
                    <option key={u.id} value={u.id}>{u.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Ordered Quantity
                <input type="number" step="0.001" min="0.001" value={poQty} onChange={(e) => setPoQty(e.target.value)} required />
              </label>
              <label>
                Unit Cost (USD)
                <input type="number" step="0.01" min="0" value={poCost} onChange={(e) => setPoCost(e.target.value)} required />
              </label>
              <label>
                Delivery Notes
                <input value={poNotes} onChange={(e) => setPoNotes(e.target.value)} placeholder="Optional supplier instructions" />
              </label>
              <label className="checkbox-row">
                <input type="checkbox" checked={poApproveNow} onChange={(e) => setPoApproveNow(e.target.checked)} />
                <span>Approve immediately for receiving</span>
              </label>
              <div className="form-actions">
                <button className="btn btn-primary" type="submit">Create Purchase Order</button>
              </div>
            </form>
          </div>
        )}

        {/* TAB 3: Supplier Directory */}
        {activeTab === 'suppliers' && (
          <div id="procurement-panel-suppliers" role="tabpanel" aria-labelledby="procurement-tab-suppliers">
            <div className="subcard" style={{ marginBottom: '1.25rem' }}>
              <h3>Add New Supplier</h3>
              <form className="form-grid" onSubmit={handleCreateSupplier}>
                <label>
                  Supplier Name
                  <input value={supName} onChange={(e) => setSupName(e.target.value)} placeholder="e.g. Dairibord Zimbabwe" required />
                </label>
                <label>
                  Email
                  <input type="email" value={supEmail} onChange={(e) => setSupEmail(e.target.value)} placeholder="orders@supplier.co.zw" />
                </label>
                <label>
                  Phone
                  <input value={supPhone} onChange={(e) => setSupPhone(e.target.value)} placeholder="+263 242 700000" />
                </label>
                <div className="form-actions">
                  <button className="btn btn-primary" type="submit">+ Add Supplier</button>
                </div>
              </form>
            </div>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Supplier</th>
                    <th>Contact</th>
                    <th>Status</th>
                    <th className="num">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {suppliers.map((s) => (
                    <tr key={s.id}>
                      <td><strong>{s.name}</strong></td>
                      <td>{[s.email, s.phone].filter(Boolean).join(' • ') || '—'}</td>
                      <td>
                        <span className={`status-pill ${s.active ? 'optimal' : 'out'}`}>
                          {s.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="num">
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => handleToggleSupplier(s)}>
                          {s.active ? 'Deactivate' : 'Activate'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={!!confirmAction}
        title={confirmAction?.title ?? ''}
        description={confirmAction?.description ?? ''}
        danger={confirmAction?.danger}
        busy={busy}
        onCancel={() => setConfirmAction(null)}
        onConfirm={async () => {
          if (!confirmAction) return;
          setBusy(true);
          setError('');
          try {
            await confirmAction.run();
            setConfirmAction(null);
          } catch (err) {
            setError((err as Error).message);
            setConfirmAction(null);
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}
