import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type ProductItem, type PurchaseOrderDetail, type PurchaseOrderSummary } from '../api';
import { AccessibleTabs, type TabDefinition } from '../components/AccessibleTabs';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Spinner } from '../components/Spinner';
import { useZim } from '../zimContext';

type ReceivingSubTab = 'wizard' | 'landed' | 'creditors';

interface SupplierCreditorItem {
  id: number;
  supplierName: string;
  contact: string;
  invoiceRef: string;
  totalUsd: number;
  paidUsd: number;
  dueDate: string;
}

export function Procurement() {
  const [searchParams] = useSearchParams();
  const prefillProductId = searchParams.get('productId');
  const { formatMoney, subLabel, rates } = useZim();

  const [activeTab, setActiveTab] = useState<ReceivingSubTab>('wizard');
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
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
  const [supPhone, setSupPhone] = useState('');
  const [creditors, setCreditors] = useState<SupplierCreditorItem[]>([]);

  // New PO / GRN Wizard form (with Multi-Line invoice support)
  const [poSupplierId, setPoSupplierId] = useState('');
  const [poWarehouseId, setPoWarehouseId] = useState('');
  const [poRef, setPoRef] = useState('');
  const [poNotes, setPoNotes] = useState('');
  const [poApproveNow, setPoApproveNow] = useState(true);
  const [poProductId, setPoProductId] = useState('');
  const [poUnitId, setPoUnitId] = useState('');
  const [poQty, setPoQty] = useState('50');
  const [poCost, setPoCost] = useState('3.50');
  const [poCartLines, setPoCartLines] = useState<
    { productId: number; productName: string; unitId: number; unitLabel: string; orderedQuantity: number; unitCost: number }[]
  >([]);

  // Cross-Border Landed Cost Calculator state (Musina/Joburg/Lusaka/Dar es Salaam -> Zimbabwe)
  const [cbCurrency, setCbCurrency] = useState<'ZAR' | 'USD'>('ZAR');
  const [cbWholesaleTotal, setCbWholesaleTotal] = useState('18200'); // e.g. R18,200 in Musina
  const [cbUnitsCount, setCbUnitsCount] = useState('200');
  const [cbZimraDutyUsd, setCbZimraDutyUsd] = useState('140');
  const [cbRunnerFreightUsd, setCbRunnerFreightUsd] = useState('85');
  const [cbTargetMarginPct, setCbTargetMarginPct] = useState('25');

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
      const [sRes, wRes, pRes, poRes, smeRes] = await Promise.all([
        api.suppliers(),
        api.warehouses(),
        api.products('', { limit: 200 }),
        api.purchaseOrders(statusFilter || undefined),
        api.smeOverview().catch(() => null),
      ]);
      setSuppliers(sRes);
      setWarehouses(wRes);
      setProducts(pRes.items);
      setPurchaseOrders(poRes.items);
      if (smeRes) {
        setCreditors(
          (smeRes.creditors || []).map((c) => ({
            id: c.id,
            supplierName: c.supplierName,
            contact: c.notes ?? c.departmentName,
            invoiceRef: c.invoiceRef,
            totalUsd: c.totalAmount,
            paidUsd: c.paidAmount,
            dueDate: c.status === 'SETTLED' ? 'Paid in Full' : c.dueDate,
          })),
        );
      }
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
      setActiveTab('wizard');
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
        phone: supPhone.trim() || undefined,
      });
      setSupName('');
      setSupPhone('');
      setMsg('Supplier added to directory.');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function addCurrentItemToPoBasket() {
    if (!currentPoProduct) return;
    const uObj = availableUnits.find((u) => String(u.id) === poUnitId) ?? availableUnits[0];
    if (!uObj) return;
    const qtyNum = Number(poQty);
    const costNum = Number(poCost);
    if (qtyNum <= 0 || costNum < 0) return;
    setPoCartLines((prev) => {
      const filtered = prev.filter((x) => x.productId !== currentPoProduct.id);
      return [
        ...filtered,
        {
          productId: currentPoProduct.id,
          productName: currentPoProduct.name,
          unitId: uObj.id,
          unitLabel: uObj.label,
          orderedQuantity: qtyNum,
          unitCost: costNum,
        },
      ];
    });
  }

  async function handleCreatePo(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMsg('');
    try {
      const linesPayload =
        poCartLines.length > 0
          ? poCartLines.map((l) => ({
              productId: l.productId,
              unitId: l.unitId,
              orderedQuantity: l.orderedQuantity,
              unitCost: l.unitCost,
            }))
          : [
              {
                productId: Number(poProductId),
                unitId: Number(poUnitId),
                orderedQuantity: Number(poQty),
                unitCost: Number(poCost),
              },
            ];

      const created = await api.createPurchaseOrder({
        supplierId: Number(poSupplierId),
        warehouseId: Number(poWarehouseId),
        reference: poRef.trim() || `PO-${Date.now().toString().slice(-5)}`,
        notes: poNotes.trim() || undefined,
        approveImmediately: poApproveNow,
        lines: linesPayload,
      });
      setPoRef('');
      setPoNotes('');
      setPoCartLines([]);
      setSelectedPo(created);
      setWizardStep(1);
      setGrnRef(`${created.reference}-GRN-1`);
      const nextMap: Record<number, string> = {};
      for (const l of created.lines) nextMap[l.productId] = String(l.remainingQuantity);
      setDeliveryQty(nextMap);
      setMsg(`Purchase Order ${created.reference} created with ${created.lines.length} item(s) (${created.status}). Ready to receive below.`);
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

  // Landed Cost calculations
  const wholesaleNum = Number(cbWholesaleTotal) || 0;
  const wholesaleUsd = cbCurrency === 'ZAR' ? wholesaleNum / Math.max(1, rates.ZAR) : wholesaleNum;
  const dutyUsd = Number(cbZimraDutyUsd) || 0;
  const freightUsd = Number(cbRunnerFreightUsd) || 0;
  const totalLandedUsd = wholesaleUsd + dutyUsd + freightUsd;
  const qtyUnits = Math.max(1, Number(cbUnitsCount) || 1);
  const trueUnitCostUsd = totalLandedUsd / qtyUnits;
  const marginPct = Number(cbTargetMarginPct) || 0;
  const recommendedSellUsd = trueUnitCostUsd * (1 + marginPct / 100);

  const tabs: TabDefinition<ReceivingSubTab>[] = [
    {
      key: 'wizard',
      label: '1. 1-2-3 Guided Goods Receiving Wizard',
      badge: purchaseOrders.length,
      purpose: 'Step-by-step Goods Received Note (GRN) wizard and Purchase Order delivery receiving with zero accounting jargon.',
    },
    {
      key: 'landed',
      label: '2. Cross-Border Landed Cost Calculator',
      purpose: 'Calculate true unit cost from ZAR/USD wholesale price + ZIMRA Beitbridge/Chirundu customs duty + runner/bus freight.',
    },
    {
      key: 'creditors',
      label: '3. Supplier Balances Owed (Creditors)',
      badge: creditors.length,
      purpose: 'Track supplier invoices, partial payments, and remaining balances owed to wholesalers and cross-border runners.',
    },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Receiving (GRN), Cross-Border Landed Cost &amp; Suppliers</h1>
          <span className="vernacular-sub">
            {subLabel(
              'Kugamuchira Zvinhu (GRN) • Kuverenga Mutengo weBorder (Beitbridge/Musina) • Chikwereti cheVatengesi',
              'Ukuthola Impahla (GRN) • Ukubala Intengo YaseBorder • Izikwelede Zabathengisi',
            )}
          </span>
        </div>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      {msg && <p className="form-success" role="status">{msg}</p>}

      <section className="card">
        {/* TIER 3: Horizontal In-Page Sub-Menu Bar */}
        <AccessibleTabs
          idPrefix="procurement"
          ariaLabel="Receiving and supplier sub-menus"
          tabs={tabs}
          active={activeTab}
          onChange={setActiveTab}
        />

        {/* SUB-MENU 1: 1-2-3 Guided Goods Receiving Wizard */}
        {activeTab === 'wizard' && (
          <div id="procurement-panel-wizard" role="tabpanel" aria-labelledby="procurement-tab-wizard">
            {/* Step-by-Step Guided 1-2-3 Wizard Card */}
            <div className="subcard" style={{ marginBottom: '1.35rem', borderLeft: '4px solid var(--emerald)' }}>
              <div className="section-head">
                <div>
                  <h3>1-2-3 Guided Goods Receiving / New Order Wizard</h3>
                  <span className="vernacular-sub">
                    {subLabel(
                      'Nhanho 1: Sarudza Mutengesi → Nhanho 2: Sarudza Chinhu → Nhanho 3: Gamuchira',
                      'Igxathu 1: Khetha Umthengisi → Igxathu 2: Khetha Impahla → Igxathu 3:amukela',
                    )}
                  </span>
                </div>
                <div className="topbar-seg-group">
                  <button type="button" className={`topbar-seg-btn ${wizardStep === 1 ? 'active' : ''}`} onClick={() => setWizardStep(1)}>
                    Step 1: Supplier &amp; Store
                  </button>
                  <button type="button" className={`topbar-seg-btn ${wizardStep === 2 ? 'active' : ''}`} onClick={() => setWizardStep(2)}>
                    Step 2: Item &amp; Quantity
                  </button>
                  <button type="button" className={`topbar-seg-btn ${wizardStep === 3 ? 'active' : ''}`} onClick={() => setWizardStep(3)}>
                    Step 3: Review &amp; Post
                  </button>
                </div>
              </div>

              <form onSubmit={handleCreatePo}>
                {wizardStep === 1 && (
                  <div className="form-grid">
                    <label>
                      1A. Choose Supplier / Wholesaler
                      <select value={poSupplierId} onChange={(e) => setPoSupplierId(e.target.value)} required>
                        {suppliers.filter((s) => s.active).map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      1B. Destination Store / Warehouse
                      <select value={poWarehouseId} onChange={(e) => setPoWarehouseId(e.target.value)} required>
                        {warehouses.map((w) => (
                          <option key={w.id} value={w.id}>{w.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      1C. Delivery Note / PO Reference
                      <input value={poRef} onChange={(e) => setPoRef(e.target.value)} placeholder="Auto-generated if blank" />
                    </label>
                    <div className="form-actions">
                      <button type="button" className="btn btn-primary" onClick={() => setWizardStep(2)}>
                        Next: Step 2 (Select Item) →
                      </button>
                    </div>
                  </div>
                )}

                {wizardStep === 2 && (
                  <div>
                    <div className="form-grid">
                      <label>
                        2A. Product Being Ordered / Received
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
                              {p.name} ({p.sku}) — On shelf: {p.totalStock} {p.baseUnit}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        2B. Pack / Unit
                        <select value={poUnitId} onChange={(e) => setPoUnitId(e.target.value)} required>
                          {availableUnits.map((u) => (
                            <option key={u.id} value={u.id}>{u.label}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        2C. Quantity
                        <input type="number" step="0.001" min="0.001" value={poQty} onChange={(e) => setPoQty(e.target.value)} required />
                      </label>
                      <label>
                        2D. Unit Cost (USD $)
                        <input type="number" step="0.01" min="0" value={poCost} onChange={(e) => setPoCost(e.target.value)} required />
                      </label>
                      <div className="form-actions" style={{ gap: '0.5rem' }}>
                        <button type="button" className="btn btn-outline" onClick={() => setWizardStep(1)}>
                          ← Back
                        </button>
                        <button type="button" className="btn btn-secondary" onClick={addCurrentItemToPoBasket}>
                          + Add Item to Invoice List ({poCartLines.length})
                        </button>
                        <button type="button" className="btn btn-primary" onClick={() => setWizardStep(3)}>
                          Next: Step 3 (Confirm) →
                        </button>
                      </div>
                    </div>

                    {poCartLines.length > 0 && (
                      <div style={{ marginTop: '0.85rem', padding: '0.65rem', background: 'var(--zim-green-50)', borderRadius: '8px' }}>
                        <strong style={{ fontSize: '0.85rem' }}>Multi-Line Invoice Basket ({poCartLines.length} items):</strong>
                        <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.2rem', fontSize: '0.84rem' }}>
                          {poCartLines.map((item) => (
                            <li key={item.productId}>
                              <strong>{item.productName}</strong> — {item.orderedQuantity} × {item.unitLabel} @ {formatMoney(item.unitCost)} ={' '}
                              <strong>{formatMoney(item.orderedQuantity * item.unitCost)}</strong>{' '}
                              <button
                                type="button"
                                className="btn btn-outline btn-sm"
                                style={{ padding: '0.1rem 0.4rem', marginLeft: '0.4rem' }}
                                onClick={() => setPoCartLines((prev) => prev.filter((x) => x.productId !== item.productId))}
                              >
                                Remove
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {wizardStep === 3 && (
                  <div className="form-grid">
                    <div>
                      {poCartLines.length > 0 ? (
                        <>
                          <strong>Multi-Line Order Summary:</strong> {poCartLines.length} line item(s) totalling{' '}
                          <strong>
                            {formatMoney(poCartLines.reduce((acc, l) => acc + l.orderedQuantity * l.unitCost, 0))}
                          </strong>
                          .
                        </>
                      ) : (
                        <>
                          <strong>Summary:</strong> Ordering <strong>{poQty}</strong> units of{' '}
                          <strong>{currentPoProduct?.name ?? 'Product'}</strong> at <strong>${Number(poCost).toFixed(2)}</strong> each
                          (Total: <strong>{formatMoney(Number(poQty) * Number(poCost))}</strong>).
                        </>
                      )}
                    </div>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={poApproveNow}
                        onChange={(e) => setPoApproveNow(e.target.checked)}
                      />
                      Approve immediately for delivery receiving
                    </label>
                    <div className="form-actions">
                      <button type="button" className="btn btn-outline" onClick={() => setWizardStep(2)}>
                        ← Back
                      </button>
                      <button type="submit" className="btn btn-gold">
                        ✓ Create Order &amp; Open GRN Receiver
                      </button>
                    </div>
                  </div>
                )}
              </form>
            </div>

            {/* Active Purchase Orders & Partial/Full Delivery Table */}
            <div className="section-head">
              <h2>Purchase Orders &amp; Deliveries ({purchaseOrders.length})</h2>
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
                        <td className="num">{formatMoney(po.totalValue)}</td>
                        <td>
                          <span className={`badge badge-${po.status === 'received' ? 'receipt' : po.status === 'partial' ? 'transfer' : po.status === 'cancelled' ? 'write_off' : 'count'}`}>
                            {po.status}
                          </span>
                        </td>
                        <td>{po.createdAt.slice(0, 10)}</td>
                        <td className="num">
                          <div className="action-row" style={{ justifyContent: 'flex-end' }}>
                            <button type="button" className="btn btn-outline btn-sm" onClick={() => inspectPo(po.id)}>
                              {po.status === 'approved' || po.status === 'partial' ? '📥 Receive Goods (GRN)' : 'Inspect'}
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
                          </div>
                        </td>
                      </tr>
                    ))}
                    {purchaseOrders.length === 0 && (
                      <tr>
                        <td colSpan={7}>
                          <div className="empty-state-box">No purchase orders match this filter.</div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {selectedPo && (
              <div className="subcard" style={{ marginTop: '1.25rem', borderTop: '3px solid var(--zim-gold-500)' }}>
                <div className="section-head">
                  <div>
                    <h3>
                      GRN Delivery Receiver: {selectedPo.reference} — {selectedPo.supplierName} → {selectedPo.warehouseName} ({selectedPo.status})
                    </h3>
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
                          <th className="num">Ordered</th>
                          <th className="num">Received</th>
                          <th className="num">Remaining</th>
                          {(selectedPo.status === 'approved' || selectedPo.status === 'partial') && (
                            <>
                              <th>Receive Now</th>
                              <th>Batch # (Optional)</th>
                              <th>Expiry Date</th>
                            </>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {selectedPo.lines.map((l) => (
                          <tr key={l.id}>
                            <td><code>{l.sku}</code></td>
                            <td><strong>{l.productName}</strong></td>
                            <td className="num">{l.orderedQuantity} {l.unit}</td>
                            <td className="num pos">{l.receivedQuantity} {l.unit}</td>
                            <td className="num">{l.remainingQuantity} {l.unit}</td>
                            {(selectedPo.status === 'approved' || selectedPo.status === 'partial') && (
                              <>
                                <td>
                                  <input
                                    type="number"
                                    step="0.001"
                                    min="0"
                                    max={l.remainingQuantity}
                                    value={deliveryQty[l.productId] ?? '0'}
                                    onChange={(e) => setDeliveryQty({ ...deliveryQty, [l.productId]: e.target.value })}
                                    style={{ maxWidth: '110px' }}
                                  />
                                </td>
                                <td>
                                  <input
                                    placeholder="Batch #"
                                    value={deliveryBatch[l.productId] ?? ''}
                                    onChange={(e) => setDeliveryBatch({ ...deliveryBatch, [l.productId]: e.target.value })}
                                    style={{ maxWidth: '130px' }}
                                  />
                                </td>
                                <td>
                                  <input
                                    type="date"
                                    value={deliveryExpiry[l.productId] ?? ''}
                                    onChange={(e) => setDeliveryExpiry({ ...deliveryExpiry, [l.productId]: e.target.value })}
                                    style={{ maxWidth: '150px' }}
                                  />
                                </td>
                              </>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {(selectedPo.status === 'approved' || selectedPo.status === 'partial') && (
                    <div className="form-grid" style={{ marginTop: '1rem' }}>
                      <label>
                        GRN / Delivery Note Reference
                        <input value={grnRef} onChange={(e) => setGrnRef(e.target.value)} required />
                      </label>
                      <div className="form-actions">
                        <button className="btn btn-primary" type="submit">
                          ✓ Post Goods Receipt to Ledger
                        </button>
                      </div>
                    </div>
                  )}
                </form>
              </div>
            )}
          </div>
        )}

        {/* SUB-MENU 2: Cross-Border Landed Cost Calculator */}
        {activeTab === 'landed' && (
          <div id="procurement-panel-landed" role="tabpanel" aria-labelledby="procurement-tab-landed">
            <div className="section-head">
              <div>
                <h2>Cross-Border Trader Landed Cost Calculator (Musina / Joburg / Lusaka → Zimbabwe)</h2>
                <span className="vernacular-sub">
                  {subLabel(
                    'Kuverenga Mutengo Chaihwo: Mutengo weMusina + ZIMRA Duty + Mari yeBhazi/Runner',
                    'Ukubala Intengo Yeqiniso: Intengo YaseMusina + ZIMRA Duty + Imali YeBhasi/Runner',
                  )}
                </span>
              </div>
            </div>

            <div className="dashboard-panels">
              <div className="subcard">
                <h3>1. Enter Cross-Border Consignment Costs</h3>
                <div className="form-grid">
                  <label>
                    Supplier Invoice Currency
                    <select value={cbCurrency} onChange={(e) => setCbCurrency(e.target.value as 'ZAR' | 'USD')}>
                      <option value="ZAR">South African Rand (ZAR R — Musina/Joburg)</option>
                      <option value="USD">US Dollars (USD $ — Lusaka/Beira/Local)</option>
                    </select>
                  </label>
                  <label>
                    Wholesale Invoice Total ({cbCurrency})
                    <input type="number" step="0.01" value={cbWholesaleTotal} onChange={(e) => setCbWholesaleTotal(e.target.value)} />
                  </label>
                  <label>
                    Total Units in Consignment
                    <input type="number" min="1" value={cbUnitsCount} onChange={(e) => setCbUnitsCount(e.target.value)} />
                  </label>
                  <label>
                    ZIMRA Customs Duty &amp; Tolls (USD $)
                    <input type="number" step="0.01" value={cbZimraDutyUsd} onChange={(e) => setCbZimraDutyUsd(e.target.value)} />
                  </label>
                  <label>
                    Runner / Malaicha / Bus Freight (USD $)
                    <input type="number" step="0.01" value={cbRunnerFreightUsd} onChange={(e) => setCbRunnerFreightUsd(e.target.value)} />
                  </label>
                  <label>
                    Target Shop Gross Margin (%)
                    <input type="number" step="1" value={cbTargetMarginPct} onChange={(e) => setCbTargetMarginPct(e.target.value)} />
                  </label>
                </div>
              </div>

              <div className="subcard" style={{ borderLeft: '4px solid var(--zim-gold-500)' }}>
                <h3>2. True Landed Unit Cost &amp; Recommended Shelf Price</h3>
                <div className="ops-kpi-row" style={{ gridTemplateColumns: '1fr 1fr', marginTop: '0.75rem' }}>
                  <div className="kpi-card">
                    <span className="kpi-label">Total Landed Cost</span>
                    <strong className="kpi-value">{formatMoney(totalLandedUsd, 'USD')}</strong>
                    <span className="kpi-hint">{formatMoney(totalLandedUsd, 'ZiG')} · {formatMoney(totalLandedUsd, 'ZAR')}</span>
                  </div>
                  <div className="kpi-card">
                    <span className="kpi-label">True Landed Cost per Unit</span>
                    <strong className="kpi-value" style={{ color: 'var(--emerald)' }}>
                      {formatMoney(trueUnitCostUsd, 'USD')}
                    </strong>
                    <span className="kpi-hint">
                      {formatMoney(trueUnitCostUsd, 'ZiG')} · {formatMoney(trueUnitCostUsd, 'ZAR')}
                    </span>
                  </div>
                </div>
                <div className="subcard" style={{ background: 'var(--surface-alt)' }}>
                  <strong>Recommended Shelf Selling Price ({marginPct}% margin):</strong>
                  <div style={{ fontSize: '1.35rem', fontWeight: 800, marginTop: '0.25rem', color: 'var(--emerald)' }}>
                    {formatMoney(recommendedSellUsd, 'USD')} &nbsp;|&nbsp; {formatMoney(recommendedSellUsd, 'ZiG')} &nbsp;|&nbsp; {formatMoney(recommendedSellUsd, 'ZAR')}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SUB-MENU 3: Supplier Balances Owed (Creditors) */}
        {activeTab === 'creditors' && (
          <div id="procurement-panel-creditors" role="tabpanel" aria-labelledby="procurement-tab-creditors">
            <div className="section-head">
              <div>
                <h2>Supplier Directory &amp; Balances Owed (Creditors)</h2>
                <span className="vernacular-sub">
                  {subLabel(
                    'Mari Inodiwa neVatengesi (Creditors) & Vatengesi Vedu',
                    'Imali Efanele Ibhadalwe Abathengisi',
                  )}
                </span>
              </div>
            </div>

            <form className="form-grid subcard" style={{ marginBottom: '1.2rem' }} onSubmit={handleCreateSupplier}>
              <label>
                Add New Supplier / Wholesaler Name
                <input value={supName} onChange={(e) => setSupName(e.target.value)} placeholder="e.g. Dairibord Zimbabwe" required />
              </label>
              <label>
                WhatsApp / Phone Number
                <input value={supPhone} onChange={(e) => setSupPhone(e.target.value)} placeholder="e.g. +263 77 200 1100" />
              </label>
              <div className="form-actions">
                <button type="submit" className="btn btn-primary">+ Register Supplier</button>
              </div>
            </form>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Supplier / Wholesaler</th>
                    <th>Invoice Ref</th>
                    <th className="num">Invoice Total</th>
                    <th className="num">Paid So Far</th>
                    <th className="num">Balance Owed</th>
                    <th>Due Date / Status</th>
                    <th className="num">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {creditors.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="muted text-center" style={{ padding: '2.5rem', color: 'var(--muted)' }}>
                        No supplier credit balances logged yet. Creditors appear here automatically when receiving goods on account.
                      </td>
                    </tr>
                  ) : (
                    creditors.map((c) => {
                      const owed = Math.max(0, c.totalUsd - c.paidUsd);
                      return (
                        <tr key={c.id}>
                          <td>
                            <strong>{c.supplierName}</strong>
                            <div className="muted" style={{ margin: 0, fontSize: '0.78rem' }}>{c.contact}</div>
                          </td>
                          <td><code>{c.invoiceRef}</code></td>
                          <td className="num">{formatMoney(c.totalUsd)}</td>
                          <td className="num pos">{formatMoney(c.paidUsd)}</td>
                          <td className="num">
                            <strong className={owed > 0 ? 'neg' : 'pos'}>{formatMoney(owed)}</strong>
                          </td>
                          <td>
                            <span className={`status-pill ${owed === 0 ? 'optimal' : 'low'}`}>
                              {owed === 0 ? 'Settled in Full' : `Due ${c.dueDate}`}
                            </span>
                          </td>
                          <td className="num">
                            {owed > 0 && (
                              <button
                                type="button"
                                className="btn btn-outline btn-sm"
                                onClick={async () => {
                                  await api.payCreditor(c.id, owed).catch(() => null);
                                  setCreditors((prev) =>
                                    prev.map((x) => (x.id === c.id ? { ...x, paidUsd: x.totalUsd, dueDate: 'Paid in Full' } : x)),
                                  );
                                  setMsg(`Recorded settlement payment for ${c.supplierName} (${c.invoiceRef}).`);
                                }}
                              >
                                ✓ Record Payment
                              </button>
                            )}
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
          try {
            await confirmAction.run();
            setConfirmAction(null);
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}
