import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type ProductItem, type RequisitionSummary } from '../api';
import { AccessibleTabs, type TabDefinition } from '../components/AccessibleTabs';
import { QuickTransferModal } from '../components/QuickTransferModal';
import { Spinner } from '../components/Spinner';
import { useZim } from '../zimContext';

type TransferSubTab = 'transfer' | 'history';

export function Transfers() {
  const { subLabel } = useZim();
  const [activeTab, setActiveTab] = useState<TransferSubTab>('transfer');
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [warehouses, setWarehouses] = useState<{ id: number; name: string }[]>([]);
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);
  const [requisitions, setRequisitions] = useState<RequisitionSummary[]>([]);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  // Transfer Form State
  const [reqKind, setReqKind] = useState<'warehouse_transfer' | 'department_issue'>('warehouse_transfer');
  const [fromWhId, setFromWhId] = useState('');
  const [toWhId, setToWhId] = useState('');
  const [deptId, setDeptId] = useState('');
  const [prodId, setProdId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [qty, setQty] = useState('10');
  const [transferNotes, setTransferNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, wRes, dRes, rRes] = await Promise.all([
        api.products('', { limit: 200 }),
        api.warehouses(),
        api.departments(),
        api.requisitions(),
      ]);
      setProducts(pRes.items);
      setWarehouses(wRes);
      setDepartments(dRes);
      setRequisitions(rRes.items);

      if (pRes.items[0]) {
        const first = pRes.items[0];
        setProdId((prev) => {
          if (prev) return prev;
          setUnitId(String(first.baseUnitId));
          return String(first.id);
        });
      }
      if (wRes[0]) {
        const w0 = String(wRes[0].id);
        setFromWhId((prev) => prev || w0);
      }
      if (wRes[1]) {
        setToWhId((prev) => prev || String(wRes[1].id));
      }
      if (dRes[0]) {
        setDeptId((prev) => prev || String(dRes[0].id));
      }
    } catch (e) {
      setError((e as Error).message);
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

  async function handleCreateTransferOrReq(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMsg('');
    setBusy(true);

    if (reqKind === 'warehouse_transfer' && fromWhId === toWhId) {
      setError('Source and destination locations cannot be the same.');
      setBusy(false);
      return;
    }

    try {
      const created = await api.createRequisition({
        kind: reqKind,
        warehouseId: Number(fromWhId),
        departmentId: reqKind === 'department_issue' ? Number(deptId) : null,
        toWarehouseId: reqKind === 'warehouse_transfer' ? Number(toWhId) : null,
        reference: `TRF-${Date.now().toString().slice(-5)}`,
        notes: transferNotes.trim() || undefined,
        lines: [
          {
            productId: Number(prodId),
            unitId: Number(unitId),
            requestedQuantity: Number(qty),
          },
        ],
      });

      // Immediately fulfill the transfer so stock moves in real time
      await api.fulfillRequisition(created.id, 'Storefloor transfer dispatch');

      const movedProd = products.find((p) => String(p.id) === prodId);
      const fromName = warehouses.find((w) => String(w.id) === fromWhId)?.name ?? 'Source';
      const toName =
        reqKind === 'warehouse_transfer'
          ? warehouses.find((w) => String(w.id) === toWhId)?.name ?? 'Destination'
          : departments.find((d) => String(d.id) === deptId)?.name ?? 'Department';

      setMsg(`✓ Successfully moved ${qty} ${movedProd?.baseUnit ?? 'units'} of "${movedProd?.name}" from ${fromName} to ${toName}.`);
      setTransferNotes('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const selectedProduct = products.find((p) => String(p.id) === prodId);
  const fromWh = warehouses.find((w) => String(w.id) === fromWhId);
  const toWh = warehouses.find((w) => String(w.id) === toWhId);
  const targetDept = departments.find((d) => String(d.id) === deptId);

  const tabs: TabDefinition<TransferSubTab>[] = [
    {
      key: 'transfer',
      label: '1. Department & Warehouse Stock Transfer',
      badge: undefined,
      purpose: 'Move stock directly between storefloor departments, reserves, and outdoor storage yards.',
    },
    {
      key: 'history',
      label: '2. Inter-Department Transfer History',
      badge: requisitions.length,
      purpose: 'Authoritative audit history of stock transfers and department issues across the business.',
    },
  ];

  if (loading && products.length === 0) {
    return <Spinner label="Loading Stock Transfers..." fullPage />;
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Department &amp; Stock Transfers</h1>
          <span className="vernacular-sub">
            {subLabel(
              'Kufambisa Zvinhu Pakati peMathipatimendi neMaturu',
              'Ukuthutha Impahla Phakathi Kwamawodi Lesitolo',
              'Move stock between departments, retail storefloors, and storage yards with live ledger verification.',
            )}
          </span>
        </div>
        <div className="quick-actions">
          <button type="button" className="btn btn-primary" onClick={() => setTransferModalOpen(true)}>
            ⇄ Fast Stock Transfer (Alt+T)
          </button>
        </div>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      {msg && <p className="form-success" role="status">{msg}</p>}

      <section className="card">
        <AccessibleTabs
          idPrefix="transfers"
          ariaLabel="Stock transfer tabs"
          tabs={tabs}
          active={activeTab}
          onChange={setActiveTab}
        />

        {/* SUB-MENU 1: Move Stock Between Departments */}
        {activeTab === 'transfer' && (
          <div id="transfers-panel-transfer" role="tabpanel" aria-labelledby="transfers-tab-transfer" style={{ marginTop: '1.25rem' }}>
            <form className="form-grid subcard" style={{ marginBottom: '1.25rem' }} onSubmit={handleCreateTransferOrReq}>
              <label>
                Transfer Type *
                <select
                  value={reqKind}
                  onChange={(e) => setReqKind(e.target.value as 'warehouse_transfer' | 'department_issue')}
                >
                  <option value="warehouse_transfer">Warehouse / Store-to-Store Transfer</option>
                  <option value="department_issue">Department Storefloor Requisition / Issue</option>
                </select>
              </label>

              <label>
                Source Department / Storeroom *
                <select value={fromWhId} onChange={(e) => setFromWhId(e.target.value)} required>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>

              {reqKind === 'warehouse_transfer' ? (
                <label>
                  Destination Department / Yard *
                  <select value={toWhId} onChange={(e) => setToWhId(e.target.value)} required>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id} disabled={String(w.id) === fromWhId}>
                        {w.name} {String(w.id) === fromWhId ? '(Source Store)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label>
                  Destination Storefloor Department *
                  <select value={deptId} onChange={(e) => setDeptId(e.target.value)} required>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label>
                Product to Move *
                <select
                  value={prodId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setProdId(id);
                    const p = products.find((x) => String(x.id) === id);
                    if (p) setUnitId(String(p.baseUnitId));
                  }}
                  required
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku}) — Total Store Stock: {p.totalStock} {p.baseUnit}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Quantity to Move ({selectedProduct?.baseUnit ?? 'units'}) *
                <input
                  type="number"
                  min="0.001"
                  step="any"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  required
                />
              </label>

              <label>
                Transfer Notes / Reason (Optional)
                <input
                  type="text"
                  placeholder="e.g. Restocking front display shelves from yard"
                  value={transferNotes}
                  onChange={(e) => setTransferNotes(e.target.value)}
                />
              </label>

              {/* Movement Preview Banner */}
              <div
                style={{
                  gridColumn: '1 / -1',
                  padding: '0.85rem 1.25rem',
                  background: 'var(--surface-alt)',
                  border: '1.5px solid var(--line)',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '1rem',
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <span className="muted" style={{ fontSize: '0.78rem', textTransform: 'uppercase' }}>
                    Movement Summary
                  </span>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem', marginTop: '0.15rem' }}>
                    Moving <span style={{ color: 'var(--accent, #0284c7)' }}>{qty} {selectedProduct?.baseUnit ?? 'units'}</span> of <strong>{selectedProduct?.name}</strong>
                  </div>
                  <div style={{ fontSize: '0.84rem', opacity: 0.85, marginTop: '0.1rem' }}>
                    From: <strong>{fromWh?.name}</strong> → To: <strong>{reqKind === 'warehouse_transfer' ? toWh?.name : targetDept?.name}</strong>
                  </div>
                </div>

                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? 'Moving Stock…' : '⇄ Confirm & Move Stock Now'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* SUB-MENU 2: Inter-Department Transfer History */}
        {activeTab === 'history' && (
          <div id="transfers-panel-history" role="tabpanel" aria-labelledby="transfers-tab-history" style={{ marginTop: '1.25rem' }}>
            <div className="section-head" style={{ marginBottom: '0.75rem' }}>
              <div>
                <h3 style={{ margin: 0 }}>Stock Movement &amp; Requisition Ledger</h3>
                <span className="vernacular-sub" style={{ fontSize: '0.82rem' }}>
                  Authoritative record of inter-department transfers and storefloor stock requisitions.
                </span>
              </div>
            </div>

            {requisitions.length === 0 ? (
              <div className="empty-state-box" style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
                <p className="muted" style={{ margin: 0 }}>
                  No stock transfers recorded yet. Use the transfer form above or press Alt+T for fast transfers.
                </p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Ref #</th>
                      <th>Type</th>
                      <th>From Location</th>
                      <th>To Department / Store</th>
                      <th className="num">Items Count</th>
                      <th>Status</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requisitions.map((r) => (
                      <tr key={r.id}>
                        <td><code>{r.reference}</code></td>
                        <td>
                          {r.kind === 'warehouse_transfer'
                            ? '⇄ Warehouse Transfer'
                            : '📋 Storefloor Issue'}
                        </td>
                        <td>{r.warehouseName}</td>
                        <td>{r.departmentName ?? r.toWarehouseName ?? '—'}</td>
                        <td className="num">{r.lineCount}</td>
                        <td>
                          <span
                            className={`status-pill ${
                              r.status === 'fulfilled'
                                ? 'optimal'
                                : r.status === 'pending'
                                ? 'warn'
                                : 'danger'
                            }`}
                          >
                            {r.status.toUpperCase()}
                          </span>
                        </td>
                        <td>{r.createdAt.slice(0, 10)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Instant Quick-Transfer Modal */}
      <QuickTransferModal
        open={transferModalOpen}
        onClose={() => setTransferModalOpen(false)}
        onSuccess={(m) => {
          setMsg(m);
          load();
        }}
      />
    </>
  );
}
