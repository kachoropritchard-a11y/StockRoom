import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type ProductItem, type RequisitionSummary } from '../api';
import { AccessibleTabs, type TabDefinition } from '../components/AccessibleTabs';
import { QuickTransferModal } from '../components/QuickTransferModal';
import { Spinner } from '../components/Spinner';
import { useZim } from '../zimContext';

type TransferSubTab = 'move' | 'auto_breakbulk';

export function Transfers() {
  const { subLabel } = useZim();
  const [activeTab, setActiveTab] = useState<TransferSubTab>('move');
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [warehouses, setWarehouses] = useState<{ id: number; name: string }[]>([]);
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);
  const [requisitions, setRequisitions] = useState<RequisitionSummary[]>([]);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  // Sub-Menu 1: Move Between Depts / Branches state
  const [reqKind, setReqKind] = useState<'warehouse_transfer' | 'department_issue'>('warehouse_transfer');
  const [fromWhId, setFromWhId] = useState('');
  const [toWhId, setToWhId] = useState('');
  const [deptId, setDeptId] = useState('');
  const [prodId, setProdId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [qty, setQty] = useState('10');

  // Sub-Menu 2: Auto Break-Bulk Calculator state
  const [calcProdId, setCalcProdId] = useState('');
  const [calcPacksCount, setCalcPacksCount] = useState('5');

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
        setCalcProdId((prev) => prev || String(first.id));
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
    try {
      const created = await api.createRequisition({
        kind: reqKind,
        warehouseId: Number(fromWhId),
        departmentId: reqKind === 'department_issue' ? Number(deptId) : null,
        toWarehouseId: reqKind === 'warehouse_transfer' ? Number(toWhId) : null,
        reference: `TRF-${Date.now().toString().slice(-5)}`,
        lines: [
          {
            productId: Number(prodId),
            unitId: Number(unitId),
            requestedQuantity: Number(qty),
          },
        ],
      });
      setMsg(`Transfer / Requisition #${created.id} (${created.reference}) created.`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleFulfillReq(id: number) {
    setError('');
    setMsg('');
    try {
      await api.fulfillRequisition(id, 'Dispatched on storefloor');
      setMsg(`Requisition #${id} fulfilled and posted to the stock ledger.`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const selectedProduct = products.find((p) => String(p.id) === prodId);
  const availableUnits = selectedProduct
    ? [
        { id: selectedProduct.baseUnitId, label: `${selectedProduct.baseUnit} (Base Unit × 1)` },
        ...selectedProduct.packagings.map((g) => ({
          id: g.unitId,
          label: `${g.unit} (Bulk Pack × ${g.factor} ${selectedProduct.baseUnit})`,
        })),
      ]
    : [];

  const calcProduct = products.find((p) => String(p.id) === calcProdId) ?? products[0];
  const primaryPack = calcProduct?.packagings[0];
  const calcFactor = primaryPack?.factor ?? 1;
  const calcPacks = Math.max(0, Number(calcPacksCount) || 0);
  const calcResultSingles = calcPacks * calcFactor;

  const productsWithPackaging = products.filter((p) => p.packagings.length > 0);

  const tabs: TabDefinition<TransferSubTab>[] = [
    {
      key: 'move',
      label: '1. Move Between Depts & Branches',
      badge: requisitions.length,
      purpose: 'Transfer stock between warehouses or issue stock to active storefloor departments.',
    },
    {
      key: 'auto_breakbulk',
      label: '2. Auto Break-Bulk & Pack Rules',
      badge: productsWithPackaging.length,
      purpose: 'The system breaks bulk itself: cartons and bales automatically unpack into retail singles upon receipt.',
    },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Department &amp; Store Transfers</h1>
          <span className="vernacular-sub">
            {subLabel(
              'Kufambisa Zvinhu Pakati peMathipatimendi neMaturu • Kupatsanura Mabhero Nekukasira',
              'Ukuthutha Impahla Phakathi Kwamawodi Lesitolo • Ukuhlukanisa Amabhele',
            )}
          </span>
        </div>
        <div className="quick-actions">
          <button type="button" className="btn btn-primary" onClick={() => setTransferModalOpen(true)}>
            ⇄ Instant Store-to-Store Transfer (Alt+T)
          </button>
        </div>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      {msg && <p className="form-success" role="status">{msg}</p>}

      <section className="card">
        {/* TIER 3: Horizontal In-Page Sub-Menu Bar */}
        <AccessibleTabs
          idPrefix="transfers"
          ariaLabel="Transfers and auto break-bulk sub-menus"
          tabs={tabs}
          active={activeTab}
          onChange={setActiveTab}
        />

        {/* SUB-MENU 1: Move Between Depts / Branches */}
        {activeTab === 'move' && (
          <div id="transfers-panel-move" role="tabpanel" aria-labelledby="transfers-tab-move">
            <form className="form-grid subcard" style={{ marginBottom: '1.25rem' }} onSubmit={handleCreateTransferOrReq}>
              <label>
                Transfer Type
                <select
                  value={reqKind}
                  onChange={(e) => setReqKind(e.target.value as 'warehouse_transfer' | 'department_issue')}
                >
                  <option value="warehouse_transfer">Warehouse / Store-to-Store Transfer</option>
                  <option value="department_issue">Department Storefloor Requisition</option>
                </select>
              </label>

              <label>
                Source Warehouse / Storeroom
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
                  Destination Warehouse / Yard
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
                  Destination Department
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
                Product to Transfer
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
                      {p.name} ({p.sku}) — Stock: {p.totalStock} {p.baseUnit}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Packaging Unit
                <select value={unitId} onChange={(e) => setUnitId(e.target.value)} required>
                  {availableUnits.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Quantity to Move
                <input type="number" min="1" step="any" value={qty} onChange={(e) => setQty(e.target.value)} required />
              </label>

              <div className="form-actions">
                <button type="submit" className="btn btn-primary">
                  ⇄ Submit Stock Movement
                </button>
              </div>
            </form>

            <div className="section-head" style={{ marginBottom: '0.75rem' }}>
              <div>
                <h3 style={{ margin: 0 }}>Pending Internal Requisitions &amp; Transfers Queue</h3>
                <span className="vernacular-sub" style={{ fontSize: '0.82rem' }}>
                  Authorize or dispatch stock movements between storerooms and sales departments.
                </span>
              </div>
            </div>

            {loading ? (
              <div style={{ padding: '2.5rem', textAlign: 'center' }}>
                <Spinner label="Loading requisitions and transfers" />
                <p className="muted" style={{ marginTop: '0.5rem' }}>
                  Loading transfer queue…
                </p>
              </div>
            ) : requisitions.length === 0 ? (
              <div className="empty-state-box" style={{ padding: '2.5rem', textAlign: 'center' }}>
                <p className="muted" style={{ margin: 0 }}>
                  No pending internal requisitions. Use the form above or the Instant Transfer button to move stock.
                </p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Ref #</th>
                      <th>Type</th>
                      <th>Source</th>
                      <th>Destination</th>
                      <th className="num">Lines</th>
                      <th>Status</th>
                      <th>Date</th>
                      <th className="num">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requisitions.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <code>{r.reference}</code>
                        </td>
                        <td style={{ textTransform: 'capitalize' }}>{r.kind.replace('_', ' ')}</td>
                        <td>{r.warehouseName}</td>
                        <td>{r.toWarehouseName || r.departmentName || '—'}</td>
                        <td className="num">{r.lineCount}</td>
                        <td>
                          <span
                            className={`status-pill ${
                              r.status === 'fulfilled' ? 'optimal' : r.status === 'pending' ? 'low' : 'warn'
                            }`}
                          >
                            {r.status}
                          </span>
                        </td>
                        <td>{r.createdAt.slice(0, 10)}</td>
                        <td className="num">
                          {r.status === 'pending' && (
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={() => handleFulfillReq(r.id)}
                            >
                              ✓ Dispatch &amp; Post
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

        {/* SUB-MENU 2: Automatic Break-Bulk & Pack Rules */}
        {activeTab === 'auto_breakbulk' && (
          <div id="transfers-panel-auto-breakbulk" role="tabpanel" aria-labelledby="transfers-tab-auto-breakbulk">
            <div
              className="subcard"
              style={{
                marginBottom: '1.25rem',
                borderLeft: '4px solid var(--emerald)',
                background: 'var(--surface-alt)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.85rem' }}>
                <span style={{ fontSize: '1.75rem', lineHeight: 1 }}>📦</span>
                <div>
                  <h3 style={{ margin: '0 0 0.35rem', color: 'var(--charcoal)' }}>
                    Automatic Break-Bulk Enabled
                  </h3>
                  <p style={{ margin: 0, fontSize: '0.86rem', color: 'var(--muted)', lineHeight: 1.5 }}>
                    The system automatically breaks bulk itself: whenever you receive wholesale deliveries or issue stock in
                    crates, master cartons, or bales, the inventory engine multiplies by each product’s declared packaging ratio
                    and immediately credits single shelf units to stock. No manual unpacking forms or yield batches are needed.
                  </p>
                </div>
              </div>
            </div>

            {/* Quick Auto Break-Bulk Calculator */}
            <div className="subcard" style={{ marginBottom: '1.25rem' }}>
              <div className="section-head" style={{ marginBottom: '0.75rem' }}>
                <div>
                  <h4 style={{ margin: 0 }}>Pack Breakdown Simulator</h4>
                  <span className="muted" style={{ fontSize: '0.8rem' }}>
                    Quickly check how many single retail units the system automatically unpacks when receiving full cases.
                  </span>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 2fr', gap: '1rem', alignItems: 'end' }}>
                <label>
                  Select Product
                  <select value={calcProdId} onChange={(e) => setCalcProdId(e.target.value)}>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.sku})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Full Cases / Packs
                  <input
                    type="number"
                    min="1"
                    value={calcPacksCount}
                    onChange={(e) => setCalcPacksCount(e.target.value)}
                  />
                </label>
                <div
                  style={{
                    padding: '0.65rem 1rem',
                    background: 'var(--surface)',
                    border: '1.5px solid var(--line)',
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <span className="muted" style={{ fontSize: '0.8rem' }}>Auto-Breaks Into:</span>
                  <strong style={{ fontSize: '1.15rem', color: 'var(--emerald)' }}>
                    {calcResultSingles.toLocaleString()} {calcProduct?.baseUnit ?? 'Singles'}
                  </strong>
                </div>
              </div>
              {primaryPack ? (
                <div className="muted" style={{ fontSize: '0.76rem', marginTop: '0.5rem' }}>
                  Ratio: 1 {primaryPack.unit} = {primaryPack.factor} {calcProduct?.baseUnit}
                </div>
              ) : (
                <div className="muted" style={{ fontSize: '0.76rem', marginTop: '0.5rem' }}>
                  No bulk pack configured yet. Ratio defaults to 1:1.
                </div>
              )}
            </div>

            {/* Registered Packaging Rules & Auto-Break Status */}
            <div className="section-head" style={{ marginBottom: '0.75rem' }}>
              <div>
                <h3 style={{ margin: 0 }}>Active Store Catalog Packaging Rules</h3>
                <span className="vernacular-sub" style={{ fontSize: '0.82rem' }}>
                  Products configured with wholesale carton, bale, or box factors that auto-convert upon receiving.
                </span>
              </div>
            </div>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Product &amp; SKU</th>
                    <th>Base Single Unit</th>
                    <th>Bulk Packaging Ratio</th>
                    <th className="num">Single Units On Hand</th>
                    <th className="num">Equivalent Full Cases</th>
                    <th>Break-Bulk Engine</th>
                  </tr>
                </thead>
                <tbody>
                  {products.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="muted text-center" style={{ padding: '2.5rem', color: 'var(--muted)' }}>
                        No products registered in the system yet.
                      </td>
                    </tr>
                  ) : (
                    products.map((p) => {
                      const pack = p.packagings[0];
                      const factor = pack?.factor ?? 1;
                      const fullPacks = Math.floor(p.totalStock / factor);
                      const loose = p.totalStock % factor;

                      return (
                        <tr key={p.id}>
                          <td>
                            <strong>{p.name}</strong> <code>({p.sku})</code>
                          </td>
                          <td>
                            <span className="status-pill optimal" style={{ textTransform: 'lowercase' }}>
                              {p.baseUnit}
                            </span>
                          </td>
                          <td>
                            {p.packagings.length > 0 ? (
                              p.packagings.map((g) => (
                                <span
                                  key={g.id}
                                  style={{
                                    display: 'inline-block',
                                    padding: '0.2rem 0.5rem',
                                    background: 'var(--surface-alt)',
                                    borderRadius: '6px',
                                    border: '1px solid var(--line)',
                                    fontSize: '0.8rem',
                                    fontWeight: 700,
                                    marginRight: '0.35rem',
                                  }}
                                >
                                  1 {g.unit} = {g.factor} {p.baseUnit}
                                </span>
                              ))
                            ) : (
                              <span className="muted" style={{ fontSize: '0.8rem' }}>
                                Sold only as singles ({p.baseUnit})
                              </span>
                            )}
                          </td>
                          <td className="num">
                            <strong>{p.totalStock.toLocaleString()} {p.baseUnit}</strong>
                          </td>
                          <td className="num">
                            {pack ? (
                              <span style={{ fontWeight: 700, color: 'var(--charcoal)' }}>
                                {fullPacks} {pack.unit}(s) {loose > 0 ? `+ ${loose} ${p.baseUnit}` : ''}
                              </span>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td>
                            <span
                              className="status-pill optimal"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                            >
                              <span className="live-dot" style={{ background: 'var(--emerald)' }} />
                              Auto-Active
                            </span>
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
