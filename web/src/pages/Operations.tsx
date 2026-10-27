import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  api,
  type CountSheetDetail,
  type CountSheetSummary,
  type MovementItem,
  type ProductItem,
  type RequisitionDetail,
  type RequisitionSummary,
} from '../api';
import { useAuth } from '../auth';
import { AccessibleTabs, type TabDefinition } from '../components/AccessibleTabs';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Spinner } from '../components/Spinner';

type MainOpTab = 'ledger' | 'post-movement' | 'requisitions' | 'stocktakes';
type OpMode = 'issues' | 'transfers' | 'returns' | 'adjustments' | 'write-offs' | 'receipts';

const LEDGER_PAGE_SIZE = 15;

const MODE_DESCRIPTIONS: Record<OpMode, string> = {
  issues: 'Issue stock from a warehouse to an internal department (reduces warehouse stock and records department consumption).',
  transfers: 'Move stock directly between two warehouses in a single atomic transaction.',
  returns: 'Record stock returned from a department back into warehouse stock (+), or returned out to a supplier (−).',
  adjustments: 'Post a signed (+ or −) stock adjustment with a mandatory audit reason.',
  'write-offs': 'Write off damaged, expired or spoiled stock with a mandatory reason.',
  receipts: 'Post a direct Goods Receipt into a warehouse (use Suppliers & POs for purchase-order deliveries).',
};

export function Operations() {
  const { user } = useAuth();
  const isExec = user?.role === 'executive_manager';

  const [mainTab, setMainTab] = useState<MainOpTab>('ledger');
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

  const [requisitions, setRequisitions] = useState<RequisitionSummary[]>([]);
  const [selectedReq, setSelectedReq] = useState<RequisitionDetail | null>(null);

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  // Posting form state
  const [productId, setProductId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [quantity, setQuantity] = useState('10');
  const [unitCost, setUnitCost] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [returnType, setReturnType] = useState<'from_department' | 'to_supplier'>('from_department');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');

  // Stocktake creation state
  const [csWhId, setCsWhId] = useState('');
  const [csProductId, setCsProductId] = useState('');
  const [csUnitId, setCsUnitId] = useState('');
  const [csCountedQty, setCsCountedQty] = useState('25');
  const [csRef, setCsRef] = useState('');
  const [csNotes, setCsNotes] = useState('');

  // Requisition form state
  const [reqKind, setReqKind] = useState<'department_issue' | 'warehouse_transfer'>('department_issue');
  const [reqWarehouseId, setReqWarehouseId] = useState('');
  const [reqDeptId, setReqDeptId] = useState('');
  const [reqToWhId, setReqToWhId] = useState('');
  const [reqProductId, setReqProductId] = useState('');
  const [reqUnitId, setReqUnitId] = useState('');
  const [reqQty, setReqQty] = useState('10');
  const [reqRef, setReqRef] = useState('');
  const [reqNotes, setReqNotes] = useState('');

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
      const [pRes, wRes, dRes, sRes, mRes, csRes, rqRes] = await Promise.all([
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
        api.requisitions(),
      ]);
      setProducts(pRes.items);
      setWarehouses(wRes);
      setDepartments(dRes);
      setSuppliers(sRes);
      setMovements(mRes.items);
      setCountSheets(csRes.items);
      setRequisitions(rqRes.items);

      if (!productId && pRes.items[0]) {
        setProductId(String(pRes.items[0].id));
        setUnitId(String(pRes.items[0].baseUnitId));
      }
      if (!csProductId && pRes.items[0]) {
        setCsProductId(String(pRes.items[0].id));
        setCsUnitId(String(pRes.items[0].baseUnitId));
      }
      if (!reqProductId && pRes.items[0]) {
        setReqProductId(String(pRes.items[0].id));
        setReqUnitId(String(pRes.items[0].baseUnitId));
      }
      if (!warehouseId && wRes[0]) setWarehouseId(String(wRes[0].id));
      if (!csWhId && wRes[0]) setCsWhId(String(wRes[0].id));
      if (!reqWarehouseId && wRes[0]) setReqWarehouseId(String(wRes[0].id));
      if (!toWarehouseId && wRes[1]) setToWarehouseId(String(wRes[1].id));
      if (!reqToWhId && wRes[1]) setReqToWhId(String(wRes[1].id));
      if (!departmentId && dRes[0]) setDepartmentId(String(dRes[0].id));
      if (!reqDeptId && dRes[0]) setReqDeptId(String(dRes[0].id));
      if (!supplierId && sRes[0]) setSupplierId(String(sRes[0].id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [typeFilter, whLedgerFilter, ledgerPage, productId, csProductId, reqProductId, warehouseId, csWhId, reqWarehouseId, toWarehouseId, reqToWhId, departmentId, reqDeptId, supplierId]);

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

  async function executePosting() {
    setError('');
    setMsg('');
    try {
      if (mode === 'returns') {
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
        if (mode === 'transfers') line.toWarehouseId = Number(toWarehouseId);
        if ((mode === 'receipts' || mode === 'adjustments') && unitCost.trim() !== '') line.unitCost = Number(unitCost);
        if (batchNumber.trim()) line.batchNumber = batchNumber.trim();
        if (expiryDate.trim()) line.expiryDate = expiryDate.trim();

        const body: Record<string, unknown> = {
          reference: reference.trim() || undefined,
          lines: [line],
        };
        if (mode === 'receipts' && supplierId) body.supplierId = Number(supplierId);
        if ((mode === 'issues' || mode === 'write-offs') && departmentId) body.departmentId = Number(departmentId);
        if (mode === 'adjustments' || mode === 'write-offs') body.reason = reason.trim();

        const res = await api.postStock(mode, body);
        setMsg(`Posted document #${res.document.id} to the ledger.`);
      }
      setReference('');
      setReason('');
      setBatchNumber('');
      setExpiryDate('');
      setMainTab('ledger');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function handleSubmitMovement(e: FormEvent) {
    e.preventDefault();
    if (mode === 'write-offs' || (mode === 'returns' && returnType === 'to_supplier')) {
      setConfirmAction({
        title: mode === 'write-offs' ? 'Confirm Stock Write-Off' : 'Confirm Return to Supplier',
        description: `Are you sure you want to deduct ${quantity} units of ${currentProduct?.name ?? 'product'} (${reason}) from warehouse stock?`,
        danger: true,
        run: executePosting,
      });
    } else {
      void executePosting();
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
        notes: csNotes.trim() || undefined,
        lines: [{ productId: Number(csProductId), unitId: Number(csUnitId), countedQuantity: Number(csCountedQty) }],
      });
      setCsRef('');
      setCsNotes('');
      setSelectedSheet(sheet);
      setMsg(`Draft Count Sheet #${sheet.id} created. Review variance below.`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleCreateRequisition(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMsg('');
    try {
      const created = await api.createRequisition({
        kind: reqKind,
        warehouseId: Number(reqWarehouseId),
        departmentId: reqKind === 'department_issue' ? Number(reqDeptId) : null,
        toWarehouseId: reqKind === 'warehouse_transfer' ? Number(reqToWhId) : null,
        reference: reqRef.trim() || `REQ-${Date.now().toString().slice(-5)}`,
        notes: reqNotes.trim() || undefined,
        lines: [
          {
            productId: Number(reqProductId),
            unitId: Number(reqUnitId),
            requestedQuantity: Number(reqQty),
          },
        ],
      });
      setReqRef('');
      setReqNotes('');
      setSelectedReq(created);
      setMsg(`Requisition #${created.id} created (pending fulfillment).`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleInspectRequisition(id: number) {
    setError('');
    try {
      setSelectedReq(await api.requisition(id));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleInspectSheet(id: number) {
    setError('');
    try {
      setSelectedSheet(await api.countSheet(id));
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

  const mainTabs: TabDefinition<MainOpTab>[] = [
    {
      key: 'ledger',
      label: '1. Live Movement Ledger',
      badge: movements.length,
      purpose: 'Audit the append-only stock movement ledger, filter by warehouse or document type, and reverse erroneous postings.',
    },
    {
      key: 'post-movement',
      label: '2. + Record Issue, Transfer, Return or Write-Off',
      purpose: 'Post immediate stock movements: department issues, internal warehouse transfers, stock returns, adjustments and write-offs.',
    },
    {
      key: 'requisitions',
      label: '3. Requisitions & Transfer Requests',
      badge: requisitions.filter((r) => r.status === 'pending').length,
      purpose: 'Submit department requisitions or warehouse transfer requests, inspect live available stock, and fulfill or reject them.',
    },
    {
      key: 'stocktakes',
      label: '4. Physical Stocktakes & Counts',
      badge: countSheets.length,
      purpose: 'Create physical count sheets, compare counted quantities against expected ledger balances, and reconcile variances.',
    },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Stock Operations, Requisitions &amp; Stocktakes</h1>
          <p className="muted">
            Authoritative movement ledger, department requisitions, internal transfers, returns, adjustments and physical stocktakes.
          </p>
        </div>
        <div className="quick-actions">
          <button type="button" className="btn btn-primary" onClick={() => setMainTab('post-movement')}>
            + Record Stock Movement
          </button>
          <button type="button" className="btn btn-outline" onClick={() => setMainTab('requisitions')}>
            Requisitions ({requisitions.filter((r) => r.status === 'pending').length} Pending)
          </button>
          <button type="button" className="btn btn-outline" onClick={() => setMainTab('stocktakes')}>
            Stocktakes ({countSheets.length})
          </button>
        </div>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      {msg && <p className="form-success" role="status">{msg}</p>}

      <section className="card">
        <AccessibleTabs
          idPrefix="operations"
          ariaLabel="Operations and stock ledger sections"
          tabs={mainTabs}
          active={mainTab}
          onChange={setMainTab}
        />

        {/* TAB 1: Authoritative Stock Movement Ledger */}
        {mainTab === 'ledger' && (
          <div id="operations-panel-ledger" role="tabpanel" aria-labelledby="operations-tab-ledger">
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
                  <option value="receipt">Receipts</option>
                  <option value="issue">Issues</option>
                  <option value="transfer">Transfers</option>
                  <option value="adjustment">Adjustments &amp; Returns</option>
                  <option value="count">Counts</option>
                  <option value="write_off">Write-Offs</option>
                  <option value="reversal">Reversals</option>
                </select>
              </div>
            </div>
            {loading ? (
              <Spinner label="Loading ledger" />
            ) : (
              <>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Doc #</th>
                        <th>Type</th>
                        <th>Ref / Reason</th>
                        <th>Product</th>
                        <th>Warehouse</th>
                        <th className="num">Entered</th>
                        <th className="num">Base Change</th>
                        <th className="num">Unit Cost</th>
                        <th>Batch / Expiry</th>
                        {isExec && <th className="num">Audit Action</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {movements.map((m) => (
                        <tr key={m.id}>
                          <td>#{m.documentId}</td>
                          <td><span className={`badge badge-${m.type}`}>{m.type.replace('_', ' ')}</span></td>
                          <td>{m.reference ?? m.reason ?? '—'}</td>
                          <td><strong>{m.productName}</strong> <span className="muted">({m.sku})</span></td>
                          <td>{m.warehouseName}</td>
                          <td className="num">{m.quantity} {m.unit} {m.factor && m.factor !== 1 ? `(×${m.factor})` : ''}</td>
                          <td className={`num ${m.baseChange >= 0 ? 'pos' : 'neg'}`}>
                            <strong>{m.baseChange > 0 ? `+${m.baseChange}` : m.baseChange}</strong>
                          </td>
                          <td className="num">${m.unitCost.toFixed(2)}</td>
                          <td>
                            {m.batchNumber ? `Lot: ${m.batchNumber}` : '—'}
                            {m.expiryDate ? ` (exp ${m.expiryDate})` : ''}
                          </td>
                          {isExec && (
                            <td className="num">
                              {m.reversedByDocumentId ? (
                                <span className="muted">Reversed by #{m.reversedByDocumentId}</span>
                              ) : m.type !== 'reversal' ? (
                                <button className="btn btn-outline btn-sm" type="button" onClick={() => handleReverse(m.documentId)}>
                                  Reverse
                                </button>
                              ) : (
                                <span className="muted">Reversal</span>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="pagination-bar">
                  <span className="muted" style={{ margin: 0 }}>Page {ledgerPage + 1}</span>
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

        {/* TAB 2: Record Issue, Transfer, Return, Adjustment or Write-Off */}
        {mainTab === 'post-movement' && (
          <div id="operations-panel-post-movement" role="tabpanel" aria-labelledby="operations-tab-post-movement">
            <div className="subcard" style={{ marginBottom: '1rem' }}>
              <div className="tabs" role="tablist" aria-label="Movement operation type">
                {(
                  [
                    ['issues', 'Issue to Department'],
                    ['transfers', 'Internal Transfer'],
                    ['returns', 'Return (Dept / Supplier)'],
                    ['adjustments', 'Adjustment (+/-)'],
                    ['write-offs', 'Write-Off'],
                    ['receipts', 'Direct Receipt'],
                  ] as [OpMode, string][]
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={mode === k}
                    className={`tab-btn${mode === k ? ' active' : ''}`}
                    onClick={() => setMode(k)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="muted" style={{ margin: '.65rem 0 0', fontSize: '.88rem' }}>
                {MODE_DESCRIPTIONS[mode]}
              </p>
            </div>

            <form className="form-grid" onSubmit={handleSubmitMovement}>
              {mode === 'returns' && (
                <label>
                  Return Direction
                  <select value={returnType} onChange={(e) => setReturnType(e.target.value as 'from_department' | 'to_supplier')}>
                    <option value="from_department">Return from Department → Into Warehouse (+)</option>
                    <option value="to_supplier">Return to Supplier ← Out of Warehouse (−)</option>
                  </select>
                </label>
              )}

              <label>
                Product
                <select
                  value={productId}
                  onChange={(e) => {
                    setProductId(e.target.value);
                    const p = products.find((x) => String(x.id) === e.target.value);
                    if (p) setUnitId(String(p.baseUnitId));
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
                {mode === 'transfers' ? 'Source Warehouse' : 'Warehouse'}
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

              <label>
                Unit / Packaging
                <select value={unitId} onChange={(e) => setUnitId(e.target.value)} required>
                  {unitsFor(productId).map((u) => (
                    <option key={u.id} value={u.id}>{u.label}</option>
                  ))}
                </select>
              </label>

              <label>
                {mode === 'adjustments' ? 'Signed Quantity (+/-)' : 'Quantity'}
                <input type="number" step="0.001" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
              </label>

              {(mode === 'receipts' || (mode === 'returns' && returnType === 'to_supplier')) && (
                <label>
                  Supplier
                  <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required={mode === 'returns'}>
                    <option value="">— Select Supplier —</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </label>
              )}

              {mode === 'receipts' && (
                <>
                  <label>
                    Unit Cost (USD per selected unit)
                    <input type="number" step="0.01" min="0" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="Defaults to product cost" />
                  </label>
                  <label>
                    Batch / Lot Number
                    <input value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)} placeholder="e.g. LOT-2026-10" />
                  </label>
                  <label>
                    Expiry Date (YYYY-MM-DD)
                    <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
                  </label>
                </>
              )}

              {(mode === 'issues' || mode === 'write-offs' || (mode === 'returns' && returnType === 'from_department')) && (
                <label>
                  Department (same branch)
                  <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} required={mode === 'returns'}>
                    <option value="">— Select Department —</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </label>
              )}

              <label>
                Document Reference
                <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. ISS-104 / RET-22" />
              </label>

              {(mode === 'adjustments' || mode === 'write-offs' || mode === 'returns') && (
                <label>
                  Reason (required)
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Reason for return, variance or write-off"
                    required
                  />
                </label>
              )}

              <div className="form-actions">
                <button className="btn btn-primary" type="submit">
                  {mode === 'returns' ? 'Post Stock Return' : `Post ${mode.replace('-', ' ').slice(0, -1)}`}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* TAB 3: Department Requisitions & Internal Transfer Requests */}
        {mainTab === 'requisitions' && (
          <div id="operations-panel-requisitions" role="tabpanel" aria-labelledby="operations-tab-requisitions">
            <div className="dashboard-panels">
              <div className="subcard">
                <h3>Submit New Requisition / Transfer Request</h3>
                <form className="form-grid" onSubmit={handleCreateRequisition}>
                  <label>
                    Request Type
                    <select value={reqKind} onChange={(e) => setReqKind(e.target.value as 'department_issue' | 'warehouse_transfer')}>
                      <option value="department_issue">Department Requisition (Issue)</option>
                      <option value="warehouse_transfer">Internal Warehouse Transfer Request</option>
                    </select>
                  </label>
                  <label>
                    Source Warehouse
                    <select value={reqWarehouseId} onChange={(e) => setReqWarehouseId(e.target.value)} required>
                      {warehouses.map((w) => (
                        <option key={w.id} value={w.id}>{w.name}</option>
                      ))}
                    </select>
                  </label>
                  {reqKind === 'department_issue' ? (
                    <label>
                      Requesting Department
                      <select value={reqDeptId} onChange={(e) => setReqDeptId(e.target.value)} required>
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <label>
                      Destination Warehouse
                      <select value={reqToWhId} onChange={(e) => setReqToWhId(e.target.value)} required>
                        {warehouses.map((w) => (
                          <option key={w.id} value={w.id}>{w.name}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label>
                    Product
                    <select
                      value={reqProductId}
                      onChange={(e) => {
                        setReqProductId(e.target.value);
                        const p = products.find((x) => String(x.id) === e.target.value);
                        if (p) setReqUnitId(String(p.baseUnitId));
                      }}
                      required
                    >
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.sku})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Unit
                    <select value={reqUnitId} onChange={(e) => setReqUnitId(e.target.value)} required>
                      {unitsFor(reqProductId).map((u) => (
                        <option key={u.id} value={u.id}>{u.label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Requested Quantity
                    <input type="number" step="0.001" min="0.001" value={reqQty} onChange={(e) => setReqQty(e.target.value)} required />
                  </label>
                  <label>
                    Reference
                    <input value={reqRef} onChange={(e) => setReqRef(e.target.value)} placeholder="e.g. REQ-2026-020" />
                  </label>
                  <label>
                    Notes
                    <input value={reqNotes} onChange={(e) => setReqNotes(e.target.value)} placeholder="Purpose or shift note" />
                  </label>
                  <div className="form-actions">
                    <button className="btn btn-primary" type="submit">Submit Requisition</button>
                  </div>
                </form>
              </div>

              <div>
                <h3>Requisitions Queue ({requisitions.length})</h3>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Ref</th>
                        <th>Type</th>
                        <th>Route</th>
                        <th>Status</th>
                        <th className="num">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {requisitions.map((r) => (
                        <tr key={r.id}>
                          <td><strong>{r.reference ?? `#${r.id}`}</strong></td>
                          <td>{r.kind === 'department_issue' ? 'Dept Issue' : 'Transfer'}</td>
                          <td>
                            {r.warehouseName} → {r.kind === 'department_issue' ? r.departmentName : r.toWarehouseName}
                          </td>
                          <td>
                            <span className={`badge badge-${r.status === 'fulfilled' ? 'receipt' : r.status === 'rejected' ? 'write_off' : 'count'}`}>
                              {r.status}
                            </span>
                          </td>
                          <td className="num">
                            <div className="action-row" style={{ justifyContent: 'flex-end' }}>
                              <button type="button" className="btn btn-outline btn-sm" onClick={() => handleInspectRequisition(r.id)}>
                                Inspect
                              </button>
                              {r.status === 'pending' && (
                                <>
                                  <button
                                    type="button"
                                    className="btn btn-primary btn-sm"
                                    onClick={() =>
                                      setConfirmAction({
                                        title: `Fulfill Requisition ${r.reference ?? `#${r.id}`}`,
                                        description: `Fulfill this requisition from ${r.warehouseName} and post the stock movement to the ledger?`,
                                        run: async () => {
                                          const res = await api.fulfillRequisition(r.id);
                                          setSelectedReq(res.requisition);
                                          setMsg(`Requisition fulfilled via Document #${res.document.id}.`);
                                          await load();
                                        },
                                      })
                                    }
                                  >
                                    Fulfill
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-outline btn-sm"
                                    onClick={() =>
                                      setConfirmAction({
                                        title: `Reject Requisition ${r.reference ?? `#${r.id}`}`,
                                        description: 'Reject this pending requisition? No stock will be moved.',
                                        danger: true,
                                        run: async () => {
                                          const updated = await api.rejectRequisition(r.id, 'Rejected by inventory manager');
                                          setSelectedReq(updated);
                                          setMsg(`Requisition #${r.id} rejected.`);
                                          await load();
                                        },
                                      })
                                    }
                                  >
                                    Reject
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                      {requisitions.length === 0 && (
                        <tr>
                          <td colSpan={5} className="muted">No requisitions submitted yet.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {selectedReq && (
                  <div className="subcard" style={{ marginTop: '1rem' }}>
                    <div className="section-head">
                      <h3>
                        {selectedReq.reference ?? `REQ #${selectedReq.id}`} — {selectedReq.warehouseName} →{' '}
                        {selectedReq.kind === 'department_issue' ? selectedReq.departmentName : selectedReq.toWarehouseName} ({selectedReq.status})
                      </h3>
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => setSelectedReq(null)}>Close</button>
                    </div>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>SKU</th>
                          <th>Product</th>
                          <th className="num">Requested</th>
                          <th className="num">Available in {selectedReq.warehouseName}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedReq.lines.map((l) => (
                          <tr key={l.id}>
                            <td><code>{l.sku}</code></td>
                            <td><strong>{l.productName}</strong></td>
                            <td className="num">{l.requestedQuantity} {l.unit} ({l.requestedBaseQuantity} {l.baseUnit})</td>
                            <td className={`num ${l.availableBaseQuantity < l.requestedBaseQuantity ? 'neg' : 'pos'}`}>
                              {l.availableBaseQuantity} {l.baseUnit}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: Physical Stocktakes & Reconciliation */}
        {mainTab === 'stocktakes' && (
          <div id="operations-panel-stocktakes" role="tabpanel" aria-labelledby="operations-tab-stocktakes">
            <div className="subcard" style={{ marginBottom: '1.25rem' }}>
              <h3>Create New Physical Stocktake Sheet</h3>
              <form className="form-grid" onSubmit={handleCreateCountSheet}>
                <label>
                  Warehouse
                  <select value={csWhId} onChange={(e) => setCsWhId(e.target.value)} required>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Product
                  <select
                    value={csProductId}
                    onChange={(e) => {
                      setCsProductId(e.target.value);
                      const p = products.find((x) => String(x.id) === e.target.value);
                      if (p) setCsUnitId(String(p.baseUnitId));
                    }}
                    required
                  >
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.sku})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Count Unit
                  <select value={csUnitId} onChange={(e) => setCsUnitId(e.target.value)} required>
                    {unitsFor(csProductId).map((u) => (
                      <option key={u.id} value={u.id}>{u.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Physical Counted Quantity
                  <input type="number" step="0.001" min="0" value={csCountedQty} onChange={(e) => setCsCountedQty(e.target.value)} required />
                </label>
                <label>
                  Sheet Reference
                  <input value={csRef} onChange={(e) => setCsRef(e.target.value)} placeholder="e.g. CS-2026-NOV" />
                </label>
                <label>
                  Notes
                  <input value={csNotes} onChange={(e) => setCsNotes(e.target.value)} placeholder="Spot check or month-end count" />
                </label>
                <div className="form-actions">
                  <button className="btn btn-primary" type="submit">Save Draft Stocktake Sheet</button>
                </div>
              </form>
            </div>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Sheet #</th>
                    <th>Warehouse</th>
                    <th>Reference</th>
                    <th>Notes</th>
                    <th>Status</th>
                    <th className="num">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {countSheets.map((cs) => (
                    <tr key={cs.id}>
                      <td>#{cs.id}</td>
                      <td><strong>{cs.warehouseName}</strong></td>
                      <td>{cs.reference ?? '—'}</td>
                      <td>{cs.notes ?? '—'}</td>
                      <td>
                        <span className={`badge badge-${cs.status === 'approved' ? 'receipt' : cs.status === 'cancelled' ? 'write_off' : 'count'}`}>
                          {cs.status}
                        </span>
                      </td>
                      <td className="num">
                        <div className="action-row" style={{ justifyContent: 'flex-end' }}>
                          <button className="btn btn-outline btn-sm" type="button" onClick={() => handleInspectSheet(cs.id)}>
                            View Variances
                          </button>
                          {cs.status === 'draft' && isExec && (
                            <button
                              className="btn btn-primary btn-sm"
                              type="button"
                              onClick={() =>
                                setConfirmAction({
                                  title: `Reconcile & Approve Count Sheet #${cs.id}`,
                                  description: `Approve Count Sheet #${cs.id} (${cs.warehouseName}) and post the variance adjustment to the authoritative stock ledger?`,
                                  run: async () => {
                                    const res = await api.approveCountSheet(cs.id);
                                    setSelectedSheet(res.sheet);
                                    setMsg(`Count Sheet #${cs.id} approved and posted to the stock ledger.`);
                                    await load();
                                  },
                                })
                              }
                            >
                              Approve &amp; Reconcile
                            </button>
                          )}
                          {cs.status === 'draft' && (
                            <button
                              className="btn btn-outline btn-sm"
                              type="button"
                              onClick={() =>
                                setConfirmAction({
                                  title: `Cancel Count Sheet #${cs.id}`,
                                  description: `Cancel draft Count Sheet #${cs.id}? No stock balances will be changed.`,
                                  danger: true,
                                  run: async () => {
                                    const updated = await api.cancelCountSheet(cs.id);
                                    setSelectedSheet(updated);
                                    setMsg(`Count Sheet #${cs.id} cancelled.`);
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
                  {countSheets.length === 0 && (
                    <tr>
                      <td colSpan={6} className="muted">No count sheets recorded yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {selectedSheet && (
              <div className="subcard" style={{ marginTop: '1rem' }}>
                <div className="section-head">
                  <h3>
                    Count Sheet #{selectedSheet.id} — {selectedSheet.warehouseName} ({selectedSheet.status})
                  </h3>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setSelectedSheet(null)}>Close</button>
                </div>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Product</th>
                      <th className="num">Counted</th>
                      <th className="num">Expected (Ledger)</th>
                      <th className="num">Variance (Base Units)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedSheet.lines.map((l) => (
                      <tr key={l.id}>
                        <td><code>{l.sku}</code></td>
                        <td><strong>{l.productName}</strong></td>
                        <td className="num">{l.countedQuantity} {l.unit} ({l.countedBaseQuantity} base)</td>
                        <td className="num">{l.expectedBaseQuantity}</td>
                        <td className={`num ${l.varianceBaseQuantity >= 0 ? 'pos' : 'neg'}`}>
                          {l.varianceBaseQuantity > 0 ? `+${l.varianceBaseQuantity}` : l.varianceBaseQuantity}
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
