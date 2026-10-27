import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  api,
  type CountSheetDetail,
  type CountSheetSummary,
  type MovementItem,
  type ProductItem,
} from '../api';
import { useAuth } from '../auth';
import { AccessibleTabs, type TabDefinition } from '../components/AccessibleTabs';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Spinner } from '../components/Spinner';
import { useZim } from '../zimContext';

type MovementSubTab = 'history' | 'cashup' | 'shrinkage';
type OpMode = 'issues' | 'transfers' | 'returns' | 'adjustments' | 'write-offs' | 'receipts';

const LEDGER_PAGE_SIZE = 15;

interface TillShiftRecord {
  id: string;
  shiftLabel: string;
  cashier: string;
  usdCash: number;
  zigCash: number;
  zarCash: number;
  ecocashUsd: number;
  innbucksUsd: number;
  onemoneyZig: number;
  status: 'BALANCED' | 'VARIANCE_FLAGGED';
  closedAt: string;
}

const INITIAL_SHIFTS: TillShiftRecord[] = [
  {
    id: 'SH-201',
    shiftLabel: 'Morning Shift #1 (Till A)',
    cashier: 'Tendai Moyo (PIN 1042)',
    usdCash: 485.0,
    zigCash: 6420.0,
    zarCash: 950.0,
    ecocashUsd: 162.5,
    innbucksUsd: 94.0,
    onemoneyZig: 1180.0,
    status: 'BALANCED',
    closedAt: 'Today 14:00 CAT',
  },
  {
    id: 'SH-202',
    shiftLabel: 'Afternoon Shift #2 (Till B)',
    cashier: 'Rudo Ncube (PIN 2088)',
    usdCash: 310.0,
    zigCash: 4190.0,
    zarCash: 400.0,
    ecocashUsd: 118.0,
    innbucksUsd: 55.0,
    onemoneyZig: 0,
    status: 'BALANCED',
    closedAt: 'Active Shift',
  },
];

const SHRINKAGE_REASONS = [
  'ZESA Power Cut Spoilage (Cold Chain / Butchery / Dairy)',
  'Transit Breakage (Runner / Bus / Forklift Damage)',
  'Expired on Shelf (MCAZ / FEFO Removal)',
  'Packaging Torn / Spilled in Store',
  'Suspected Pilferage / Stocktake Shortage',
];

export function Operations() {
  const { user } = useAuth();
  const { subLabel, rates } = useZim();
  const isExec = user?.role === 'executive_manager';

  const [mainTab, setMainTab] = useState<MovementSubTab>('history');
  const [showPostDrawer, setShowPostDrawer] = useState(false);
  const [showStocktakeDrawer, setShowStocktakeDrawer] = useState(false);
  const [mode, setMode] = useState<OpMode>('issues');

  const [products, setProducts] = useState<ProductItem[]>([]);
  const [warehouses, setWarehouses] = useState<{ id: number; name: string; branchId: number }[]>([]);
  const [departments, setDepartments] = useState<{ id: number; name: string; branchId: number }[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: number; name: string }[]>([]);
  const [movements, setMovements] = useState<MovementItem[]>([]);
  const [ledgerPage, setLedgerPage] = useState(0);
  const [typeFilter, setTypeFilter] = useState('');
  const [whLedgerFilter, setWhLedgerFilter] = useState<number | undefined>(undefined);

  const [countSheets, setCountSheets] = useState<CountSheetSummary[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<CountSheetDetail | null>(null);

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  // Posting form state
  const [productId, setProductId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [quantity, setQuantity] = useState('5');
  const [unitCost, setUnitCost] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [returnType, setReturnType] = useState<'from_department' | 'to_supplier'>('from_department');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState(SHRINKAGE_REASONS[0]);

  // Till Shifts & Cash-Up state
  const [shifts, setShifts] = useState<TillShiftRecord[]>(INITIAL_SHIFTS);
  const [cashierName, setCashierName] = useState('Chipo Dube (PIN 3019)');
  const [tillUsd, setTillUsd] = useState('420');
  const [tillZig, setTillZig] = useState('5800');
  const [tillZar, setTillZar] = useState('600');
  const [tillEcocash, setTillEcocash] = useState('145');
  const [tillInnbucks, setTillInnbucks] = useState('80');
  const [tillOnemoney, setTillOnemoney] = useState('950');

  // Stocktake creation state
  const [csWhId, setCsWhId] = useState('');
  const [csProductId, setCsProductId] = useState('');
  const [csUnitId, setCsUnitId] = useState('');
  const [csCountedQty, setCsCountedQty] = useState('25');
  const [csRef, setCsRef] = useState('');

  // Confirmation modal state
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
      const [pRes, wRes, dRes, sRes, mRes, csRes] = await Promise.all([
        api.products('', { limit: 200 }),
        api.warehouses(),
        api.departments(),
        api.suppliers(),
        api.movements(typeFilter || undefined, {
          warehouseId: whLedgerFilter,
          limit: LEDGER_PAGE_SIZE,
          offset: ledgerPage * LEDGER_PAGE_SIZE,
        }),
        api.countSheets(),
      ]);
      setProducts(pRes.items);
      setWarehouses(wRes);
      setDepartments(dRes);
      setSuppliers(sRes);
      setMovements(mRes.items);
      setCountSheets(csRes.items);

      if (pRes.items[0]) {
        const firstProd = pRes.items[0];
        setProductId((prev) => {
          if (prev) return prev;
          setUnitId(String(firstProd.baseUnitId));
          return String(firstProd.id);
        });
        setCsProductId((prev) => {
          if (prev) return prev;
          setCsUnitId(String(firstProd.baseUnitId));
          return String(firstProd.id);
        });
      }
      if (wRes[0]) {
        const defaultWh = String(wRes[0].id);
        setWarehouseId((prev) => prev || defaultWh);
        setCsWhId((prev) => prev || defaultWh);
      }
      if (wRes[1]) {
        const secondWh = String(wRes[1].id);
        setToWarehouseId((prev) => prev || secondWh);
      }
      if (dRes[0]) {
        const defaultDept = String(dRes[0].id);
        setDepartmentId((prev) => prev || defaultDept);
      }
      if (sRes[0]) setSupplierId((prev) => prev || String(sRes[0].id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [typeFilter, whLedgerFilter, ledgerPage]);

  useEffect(() => {
    load();
    const onSync = () => load();
    window.addEventListener('stockroom:sync', onSync);
    return () => window.removeEventListener('stockroom:sync', onSync);
  }, [load]);

  const unitsFor = (pid: string) => {
    const p = products.find((x) => String(x.id) === pid);
    if (!p) return [];
    return [
      { id: p.baseUnitId, label: `${p.baseUnit} (base unit × 1)` },
      ...p.packagings.map((g) => ({ id: g.unitId, label: `${g.unit} (× ${g.factor} ${p.baseUnit})` })),
    ];
  };

  const currentProduct = products.find((p) => String(p.id) === productId);

  async function executePosting(overrideMode?: OpMode) {
    const activeMode = overrideMode ?? mode;
    setError('');
    setMsg('');
    try {
      if (activeMode === 'returns') {
        const res = await api.postReturn({
          returnType,
          warehouseId: Number(warehouseId),
          departmentId: returnType === 'from_department' ? Number(departmentId) : null,
          supplierId: returnType === 'to_supplier' ? Number(supplierId) : null,
          reference: reference.trim() || undefined,
          reason: reason.trim(),
          lines: [
            {
              productId: Number(productId),
              unitId: Number(unitId),
              quantity: Number(quantity),
              batchNumber: batchNumber.trim() || undefined,
              expiryDate: expiryDate.trim() || undefined,
            },
          ],
        });
        setMsg(`Posted Stock Return Document #${res.document.id} to the ledger.`);
      } else {
        const line: Record<string, unknown> = {
          productId: Number(productId),
          warehouseId: Number(warehouseId),
          unitId: Number(unitId),
          quantity: Number(quantity),
        };
        if (activeMode === 'transfers') line.toWarehouseId = Number(toWarehouseId);
        if ((activeMode === 'receipts' || activeMode === 'adjustments') && unitCost.trim() !== '') line.unitCost = Number(unitCost);
        if (batchNumber.trim()) line.batchNumber = batchNumber.trim();
        if (expiryDate.trim()) line.expiryDate = expiryDate.trim();

        const body: Record<string, unknown> = {
          reference: reference.trim() || undefined,
          lines: [line],
        };
        if (activeMode === 'receipts' && supplierId) body.supplierId = Number(supplierId);
        if ((activeMode === 'issues' || activeMode === 'write-offs') && departmentId) body.departmentId = Number(departmentId);
        if (activeMode === 'adjustments' || activeMode === 'write-offs') body.reason = reason.trim();

        const res = await api.postStock(activeMode, body);
        setMsg(`Posted document #${res.document.id} (${activeMode}) to the authoritative stock ledger.`);
      }
      setReference('');
      setBatchNumber('');
      setExpiryDate('');
      setShowPostDrawer(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function handleSubmitMovement(e: FormEvent, forceWriteOff = false) {
    e.preventDefault();
    const targetMode = forceWriteOff ? 'write-offs' : mode;
    if (targetMode === 'write-offs' || (targetMode === 'returns' && returnType === 'to_supplier')) {
      setConfirmAction({
        title: targetMode === 'write-offs' ? 'Confirm Damaged / Shrinkage Write-Off' : 'Confirm Return to Supplier',
        description: `Are you sure you want to deduct ${quantity} units of ${currentProduct?.name ?? 'product'} (Reason: "${reason}") from warehouse stock?`,
        danger: true,
        run: () => executePosting(targetMode),
      });
    } else {
      void executePosting(targetMode);
    }
  }

  async function handleCreateCountSheet(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMsg('');
    try {
      const sheet = await api.createCountSheet({
        warehouseId: Number(csWhId),
        reference: csRef.trim() || undefined,
        lines: [{ productId: Number(csProductId), unitId: Number(csUnitId), countedQuantity: Number(csCountedQty) }],
      });
      setCsRef('');
      setSelectedSheet(sheet);
      setMsg(`Draft Count Sheet #${sheet.id} created. Review variance below.`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleReverse(docId: number) {
    const revReason = window.prompt(`Reason for reversing Document #${docId}:`, 'Posted in error');
    if (!revReason || revReason.trim().length < 3) return;
    setError('');
    setMsg('');
    try {
      const res = await api.reverseDocument(docId, revReason.trim());
      setMsg(`Reversed Document #${docId} via Reversal Document #${res.document.id}.`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const writeOffMovements = movements.filter((m) => m.type === 'write_off' || m.type === 'adjustment');

  const mainTabs: TabDefinition<MovementSubTab>[] = [
    {
      key: 'history',
      label: '1. Movement History',
      badge: movements.length,
      purpose: 'Audit the append-only stock movement ledger, filter by warehouse or type, and record issues or stocktakes.',
    },
    {
      key: 'cashup',
      label: '2. Till Shifts & Cash-Up',
      badge: shifts.length,
      purpose: 'Reconcile multi-tender Zimbabwean till shifts across USD Cash, ZiG Notes, ZAR Rand, EcoCash, InnBucks, and OneMoney.',
    },
    {
      key: 'shrinkage',
      label: '3. Damaged & Shrinkage Log',
      badge: writeOffMovements.length,
      purpose: 'Record spoiled, broken, or expired stock with mandatory ZESA/transit/expiry reason codes and executive audit trail.',
    },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Stock Movements, Till Shifts &amp; Shrinkage</h1>
          <span className="vernacular-sub">
            {subLabel(
              'Kubuda Nekupinda kweZvinhu • Kuverenga Mari yeTill (EcoCash/InnBucks/USD/ZiG)',
              'Ukuphuma Lokungena Kwempahla • Ukubala Imali yeTill',
              'Authoritative Movement History, Multi-Tender Till Cash-Up & Mandatory Shrinkage Log',
            )}
          </span>
        </div>
        <div className="quick-actions">
          <button type="button" className="btn btn-primary" onClick={() => setShowPostDrawer((s) => !s)}>
            {showPostDrawer ? '✕ Close Form' : '+ Record Stock Movement'}
          </button>
          <button type="button" className="btn btn-outline" onClick={() => setShowStocktakeDrawer((s) => !s)}>
            {showStocktakeDrawer ? '✕ Close Stocktakes' : `📋 Physical Stocktakes (${countSheets.length})`}
          </button>
        </div>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      {msg && <p className="form-success" role="status">{msg}</p>}

      {/* Collapsible Stock Movement Drawer */}
      {showPostDrawer && (
        <section className="card" style={{ marginBottom: '1.2rem', borderTop: '4px solid var(--zim-gold-500)' }}>
          <div className="section-head">
            <h3>Post Stock Movement to Authoritative Ledger</h3>
            <div className="topbar-seg-group">
              {(['issues', 'receipts', 'transfers', 'returns', 'adjustments', 'write-offs'] as OpMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`topbar-seg-btn ${mode === m ? 'active' : ''}`}
                  onClick={() => setMode(m)}
                >
                  {m.replace('-', ' ').toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <form className="form-grid" onSubmit={(e) => handleSubmitMovement(e, false)}>
            <label>
              Product
              <select
                value={productId}
                onChange={(e) => {
                  setProductId(e.target.value);
                  const found = products.find((p) => String(p.id) === e.target.value);
                  if (found) setUnitId(String(found.baseUnitId));
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
              Warehouse
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </label>
            {mode === 'transfers' && (
              <label>
                Destination Warehouse
                <select value={toWarehouseId} onChange={(e) => setToWarehouseId(e.target.value)} required>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </label>
            )}
            {(mode === 'issues' || mode === 'write-offs') && (
              <label>
                Department
                <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Unit
              <select value={unitId} onChange={(e) => setUnitId(e.target.value)} required>
                {unitsFor(productId).map((u) => (
                  <option key={u.id} value={u.id}>{u.label}</option>
                ))}
              </select>
            </label>
            <label>
              Quantity
              <input type="number" step="0.001" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
            </label>
            {(mode === 'adjustments' || mode === 'write-offs' || mode === 'returns') && (
              <label>
                Mandatory Reason
                <input value={reason} onChange={(e) => setReason(e.target.value)} required />
              </label>
            )}
            <label>
              Reference (Optional)
              <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. ISS-104" />
            </label>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary">Post Movement</button>
            </div>
          </form>
        </section>
      )}

      {/* Collapsible Stocktake Drawer */}
      {showStocktakeDrawer && (
        <section className="card" style={{ marginBottom: '1.2rem' }}>
          <div className="section-head">
            <h3>Physical Stocktake &amp; Variance Reconciliation</h3>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowStocktakeDrawer(false)}>
              Close
            </button>
          </div>
          <form className="form-grid" onSubmit={handleCreateCountSheet} style={{ marginBottom: '1rem' }}>
            <label>
              Warehouse
              <select value={csWhId} onChange={(e) => setCsWhId(e.target.value)} required>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </label>
            <label>
              Product Counted
              <select
                value={csProductId}
                onChange={(e) => {
                  setCsProductId(e.target.value);
                  const found = products.find((p) => String(p.id) === e.target.value);
                  if (found) setCsUnitId(String(found.baseUnitId));
                }}
                required
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                ))}
              </select>
            </label>
            <label>
              Physical Shelf Count ({unitsFor(csProductId)[0]?.label ?? 'base'})
              <input type="number" step="0.001" min="0" value={csCountedQty} onChange={(e) => setCsCountedQty(e.target.value)} required />
            </label>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary">+ Create Count Sheet</button>
            </div>
          </form>
          {selectedSheet && (
            <div className="subcard">
              <strong>
                Count Sheet #{selectedSheet.id} ({selectedSheet.status}) — Variance:{' '}
                {selectedSheet.lines[0]?.varianceBaseQuantity ?? 0}
              </strong>
            </div>
          )}
        </section>
      )}

      <section className="card">
        {/* TIER 3: Horizontal In-Page Sub-Menu Bar */}
        <AccessibleTabs
          idPrefix="operations"
          ariaLabel="Operations and stock ledger sections"
          tabs={mainTabs}
          active={mainTab}
          onChange={setMainTab}
        />

        {/* SUB-MENU 1: Movement History */}
        {mainTab === 'history' && (
          <div id="operations-panel-history" role="tabpanel" aria-labelledby="operations-tab-history">
            <div className="section-head">
              <h2>Authoritative Stock Movement Ledger</h2>
              <div className="filter-bar">
                <select
                  aria-label="Filter ledger by warehouse"
                  value={whLedgerFilter ?? ''}
                  onChange={(e) => {
                    setWhLedgerFilter(e.target.value ? Number(e.target.value) : undefined);
                    setLedgerPage(0);
                  }}
                >
                  <option value="">All Warehouses</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
                <select
                  aria-label="Filter ledger by document type"
                  value={typeFilter}
                  onChange={(e) => {
                    setTypeFilter(e.target.value);
                    setLedgerPage(0);
                  }}
                >
                  <option value="">All Document Types</option>
                  <option value="receipt">Receipts (+)</option>
                  <option value="issue">Department Issues (−)</option>
                  <option value="transfer">Transfers (⇄)</option>
                  <option value="adjustment">Adjustments (±)</option>
                  <option value="count">Physical Counts</option>
                  <option value="write_off">Write-Offs (−)</option>
                  <option value="reversal">Reversals</option>
                </select>
                {(whLedgerFilter !== undefined || typeFilter !== '') && (
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => {
                      setWhLedgerFilter(undefined);
                      setTypeFilter('');
                      setLedgerPage(0);
                    }}
                  >
                    Reset Filters
                  </button>
                )}
              </div>
            </div>

            {loading ? (
              <Spinner label="Loading movement ledger" />
            ) : (
              <>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Doc #</th>
                        <th>Type</th>
                        <th>Reference / Reason</th>
                        <th>Product</th>
                        <th>Warehouse</th>
                        <th className="num">Entered</th>
                        <th className="num">Base Change</th>
                        <th>Date</th>
                        {isExec && <th className="num">Executive Action</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {movements.map((m) => (
                        <tr key={m.id}>
                          <td><strong>#{m.documentId}</strong></td>
                          <td><span className={`badge badge-${m.type}`}>{m.type.replace('_', ' ')}</span></td>
                          <td>
                            {m.reference ?? '—'}
                            {m.reason ? <div className="muted" style={{ margin: 0, fontSize: '.78rem' }}>{m.reason}</div> : null}
                          </td>
                          <td>
                            <strong>{m.productName}</strong> <code>({m.sku})</code>
                          </td>
                          <td>{m.warehouseName}</td>
                          <td className="num">{m.quantity} {m.unit}</td>
                          <td className={`num ${m.baseChange >= 0 ? 'pos' : 'neg'}`}>
                            <strong>{m.baseChange > 0 ? `+${m.baseChange}` : m.baseChange} {m.unit}</strong>
                          </td>
                          <td>{m.createdAt.slice(0, 16).replace('T', ' ')}</td>
                          {isExec && (
                            <td className="num">
                              {m.type !== 'reversal' && !m.reversedByDocumentId && (
                                <button
                                  type="button"
                                  className="btn btn-outline btn-sm"
                                  onClick={() => handleReverse(m.documentId)}
                                >
                                  Reverse
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                      {movements.length === 0 && (
                        <tr>
                          <td colSpan={isExec ? 9 : 8}>
                            <div className="empty-state-box">No movements match this filter.</div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="pagination-bar">
                  <span className="muted" style={{ margin: 0 }}>
                    Ledger Page {ledgerPage + 1} (showing {movements.length} rows)
                  </span>
                  <div className="action-row">
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      disabled={ledgerPage === 0}
                      onClick={() => setLedgerPage((p) => Math.max(0, p - 1))}
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      disabled={movements.length < LEDGER_PAGE_SIZE}
                      onClick={() => setLedgerPage((p) => p + 1)}
                    >
                      Next
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* SUB-MENU 2: Till Shifts & Cash-Up (USD, ZiG, ZAR, EcoCash, OneMoney, InnBucks) */}
        {mainTab === 'cashup' && (
          <div id="operations-panel-cashup" role="tabpanel" aria-labelledby="operations-tab-cashup">
            <div className="section-head">
              <div>
                <h2>Multi-Tender Zimbabwean Till Shift Cash-Up</h2>
                <span className="vernacular-sub">
                  {subLabel(
                    'Kuverenga Mari yeTill (USD Cash, ZiG, Rand, EcoCash, InnBucks, OneMoney)',
                    'Ukubala Imali yeTill (USD, ZiG, ZAR, EcoCash, InnBucks)',
                  )}
                </span>
              </div>
            </div>

            <form
              className="form-grid subcard"
              style={{ marginBottom: '1.2rem' }}
              onSubmit={(e) => {
                e.preventDefault();
                setShifts((prev) => [
                  {
                    id: `SH-${200 + prev.length + 1}`,
                    shiftLabel: `Shift #${prev.length + 1} Cash-Up`,
                    cashier: cashierName,
                    usdCash: Number(tillUsd) || 0,
                    zigCash: Number(tillZig) || 0,
                    zarCash: Number(tillZar) || 0,
                    ecocashUsd: Number(tillEcocash) || 0,
                    innbucksUsd: Number(tillInnbucks) || 0,
                    onemoneyZig: Number(tillOnemoney) || 0,
                    status: 'BALANCED',
                    closedAt: 'Just Reconciled',
                  },
                  ...prev,
                ]);
                setMsg(`Till shift for ${cashierName} reconciled across USD, ZiG, ZAR, EcoCash, InnBucks & OneMoney.`);
              }}
            >
              <label>
                Cashier / Till Operator
                <input value={cashierName} onChange={(e) => setCashierName(e.target.value)} required />
              </label>
              <label>
                USD Physical Cash ($)
                <input type="number" step="0.01" value={tillUsd} onChange={(e) => setTillUsd(e.target.value)} required />
              </label>
              <label>
                ZiG Notes &amp; Coins (ZiG)
                <input type="number" step="0.01" value={tillZig} onChange={(e) => setTillZig(e.target.value)} required />
              </label>
              <label>
                South African Rand (ZAR R)
                <input type="number" step="0.01" value={tillZar} onChange={(e) => setTillZar(e.target.value)} required />
              </label>
              <label>
                EcoCash Merchant USD ($)
                <input type="number" step="0.01" value={tillEcocash} onChange={(e) => setTillEcocash(e.target.value)} required />
              </label>
              <label>
                InnBucks / Mukuru USD ($)
                <input type="number" step="0.01" value={tillInnbucks} onChange={(e) => setTillInnbucks(e.target.value)} required />
              </label>
              <label>
                OneMoney / ZIPIT (ZiG)
                <input type="number" step="0.01" value={tillOnemoney} onChange={(e) => setTillOnemoney(e.target.value)} required />
              </label>
              <div className="form-actions">
                <button type="submit" className="btn btn-primary">✓ Cash-Up &amp; Lock Shift</button>
              </div>
            </form>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Shift &amp; Cashier</th>
                    <th className="num">USD Cash</th>
                    <th className="num">ZiG Cash</th>
                    <th className="num">ZAR Cash</th>
                    <th className="num">EcoCash ($)</th>
                    <th className="num">InnBucks ($)</th>
                    <th className="num">OneMoney (ZiG)</th>
                    <th className="num">Total USD Equiv.</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shifts.map((s) => {
                    const totalUsdEq =
                      s.usdCash +
                      s.ecocashUsd +
                      s.innbucksUsd +
                      (s.zigCash + s.onemoneyZig) / Math.max(1, rates.ZiG) +
                      s.zarCash / Math.max(1, rates.ZAR);
                    return (
                      <tr key={s.id}>
                        <td>
                          <strong>{s.shiftLabel}</strong>
                          <div className="muted" style={{ margin: 0, fontSize: '0.78rem' }}>{s.cashier} · {s.closedAt}</div>
                        </td>
                        <td className="num">${s.usdCash.toFixed(2)}</td>
                        <td className="num">ZiG {s.zigCash.toFixed(2)}</td>
                        <td className="num">R {s.zarCash.toFixed(2)}</td>
                        <td className="num">${s.ecocashUsd.toFixed(2)}</td>
                        <td className="num">${s.innbucksUsd.toFixed(2)}</td>
                        <td className="num">ZiG {s.onemoneyZig.toFixed(2)}</td>
                        <td className="num"><strong>${totalUsdEq.toFixed(2)}</strong></td>
                        <td>
                          <span className="status-pill optimal">{s.status}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* SUB-MENU 3: Damaged & Shrinkage Log (Mandatory Reason Codes) */}
        {mainTab === 'shrinkage' && (
          <div id="operations-panel-shrinkage" role="tabpanel" aria-labelledby="operations-tab-shrinkage">
            <div className="section-head">
              <div>
                <h2>Damaged, Expired &amp; Shrinkage Write-Off Log</h2>
                <span className="vernacular-sub">
                  {subLabel(
                    'Zvinhu Zvakuvadzwa kana Kuora (Chikonzero Chinodiwa)',
                    'Impahla Eyonakeleyo Kumbe Ebolileyo (Isizatho Siyadingeka)',
                  )}
                </span>
              </div>
            </div>

            <form className="form-grid subcard" style={{ marginBottom: '1.2rem' }} onSubmit={(e) => handleSubmitMovement(e, true)}>
              <label>
                Damaged / Spoiled Product
                <select
                  value={productId}
                  onChange={(e) => {
                    setProductId(e.target.value);
                    const found = products.find((p) => String(p.id) === e.target.value);
                    if (found) setUnitId(String(found.baseUnitId));
                  }}
                  required
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku}) — {p.totalStock} {p.baseUnit} on hand
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Warehouse Location
                <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Quantity Damaged
                <input type="number" step="0.001" min="0.001" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
              </label>
              <label>
                Mandatory Shrinkage Reason Code
                <select value={reason} onChange={(e) => setReason(e.target.value)} required>
                  {SHRINKAGE_REASONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </label>
              <div className="form-actions">
                <button type="submit" className="btn btn-danger">⚠️ Record Write-Off to Ledger</button>
              </div>
            </form>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Doc #</th>
                    <th>Type</th>
                    <th>Product</th>
                    <th>Warehouse</th>
                    <th>Mandatory Reason Code</th>
                    <th className="num">Quantity Deducted</th>
                    <th>Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {writeOffMovements.map((m) => (
                    <tr key={m.id}>
                      <td><strong>#{m.documentId}</strong></td>
                      <td><span className={`badge badge-${m.type}`}>{m.type.replace('_', ' ')}</span></td>
                      <td><strong>{m.productName}</strong> <code>({m.sku})</code></td>
                      <td>{m.warehouseName}</td>
                      <td><strong>{m.reason ?? 'Recorded shrinkage'}</strong></td>
                      <td className="num neg"><strong>{m.baseChange} {m.unit}</strong></td>
                      <td>{m.createdAt.slice(0, 16).replace('T', ' ')}</td>
                    </tr>
                  ))}
                  {writeOffMovements.length === 0 && (
                    <tr>
                      <td colSpan={7}>
                        <div className="empty-state-box">No write-offs or shrinkage events recorded yet.</div>
                      </td>
                    </tr>
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
