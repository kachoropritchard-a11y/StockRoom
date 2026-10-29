import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  type BatchExpiryItem,
  type ProductItem,
  type PurchaseOrderSummary,
  type StockSerialItem,
} from '../api';
import { AccessibleTabs, type TabDefinition } from '../components/AccessibleTabs';
import { Spinner } from '../components/Spinner';
import { useZim } from '../zimContext';
import { formatBulkStock } from '../bulkStock';

type IntakeSubTab = 'intake' | 'expiry' | 'serials' | 'history' | 'creditors';

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
  const [batchExpiryItems, setBatchExpiryItems] = useState<BatchExpiryItem[]>([]);
  const [serialItems, setSerialItems] = useState<StockSerialItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  // Fast Intake Form State
  const [supplierId, setSupplierId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [invoiceRef, setInvoiceRef] = useState('');
  const [productId, setProductId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [bulkQuantity, setBulkQuantity] = useState('5');
  const [singlesAside, setSinglesAside] = useState('0');
  const [quickTotalSingles, setQuickTotalSingles] = useState('');
  const [unitCost, setUnitCost] = useState('24.00');
  const [batchNum, setBatchNum] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [trackSerials, setTrackSerials] = useState(false);
  const [serialsText, setSerialsText] = useState('');
  const [imeisText, setImeisText] = useState('');
  const [busy, setBusy] = useState(false);

  // Quick Bulk Packaging inline setup
  const [showQuickPkg, setShowQuickPkg] = useState(false);
  const [quickPkgUnitId, setQuickPkgUnitId] = useState('');
  const [quickPkgFactor, setQuickPkgFactor] = useState('12');
  const [units, setUnits] = useState<{ id: number; code: string; name: string }[]>([]);

  // Filters for Expiry & Serials tabs
  const [expiryFilter, setExpiryFilter] = useState<'all' | 'expired' | 'soon' | 'near' | 'good'>('all');
  const [expirySearch, setExpirySearch] = useState('');
  const [serialSearch, setSerialSearch] = useState('');
  const [serialStatusFilter, setSerialStatusFilter] = useState<string>('all');

  // New Supplier Quick Modal State
  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [newSupName, setNewSupName] = useState('');
  const [newSupPhone, setNewSupPhone] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, wRes, sRes, poRes, smeRes, expRes, serRes, uRes] = await Promise.all([
        api.products('', { limit: 200 }),
        api.warehouses(),
        api.suppliers(),
        api.purchaseOrders(),
        api.smeOverview().catch(() => null),
        api.batchExpiryTracker().catch(() => ({ items: [] })),
        api.stockSerials().catch(() => ({ items: [] })),
        api.units().catch(() => []),
      ]);
      setProducts(pRes.items);
      setWarehouses(wRes);
      setSuppliers(sRes);
      setPurchaseOrders(poRes.items);
      if (smeRes) setCreditors(smeRes.creditors || []);
      setBatchExpiryItems(expRes.items || []);
      setSerialItems(serRes.items || []);
      setUnits(uRes);
      if (uRes[0]) setQuickPkgUnitId((prev) => prev || String(uRes[0].id));

      if (wRes[0]) setWarehouseId((prev) => prev || String(wRes[0].id));
      if (sRes[0]) setSupplierId((prev) => prev || String(sRes[0].id));
      if (pRes.items[0]) {
        const first = pRes.items[0];
        setProductId((prev) => {
          if (prev) return prev;
          if (first.packagings.length > 0) {
            setUnitId(String(first.packagings[0].unitId));
            setUnitCost((first.unitCost * first.packagings[0].factor).toFixed(2));
          } else {
            setUnitId(String(first.baseUnitId));
            setUnitCost(first.unitCost.toFixed(2));
          }
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
  const bulkPackagings = selectedProduct?.packagings ?? [];
  const hasBulkPackaging = bulkPackagings.length > 0;

  // Enforce Bulk Packaging in Stock Intake: only bulk containers are selectable if configured!
  const availableUnits = selectedProduct
    ? (hasBulkPackaging
        ? bulkPackagings.map((g) => ({
            id: g.unitId,
            unit: g.unit,
            factor: g.factor,
            label: `📦 ${g.unit} (Bulk Pack × ${g.factor} ${selectedProduct.baseUnit})`,
            isBulk: true,
          }))
        : [
            {
              id: selectedProduct.baseUnitId,
              unit: selectedProduct.baseUnit,
              factor: 1,
              label: `⚠️ ${selectedProduct.baseUnit} (Base Single Unit - Bulk Packaging Not Configured)`,
              isBulk: false,
            },
          ])
    : [];

  const selectedUnitObj = availableUnits.find((u) => String(u.id) === unitId) ?? availableUnits[0];
  const factor = selectedUnitObj?.factor ?? 1;

  const bulkQtyNum = Math.max(0, Number(bulkQuantity) || 0);
  const singlesAsideNum = Math.max(0, Number(singlesAside) || 0);
  const costEntered = Math.max(0, Number(unitCost) || 0);

  // If bulk packaging is used, unitCost represents price per bulk container
  const trueCostPerSingle = factor > 0 ? costEntered / factor : costEntered;
  const totalSinglesAdded = (bulkQtyNum * factor) + singlesAsideNum;
  const totalCost = (bulkQtyNum * costEntered) + (singlesAsideNum * trueCostPerSingle);

  function handleQuickTotalSinglesChange(val: string) {
    setQuickTotalSingles(val);
    const num = Math.max(0, Number(val) || 0);
    if (factor > 1) {
      const packs = Math.floor(num / factor);
      const rem = Math.round((num % factor) * 1000) / 1000;
      setBulkQuantity(String(packs));
      setSinglesAside(String(rem));
    } else {
      setBulkQuantity(String(num));
      setSinglesAside('0');
    }
  }

  function bundleSinglesIntoPacks() {
    if (factor <= 1 || singlesAsideNum < factor) return;
    const additionalPacks = Math.floor(singlesAsideNum / factor);
    const rem = Math.round((singlesAsideNum % factor) * 1000) / 1000;
    setBulkQuantity(String(bulkQtyNum + additionalPacks));
    setSinglesAside(String(rem));
  }

  async function handleCreateQuickPackaging(e: FormEvent) {
    e.preventDefault();
    if (!selectedProduct || !quickPkgUnitId) return;
    setError('');
    try {
      await api.addPackaging(selectedProduct.id, {
        unitId: Number(quickPkgUnitId),
        factor: Math.max(1, Number(quickPkgFactor) || 12),
      });
      setShowQuickPkg(false);
      setMsg(`Bulk packaging rule saved for ${selectedProduct.name}.`);
      await load();
      setUnitId(String(quickPkgUnitId));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Days until expiry calculation
  const daysUntilExpiry = expiryDate
    ? Math.round((new Date(expiryDate).getTime() - new Date().setHours(0, 0, 0, 0)) / (1000 * 60 * 60 * 24))
    : null;

  // Parsed serial numbers and IMEIs
  const enteredSerials = trackSerials
    ? serialsText.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean)
    : [];
  const enteredImeis = trackSerials
    ? imeisText.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean)
    : [];

  async function handleFastIntake(e: FormEvent) {
    e.preventDefault();
    if (!supplierId || !warehouseId || !productId || totalSinglesAdded <= 0) {
      setError('Please select supplier, store location, product, and positive bulk packaging quantity or singles.');
      return;
    }
    setError('');
    setMsg('');
    setBusy(true);
    try {
      const ref = invoiceRef.trim() || `GRN-${Date.now().toString().slice(-6)}`;
      const lines = [];

      // Line 1: Bulk packaging line (if bulk packages entered)
      if (bulkQtyNum > 0 && selectedUnitObj) {
        lines.push({
          productId: Number(productId),
          warehouseId: Number(warehouseId),
          unitId: Number(selectedUnitObj.id),
          quantity: bulkQtyNum,
          unitCost: costEntered,
          batchNumber: batchNum.trim() || undefined,
          expiryDate: expiryDate.trim() || undefined,
          serials: enteredSerials.length > 0 ? enteredSerials : undefined,
          imeis: enteredImeis.length > 0 ? enteredImeis : undefined,
        });
      }

      // Line 2: Singles aside line (if loose remainder units entered that don't make up a full bulk container)
      if (singlesAsideNum > 0 && selectedProduct) {
        lines.push({
          productId: Number(productId),
          warehouseId: Number(warehouseId),
          unitId: Number(selectedProduct.baseUnitId),
          quantity: singlesAsideNum,
          unitCost: trueCostPerSingle,
          batchNumber: batchNum.trim() || undefined,
          expiryDate: expiryDate.trim() || undefined,
        });
      }

      const res = await api.postStock('receipts', {
        warehouseId: Number(warehouseId),
        supplierId: Number(supplierId),
        reference: ref,
        lines,
      });

      const extras = [
        batchNum ? `Batch: ${batchNum}` : null,
        daysUntilExpiry !== null ? `Shelf Life: ${daysUntilExpiry} days remaining` : null,
        enteredSerials.length > 0 ? `${enteredSerials.length} Serials / IMEIs logged` : null,
      ].filter(Boolean);

      const breakdownParts: string[] = [];
      if (bulkQtyNum > 0) breakdownParts.push(`${bulkQtyNum} ${selectedUnitObj?.unit || 'bulk packs'}`);
      if (singlesAsideNum > 0) breakdownParts.push(`${singlesAsideNum} singles aside (broken bulk)`);
      const breakdownText = breakdownParts.join(' + ') || `${totalSinglesAdded} ${selectedProduct?.baseUnit ?? 'units'}`;

      setMsg(
        `✓ Stock Intake #${res.document.id} (${ref}) posted: ${breakdownText} (+${totalSinglesAdded} ${selectedProduct?.baseUnit ?? 'units'} total) credited to inventory!${
          extras.length > 0 ? ` (${extras.join(', ')})` : ''
        }`,
      );
      setInvoiceRef('');
      setBatchNum('');
      setExpiryDate('');
      setSerialsText('');
      setImeisText('');
      setTrackSerials(false);
      setQuickTotalSingles('');
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

  async function handleUpdateSerialStatus(id: number, status: 'IN_STOCK' | 'SOLD' | 'DEFECTIVE' | 'TRANSFERRED' | 'WRITTEN_OFF') {
    try {
      await api.updateSerialStatus(id, status);
      setMsg(`✓ Updated serial status to ${status}.`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Filtered batches
  const filteredBatches = batchExpiryItems.filter((b) => {
    if (expiryFilter === 'expired' && b.daysRemaining >= 0) return false;
    if (expiryFilter === 'soon' && (b.daysRemaining < 0 || b.daysRemaining > 30)) return false;
    if (expiryFilter === 'near' && (b.daysRemaining <= 30 || b.daysRemaining > 90)) return false;
    if (expiryFilter === 'good' && b.daysRemaining <= 90) return false;

    if (expirySearch.trim()) {
      const q = expirySearch.toLowerCase();
      return (
        b.productName.toLowerCase().includes(q) ||
        b.sku.toLowerCase().includes(q) ||
        (b.batchNumber && b.batchNumber.toLowerCase().includes(q))
      );
    }
    return true;
  });

  // Filtered serials
  const filteredSerials = serialItems.filter((s) => {
    if (serialStatusFilter !== 'all' && s.status !== serialStatusFilter) return false;
    if (serialSearch.trim()) {
      const q = serialSearch.toLowerCase();
      return (
        (s.serialNumber && s.serialNumber.toLowerCase().includes(q)) ||
        (s.imei && s.imei.toLowerCase().includes(q)) ||
        s.productName.toLowerCase().includes(q) ||
        s.sku.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const expiringSoonCount = batchExpiryItems.filter((b) => b.daysRemaining <= 30).length;

  const tabs: TabDefinition<IntakeSubTab>[] = [
    {
      key: 'intake',
      label: '1. Fast Stock Intake (GRN)',
      badge: undefined,
      purpose: 'Record goods bought from suppliers with batch, expiry date, days shelf life, serial numbers & IMEIs.',
    },
    {
      key: 'expiry',
      label: '2. Batch & Expiry Tracker',
      badge: expiringSoonCount > 0 ? expiringSoonCount : undefined,
      purpose: 'Track days remaining until expiry across all batches in store (FEFO shelf priority).',
    },
    {
      key: 'serials',
      label: '3. Serial Number & IMEI Registry',
      badge: serialItems.filter((s) => s.status === 'IN_STOCK').length || undefined,
      purpose: 'Track serialized stock (solar equipment, mobile phones, inverters, appliances).',
    },
    {
      key: 'history',
      label: '4. Purchase Orders & Deliveries',
      badge: purchaseOrders.length,
      purpose: 'Track supplier delivery notes, purchase orders, and receiving history.',
    },
    {
      key: 'creditors',
      label: '5. Supplier Balances Owed',
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
              'Kugamuchira Zvinhu Zvakatengwa • Batch, Zuva reKupera (Expiry), Serial & IMEI',
              'Ukungena Kwempahla Yesitolo • Ukwamukela Impahla Ethengiweyo & Ama-Serials',
              'Supplier Receiving, Auto Break-Bulk, Batch & Expiry Days Tracking, Serial Numbers & IMEIs',
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
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: '440px' }}>
            <h3>+ Register Wholesale Supplier</h3>
            <p className="muted" style={{ fontSize: '0.86rem', marginBottom: '1rem' }}>
              Add a new supplier to quickly select when receiving purchase deliveries.
            </p>
            <form onSubmit={handleAddSupplier}>
              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label className="label">Supplier Company / Trade Name *</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. Mega Pak, National Foods, PPC Zimbabwe"
                  value={newSupName}
                  onChange={(e) => setNewSupName(e.target.value)}
                  required
                />
              </div>
              <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                <label className="label">Contact Phone / Rep Mobile (Optional)</label>
                <input
                  type="tel"
                  className="input"
                  placeholder="e.g. +263 772 123 456"
                  value={newSupPhone}
                  onChange={(e) => setNewSupPhone(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button type="button" className="btn btn-outline" onClick={() => setShowAddSupplier(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Supplier
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* TABS */}
      <AccessibleTabs
        idPrefix="stock-intake"
        ariaLabel="Stock Intake Deck Sub-Tabs"
        tabs={tabs}
        active={activeTab}
        onChange={(k) => setActiveTab(k)}
      />

      <section style={{ marginTop: '1.25rem' }}>
        {/* SUB-MENU 1: Fast Stock Intake */}
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
                shelf units in real-time. Embed batch numbers, expiry dates (with live shelf life days tracking), and unique serial numbers or IMEIs.
              </p>
            </div>

            {products.length === 0 ? (
              <div className="empty-state-box" style={{ padding: '2.5rem 1.5rem', marginBottom: '1.25rem' }}>
                <div style={{ fontSize: '2.2rem' }}>📦</div>
                <h3 style={{ margin: 0, color: 'var(--charcoal)' }}>No Products Registered in Catalog Yet</h3>
                <p style={{ margin: 0, maxWidth: '480px', fontSize: '0.88rem' }}>
                  Before recording supplier stock intake, please add your products and packaging units in the Product Manager.
                </p>
                <Link to="/inventory/products" className="btn btn-primary" style={{ marginTop: '0.5rem' }}>
                  + Go to Product Manager
                </Link>
              </div>
            ) : (
              <form className="form-grid subcard" style={{ marginBottom: '1.25rem' }} onSubmit={handleFastIntake}>
                <label>
                  Supplier *
                  <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Receiving Store / Yard *
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
                  Product Received *
                  <select
                    value={productId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setProductId(id);
                      const p = products.find((x) => String(x.id) === id);
                      if (p) {
                        if (p.packagings.length > 0) {
                          setUnitId(String(p.packagings[0].unitId));
                          setUnitCost((p.unitCost * p.packagings[0].factor).toFixed(2));
                        } else {
                          setUnitId(String(p.baseUnitId));
                          setUnitCost(p.unitCost.toFixed(2));
                        }
                        setBulkQuantity('5');
                        setSinglesAside('0');
                        setQuickTotalSingles('');
                      }
                    }}
                    required
                  >
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.sku}) — Current Stock: {formatBulkStock(p.totalStock, p.packagings, p.baseUnit).text}
                      </option>
                    ))}
                  </select>
                </label>

                {!hasBulkPackaging && selectedProduct && (
                  <div
                    style={{
                      gridColumn: '1 / -1',
                      padding: '0.75rem 1rem',
                      background: 'var(--amber-bg, #fffbeb)',
                      border: '1.5px solid var(--amber-line, #f59e0b)',
                      borderRadius: '8px',
                      color: '#92400e',
                      fontSize: '0.85rem',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <div>
                        <strong>📦 Bulk Packaging Not Configured:</strong> Products are bought in bulk (Cartons, Bales, Crates). Set a bulk packaging ratio to enable bulk intake:
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ borderColor: '#d97706', color: '#b45309', fontWeight: 600 }}
                        onClick={() => setShowQuickPkg((prev) => !prev)}
                      >
                        {showQuickPkg ? '✕ Close Quick Setup' : '+ Configure Bulk Package Ratio'}
                      </button>
                    </div>
                    {showQuickPkg && (
                      <div
                        style={{
                          marginTop: '0.75rem',
                          paddingTop: '0.75rem',
                          borderTop: '1px dashed #fcd34d',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.75rem',
                          flexWrap: 'wrap',
                        }}
                      >
                        <span>1 bulk container unit:</span>
                        <select
                          value={quickPkgUnitId}
                          onChange={(e) => setQuickPkgUnitId(e.target.value)}
                          style={{ width: 'auto', minWidth: '140px', padding: '0.35rem 0.5rem' }}
                        >
                          {units.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name} ({u.code})
                            </option>
                          ))}
                        </select>
                        <span>contains:</span>
                        <input
                          type="number"
                          min="1"
                          step="any"
                          value={quickPkgFactor}
                          onChange={(e) => setQuickPkgFactor(e.target.value)}
                          style={{ width: '80px', padding: '0.35rem 0.5rem' }}
                          placeholder="e.g. 12"
                        />
                        <span>{selectedProduct.baseUnit}</span>
                        <button type="button" className="btn btn-primary btn-sm" onClick={handleCreateQuickPackaging}>
                          ✓ Save Bulk Packaging Rule
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <label>
                  Bulk Packaging Unit (Carton, Bale, Crate) *
                  <select value={unitId} onChange={(e) => setUnitId(e.target.value)} required>
                    {availableUnits.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Bulk Packages Received ({selectedUnitObj?.unit || 'Packs'}) *
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={bulkQuantity}
                    onChange={(e) => {
                      setBulkQuantity(e.target.value);
                      setQuickTotalSingles('');
                    }}
                    placeholder="e.g. 5"
                    required={singlesAsideNum === 0}
                  />
                </label>

                <label>
                  Loose Singles Aside (Broken Bulk Remainder)
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={singlesAside}
                    onChange={(e) => {
                      setSinglesAside(e.target.value);
                      setQuickTotalSingles('');
                    }}
                    placeholder="e.g. 4 (if loose units)"
                  />
                  {factor > 1 && singlesAsideNum >= factor && (
                    <div style={{ marginTop: '0.3rem', fontSize: '0.78rem', color: 'var(--accent, #0284c7)' }}>
                      💡 {singlesAsideNum} singles can make {Math.floor(singlesAsideNum / factor)} full {selectedUnitObj?.unit} + {singlesAsideNum % factor} singles aside.{' '}
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '0.1rem 0.4rem', fontSize: '0.72rem' }}
                        onClick={bundleSinglesIntoPacks}
                      >
                        Bundle into Pack
                      </button>
                    </div>
                  )}
                </label>

                <label>
                  Purchase Price per Bulk Container ($ USD) *
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={unitCost}
                    onChange={(e) => setUnitCost(e.target.value)}
                    placeholder="e.g. 24.00"
                    required
                  />
                  {factor > 1 && (
                    <div style={{ marginTop: '0.25rem', fontSize: '0.78rem', color: 'var(--muted)' }}>
                      Single unit cost: {formatMoney(trueCostPerSingle)} per {selectedProduct?.baseUnit ?? 'unit'}
                    </div>
                  )}
                </label>

                {/* Quick Auto Break-Bulk Calculator */}
                {factor > 1 && (
                  <div
                    style={{
                      gridColumn: '1 / -1',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      flexWrap: 'wrap',
                      padding: '0.6rem 0.85rem',
                      background: 'var(--surface-alt)',
                      borderRadius: '8px',
                      fontSize: '0.82rem',
                    }}
                  >
                    <span style={{ fontWeight: 700 }}>⚡ Quick Breakdown Calculator:</span>
                    <span className="muted">Enter raw total loose count to auto-compute bulk packs and singles aside:</span>
                    <input
                      type="number"
                      min="0"
                      placeholder="e.g. 64"
                      value={quickTotalSingles}
                      onChange={(e) => handleQuickTotalSinglesChange(e.target.value)}
                      style={{ width: '90px', padding: '0.25rem 0.5rem', fontSize: '0.82rem' }}
                    />
                    {quickTotalSingles && (
                      <span style={{ color: 'var(--emerald)', fontWeight: 600 }}>
                        = {bulkQtyNum} {selectedUnitObj?.unit || 'packs'} + {singlesAsideNum} singles aside
                      </span>
                    )}
                  </div>
                )}

                {/* BATCH NUMBER & EXPIRY DATE (WITH LIVE DAYS CALCULATION) */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', gridColumn: 'span 2' }}>
                  <label>
                    Batch / Lot Number (Optional)
                    <input
                      type="text"
                      placeholder="e.g. BATCH-2026-11 or LOT-994"
                      value={batchNum}
                      onChange={(e) => setBatchNum(e.target.value)}
                    />
                  </label>

                  <label>
                    Expiry Date (Shelf Life Tracking)
                    <input
                      type="date"
                      value={expiryDate}
                      onChange={(e) => setExpiryDate(e.target.value)}
                    />
                    {daysUntilExpiry !== null && (
                      <div style={{ marginTop: '0.25rem', fontSize: '0.8rem', fontWeight: 600 }}>
                        {daysUntilExpiry < 0 ? (
                          <span style={{ color: 'var(--danger, #dc2626)' }}>
                            ❌ Expired {Math.abs(daysUntilExpiry)} days ago!
                          </span>
                        ) : daysUntilExpiry <= 30 ? (
                          <span style={{ color: 'var(--warning, #eab308)' }}>
                            ⚠️ Expiring soon: {daysUntilExpiry} days remaining!
                          </span>
                        ) : daysUntilExpiry <= 90 ? (
                          <span style={{ color: 'var(--accent, #0284c7)' }}>
                            ⏱️ Shelf Life: {daysUntilExpiry} days remaining (FEFO watch)
                          </span>
                        ) : (
                          <span style={{ color: 'var(--success, #16a34a)' }}>
                            ✓ Shelf Life: {daysUntilExpiry} days remaining (Fresh)
                          </span>
                        )}
                      </div>
                    )}
                  </label>
                </div>

                {/* SERIAL NUMBERS & IMEI CAPTURE SECTION */}
                <div
                  style={{
                    gridColumn: '1 / -1',
                    padding: '1rem',
                    background: 'var(--surface)',
                    border: '1.5px solid var(--line)',
                    borderRadius: '10px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', margin: 0, fontWeight: 700 }}>
                      <input
                        type="checkbox"
                        checked={trackSerials}
                        onChange={(e) => setTrackSerials(e.target.checked)}
                        style={{ width: '1.1rem', height: '1.1rem', cursor: 'pointer' }}
                      />
                      <span>🔢 Track Serial Numbers / IMEIs (For phones, solar inverters, batteries, appliances)</span>
                    </label>
                    {trackSerials && (
                      <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--accent, #0284c7)' }}>
                        {enteredSerials.length} serials / {enteredImeis.length} IMEIs entered (Receiving {totalSinglesAdded} singles)
                      </span>
                    )}
                  </div>

                  {trackSerials && (
                    <div style={{ marginTop: '0.75rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                      <div>
                        <label style={{ fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>
                          Serial Numbers (One per line or comma-separated)
                        </label>
                        <textarea
                          className="input"
                          rows={3}
                          placeholder="e.g.&#10;SN-880192&#10;SN-880193&#10;SN-880194"
                          value={serialsText}
                          onChange={(e) => setSerialsText(e.target.value)}
                          style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>
                          IMEI Numbers (Optional, for cellular devices/tablets)
                        </label>
                        <textarea
                          className="input"
                          rows={3}
                          placeholder="e.g.&#10;354890091234561&#10;354890091234562"
                          value={imeisText}
                          onChange={(e) => setImeisText(e.target.value)}
                          style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Automatic Bulk Intake & Broken-Bulk Breakdown Card */}
                <div
                  style={{
                    gridColumn: '1 / -1',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
                    gap: '1rem',
                    padding: '1.15rem',
                    background: 'var(--surface)',
                    border: '1.5px solid var(--line)',
                    borderRadius: '10px',
                  }}
                >
                  <div>
                    <span className="muted" style={{ fontSize: '0.76rem', textTransform: 'uppercase', fontWeight: 700 }}>
                      📦 Bulk Packages Received
                    </span>
                    <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--charcoal)', marginTop: '0.2rem' }}>
                      {bulkQtyNum} {selectedUnitObj?.unit || 'Packs'}
                    </div>
                    <span className="muted" style={{ fontSize: '0.74rem' }}>
                      {(bulkQtyNum * factor).toLocaleString()} singles in complete packages
                    </span>
                  </div>

                  <div style={{ borderLeft: singlesAsideNum > 0 ? '3px solid var(--accent, #0284c7)' : undefined, paddingLeft: singlesAsideNum > 0 ? '0.75rem' : undefined }}>
                    <span className="muted" style={{ fontSize: '0.76rem', textTransform: 'uppercase', fontWeight: 700 }}>
                      🧩 Singles Aside (Broken Bulk)
                    </span>
                    <div style={{ fontSize: '1.4rem', fontWeight: 800, color: singlesAsideNum > 0 ? 'var(--accent, #0284c7)' : 'var(--muted)', marginTop: '0.2rem' }}>
                      {singlesAsideNum} {selectedProduct?.baseUnit ?? 'singles'}
                    </div>
                    <div style={{ fontSize: '0.74rem', fontWeight: 600, color: singlesAsideNum > 0 ? 'var(--accent, #0284c7)' : 'var(--emerald)', marginTop: '0.1rem' }}>
                      {singlesAsideNum > 0
                        ? `⚡ Broken Bulk: ${singlesAsideNum} loose singles not enough for a full ${selectedUnitObj?.unit ?? 'pack'} (${singlesAsideNum}/${factor}). Separated aside for loose shelf retail!`
                        : `✓ Clean bulk intake (0 singles aside)`}
                    </div>
                  </div>

                  <div>
                    <span className="muted" style={{ fontSize: '0.76rem', textTransform: 'uppercase', fontWeight: 700 }}>
                      📊 Net Shelf Stock Credited
                    </span>
                    <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--emerald)', marginTop: '0.2rem' }}>
                      +{totalSinglesAdded.toLocaleString()} {selectedProduct?.baseUnit ?? 'units'}
                    </div>
                    <span className="muted" style={{ fontSize: '0.74rem' }}>
                      Ratio: 1 {selectedUnitObj?.unit || 'pack'} = {factor} {selectedProduct?.baseUnit}
                    </span>
                  </div>

                  <div>
                    <span className="muted" style={{ fontSize: '0.76rem', textTransform: 'uppercase', fontWeight: 700 }}>
                      Total Delivery Purchase Cost
                    </span>
                    <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--charcoal)', marginTop: '0.2rem' }}>
                      {formatMoney(totalCost)}
                    </div>
                    <span className="muted" style={{ fontSize: '0.74rem' }}>
                      Single cost: {formatMoney(trueCostPerSingle)} · Suggested Retail: {formatMoney(trueCostPerSingle * 1.3)}
                    </span>
                  </div>
                </div>

                <div className="form-actions" style={{ gridColumn: '1 / -1' }}>
                  <button type="submit" className="btn btn-primary" disabled={busy}>
                    {busy ? 'Posting to Ledger…' : '✓ Receive Stock into System'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* SUB-MENU 2: BATCH & EXPIRY TRACKER */}
        {activeTab === 'expiry' && (
          <div id="stock-intake-panel-expiry" role="tabpanel" aria-labelledby="stock-intake-tab-expiry">
            <div className="section-head" style={{ marginBottom: '0.75rem' }}>
              <div>
                <h3 style={{ margin: 0 }}>Active Batches &amp; Expiry Shelf Life Tracker</h3>
                <span className="vernacular-sub" style={{ fontSize: '0.82rem' }}>
                  Track days remaining until expiry across all storefloor &amp; warehouse batches (First-Expired-First-Out).
                </span>
              </div>
            </div>

            {/* Filter Bar */}
            <div className="card" style={{ marginBottom: '1.25rem', padding: '0.75rem 1rem' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', gap: '0.75rem', flex: 1, minWidth: '280px' }}>
                  <input
                    type="text"
                    className="input"
                    placeholder="Search product, SKU, or batch number..."
                    value={expirySearch}
                    onChange={(e) => setExpirySearch(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <div style={{ display: 'flex', gap: '0.35rem' }}>
                    {[
                      { key: 'all', label: `All (${batchExpiryItems.length})` },
                      { key: 'expired', label: 'Expired (<0d)' },
                      { key: 'soon', label: 'Soon (≤30d)' },
                      { key: 'near', label: 'Watch (31-90d)' },
                      { key: 'good', label: 'Good (>90d)' },
                    ].map((f) => (
                      <button
                        key={f.key}
                        type="button"
                        className={`btn btn-sm ${expiryFilter === f.key ? 'btn-primary' : 'btn-outline'}`}
                        onClick={() => setExpiryFilter(f.key as any)}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ fontSize: '0.875rem', opacity: 0.8 }}>
                  Showing {filteredBatches.length} of {batchExpiryItems.length} active batches
                </div>
              </div>
            </div>

            {filteredBatches.length === 0 ? (
              <div className="empty-state-box" style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
                <p className="muted" style={{ margin: 0 }}>
                  No active stock batches found matching the selected expiry filter.
                </p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Product &amp; SKU</th>
                      <th>Batch Number</th>
                      <th>Store Location</th>
                      <th className="num">In-Stock Balance</th>
                      <th>Expiry Date</th>
                      <th style={{ textAlign: 'center' }}>Days Remaining</th>
                      <th>Shelf Priority</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBatches.map((b, idx) => (
                      <tr key={`${b.productId}-${b.batchNumber}-${idx}`}>
                        <td>
                          <strong>{b.productName}</strong>
                          <div style={{ fontSize: '0.75rem', opacity: 0.75 }}><code>{b.sku}</code></div>
                        </td>
                        <td>
                          <code>{b.batchNumber || 'N/A'}</code>
                        </td>
                        <td>{b.warehouseName}</td>
                        <td className="num">
                          {(() => {
                            const matchProd = products.find((p) => p.id === b.productId);
                            return (
                              <strong>
                                {matchProd
                                  ? formatBulkStock(b.inStockQty, matchProd.packagings, b.unit).text
                                  : `${b.inStockQty} ${b.unit}`}
                              </strong>
                            );
                          })()}
                        </td>
                        <td>{b.expiryDate}</td>
                        <td style={{ textAlign: 'center' }}>
                          <span
                            className={`badge ${
                              b.status === 'EXPIRED'
                                ? 'badge-danger'
                                : b.status === 'EXPIRING_SOON'
                                  ? 'badge-warning'
                                  : b.status === 'EXPIRING_NEAR'
                                    ? 'badge-primary'
                                    : 'badge-success'
                            }`}
                          >
                            {b.daysRemaining < 0
                              ? `Expired (${Math.abs(b.daysRemaining)}d ago)`
                              : `${b.daysRemaining} days left`}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>
                            {b.status === 'EXPIRED'
                              ? '🚫 DO NOT SELL / WRITE OFF'
                              : b.status === 'EXPIRING_SOON'
                                ? '⚠️ ISSUE FIRST (URGENT)'
                                : b.status === 'EXPIRING_NEAR'
                                  ? '⏱️ FEFO PRIORITY'
                                  : '✓ HEALTHY SHELF LIFE'}
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

        {/* SUB-MENU 3: SERIAL NUMBER & IMEI REGISTRY */}
        {activeTab === 'serials' && (
          <div id="stock-intake-panel-serials" role="tabpanel" aria-labelledby="stock-intake-tab-serials">
            <div className="section-head" style={{ marginBottom: '0.75rem' }}>
              <div>
                <h3 style={{ margin: 0 }}>Serial Number &amp; IMEI Item Registry</h3>
                <span className="vernacular-sub" style={{ fontSize: '0.82rem' }}>
                  Track individual serialized units for solar inverters, lithium batteries, phones, and appliances.
                </span>
              </div>
            </div>

            {/* Filter Bar */}
            <div className="card" style={{ marginBottom: '1.25rem', padding: '0.75rem 1rem' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', gap: '0.75rem', flex: 1, minWidth: '280px' }}>
                  <input
                    type="text"
                    className="input"
                    placeholder="Search Serial Number, IMEI, Product, or SKU..."
                    value={serialSearch}
                    onChange={(e) => setSerialSearch(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <select
                    className="input"
                    style={{ width: 'auto' }}
                    value={serialStatusFilter}
                    onChange={(e) => setSerialStatusFilter(e.target.value)}
                  >
                    <option value="all">All Statuses ({serialItems.length})</option>
                    <option value="IN_STOCK">In Stock</option>
                    <option value="SOLD">Sold</option>
                    <option value="DEFECTIVE">Defective</option>
                    <option value="TRANSFERRED">Transferred</option>
                  </select>
                </div>
                <div style={{ fontSize: '0.875rem', opacity: 0.8 }}>
                  Showing {filteredSerials.length} of {serialItems.length} serialized items
                </div>
              </div>
            </div>

            {filteredSerials.length === 0 ? (
              <div className="empty-state-box" style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
                <p className="muted" style={{ margin: 0 }}>
                  No serialized stock registered yet. Check "Track Serial Numbers / IMEIs" on the Stock Intake form to record units upon delivery.
                </p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Serial Number</th>
                      <th>IMEI</th>
                      <th>Product &amp; SKU</th>
                      <th>Location</th>
                      <th>GRN Ref</th>
                      <th>Date Received</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'center' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSerials.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <strong><code>{s.serialNumber || '—'}</code></strong>
                        </td>
                        <td>
                          <code>{s.imei || '—'}</code>
                        </td>
                        <td>
                          <strong>{s.productName}</strong>
                          <div style={{ fontSize: '0.75rem', opacity: 0.75 }}><code>{s.sku}</code></div>
                        </td>
                        <td>{s.warehouseName}</td>
                        <td>{s.documentRef ? <code>{s.documentRef}</code> : 'Direct Intake'}</td>
                        <td>{s.createdAt.slice(0, 10)}</td>
                        <td>
                          <span
                            className={`badge ${
                              s.status === 'IN_STOCK'
                                ? 'badge-success'
                                : s.status === 'SOLD'
                                  ? 'badge-primary'
                                  : 'badge-danger'
                            }`}
                          >
                            {s.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {s.status === 'IN_STOCK' && (
                            <button
                              type="button"
                              className="btn btn-sm btn-outline"
                              onClick={() => handleUpdateSerialStatus(s.id, 'DEFECTIVE')}
                            >
                              Mark Defective
                            </button>
                          )}
                          {s.status === 'DEFECTIVE' && (
                            <button
                              type="button"
                              className="btn btn-sm btn-outline"
                              onClick={() => handleUpdateSerialStatus(s.id, 'IN_STOCK')}
                            >
                              Restore In-Stock
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* SUB-MENU 4: Purchase Orders & Intake History */}
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

        {/* SUB-MENU 5: Supplier Balances Owed */}
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
