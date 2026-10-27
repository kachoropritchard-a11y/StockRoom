import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type CountSheetDetail, type CountSheetSummary, type MovementItem, type ProductItem } from '../api';
import { useAuth } from '../auth';
import { Spinner } from '../components/Spinner';

type OpMode = 'receipts' | 'issues' | 'transfers' | 'adjustments' | 'write-offs' | 'count-sheets';

export function Operations() {
  const { user } = useAuth();
  const isExec = user?.role === 'executive_manager';

  const [mode, setMode] = useState<OpMode>('receipts');
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [warehouses, setWarehouses] = useState<{ id: number; name: string; branchId: number }[]>([]);
  const [departments, setDepartments] = useState<{ id: number; name: string; branchId: number }[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: number; name: string }[]>([]);
  const [movements, setMovements] = useState<MovementItem[]>([]);
  const [countSheets, setCountSheets] = useState<CountSheetSummary[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<CountSheetDetail | null>(null);
  const [typeFilter, setTypeFilter] = useState('');
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
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, wRes, dRes, sRes, mRes, csRes] = await Promise.all([
        api.products(),
        api.warehouses(),
        api.departments(),
        api.suppliers(),
        api.movements(typeFilter || undefined),
        api.countSheets(),
      ]);
      setProducts(pRes.items);
      setWarehouses(wRes);
      setDepartments(dRes);
      setSuppliers(sRes);
      setMovements(mRes.items);
      setCountSheets(csRes.items);
      if (!productId && pRes.items[0]) {
        setProductId(String(pRes.items[0].id));
        setUnitId(String(pRes.items[0].baseUnitId));
      }
      if (!warehouseId && wRes[0]) setWarehouseId(String(wRes[0].id));
      if (!toWarehouseId && wRes[1]) setToWarehouseId(String(wRes[1].id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [typeFilter, productId, warehouseId, toWarehouseId]);

  useEffect(() => {
    load();
  }, [load]);

  const currentProduct = products.find((p) => String(p.id) === productId);
  const availableUnits = currentProduct
    ? [
        { id: currentProduct.baseUnitId, label: `${currentProduct.baseUnit} (base unit × 1)` },
        ...currentProduct.packagings.map((g) => ({ id: g.unitId, label: `${g.unit} (× ${g.factor} ${currentProduct.baseUnit})` })),
      ]
    : [];

  async function handleSubmitMovement(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMsg('');
    try {
      if (mode === 'count-sheets') {
        const sheet = await api.createCountSheet({
          warehouseId: Number(warehouseId),
          reference: reference.trim() || undefined,
          notes: reason.trim() || undefined,
          lines: [{ productId: Number(productId), unitId: Number(unitId), countedQuantity: Number(quantity) }],
        });
        setSelectedSheet(sheet);
        setMsg(`Draft Count Sheet #${sheet.id} created. Review variance below.`);
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
      await load();
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

  async function handleApproveSheet(id: number) {
    setError('');
    setMsg('');
    try {
      const res = await api.approveCountSheet(id);
      setSelectedSheet(res.sheet);
      setMsg(`Count Sheet #${id} approved and posted to the stock ledger.`);
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

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Stock Movements &amp; Operations</h1>
          <p className="muted">Record receipts, issues, transfers, adjustments, write-offs, count sheets and authorised reversals.</p>
        </div>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      {msg && <p className="form-success" role="status">{msg}</p>}

      <section className="card">
        <div className="tabs" role="tablist">
          {(
            [
              ['receipts', 'Receive Stock'],
              ['issues', 'Issue to Dept'],
              ['transfers', 'Transfer Warehouse'],
              ['adjustments', 'Adjustment'],
              ['write-offs', 'Write-Off'],
              ['count-sheets', 'Count Sheets'],
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

        <form className="form-grid" onSubmit={handleSubmitMovement} style={{ marginTop: '1rem' }}>
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
            {mode === 'transfers' ? 'From Warehouse' : 'Warehouse'}
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </label>

          {mode === 'transfers' && (
            <label>
              To Warehouse
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
              {availableUnits.map((u) => (
                <option key={u.id} value={u.id}>{u.label}</option>
              ))}
            </select>
          </label>

          <label>
            {mode === 'count-sheets' ? 'Counted Quantity' : mode === 'adjustments' ? 'Signed Quantity (+/-)' : 'Quantity'}
            <input type="number" step="0.001" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
          </label>

          {mode === 'receipts' && (
            <>
              <label>
                Supplier
                <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                  <option value="">— Optional —</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </label>
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

          {(mode === 'issues' || mode === 'write-offs') && (
            <label>
              Department (same branch)
              <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                <option value="">— Optional —</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </label>
          )}

          <label>
            Document Reference
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. GRN-104 / REQ-22" />
          </label>

          {(mode === 'adjustments' || mode === 'write-offs' || mode === 'count-sheets') && (
            <label>
              {mode === 'count-sheets' ? 'Count Notes' : 'Reason (required)'}
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason for stock variance or write-off"
                required={mode !== 'count-sheets'}
              />
            </label>
          )}

          <div className="form-actions">
            <button className="btn btn-primary" type="submit">
              {mode === 'count-sheets' ? 'Save Draft Count Sheet' : `Post ${mode.replace('-', ' ').slice(0, -1)}`}
            </button>
          </div>
        </form>
      </section>

      {countSheets.length > 0 && (
        <section className="card" style={{ marginTop: '1.25rem' }}>
          <div className="section-head">
            <h2>Physical Count Sheets ({countSheets.length})</h2>
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
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {countSheets.map((cs) => (
                  <tr key={cs.id}>
                    <td>#{cs.id}</td>
                    <td>{cs.warehouseName}</td>
                    <td>{cs.reference ?? '—'}</td>
                    <td>{cs.notes ?? '—'}</td>
                    <td>
                      <span className={`badge badge-${cs.status === 'approved' ? 'receipt' : 'count'}`}>{cs.status}</span>
                    </td>
                    <td className="action-row">
                      <button className="btn btn-outline btn-sm" type="button" onClick={() => handleInspectSheet(cs.id)}>
                        View Variances
                      </button>
                      {cs.status === 'draft' && isExec && (
                        <button className="btn btn-primary btn-sm" type="button" onClick={() => handleApproveSheet(cs.id)}>
                          Approve &amp; Post
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selectedSheet && (
            <div className="subcard" style={{ marginTop: '1rem' }}>
              <h3>
                Count Sheet #{selectedSheet.id} — {selectedSheet.warehouseName} ({selectedSheet.status})
              </h3>
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
                      <td>{l.productName}</td>
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
        </section>
      )}

      <section className="card" style={{ marginTop: '1.25rem' }}>
        <div className="section-head">
          <h2>Authoritative Stock Movement Ledger</h2>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">All Document Types</option>
            <option value="receipt">Receipts</option>
            <option value="issue">Issues</option>
            <option value="transfer">Transfers</option>
            <option value="adjustment">Adjustments</option>
            <option value="count">Counts</option>
            <option value="write_off">Write-Offs</option>
            <option value="reversal">Reversals</option>
          </select>
        </div>
        {loading ? (
          <Spinner label="Loading ledger" />
        ) : (
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
                  {isExec && <th>Audit Action</th>}
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
                      <td>
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
        )}
      </section>
    </>
  );
}
