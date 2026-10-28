import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type BalanceItem, type CountSheetSummary, type ProductItem } from '../api';
import { AccessibleTabs, type TabDefinition } from '../components/AccessibleTabs';
import { Spinner } from '../components/Spinner';
import { useAuth } from '../auth';
import { useZim } from '../zimContext';

type StockCountSubTab = 'count' | 'history' | 'reorder';

export function StockCount() {
  const { user } = useAuth();
  const { subLabel, formatMoney } = useZim();
  const isExec = user?.role === 'executive_manager';

  const [activeTab, setActiveTab] = useState<StockCountSubTab>('count');
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [warehouses, setWarehouses] = useState<{ id: number; name: string }[]>([]);
  const [balances, setBalances] = useState<BalanceItem[]>([]);
  const [countSheets, setCountSheets] = useState<CountSheetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  // Form state
  const [selectedWhId, setSelectedWhId] = useState('');
  const [selectedProdId, setSelectedProdId] = useState('');
  const [countedQty, setCountedQty] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, wRes, bRes, csRes] = await Promise.all([
        api.products('', { limit: 200 }),
        api.warehouses(),
        api.balances(),
        api.countSheets(),
      ]);
      setProducts(pRes.items);
      setWarehouses(wRes);
      setBalances(bRes.items);
      setCountSheets(csRes.items);

      if (wRes[0]) setSelectedWhId((prev) => prev || String(wRes[0].id));
      if (pRes.items[0]) setSelectedProdId((prev) => prev || String(pRes.items[0].id));
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

  const activeProduct = products.find((p) => String(p.id) === selectedProdId);
  const currentBalance = balances.find(
    (b) => String(b.productId) === selectedProdId && String(b.warehouseId) === selectedWhId,
  );
  const systemQty = currentBalance ? currentBalance.quantity : 0;
  const countedNum = countedQty === '' ? null : Number(countedQty);
  const variance = countedNum === null ? null : countedNum - systemQty;

  async function handleCreateCountSheet(e: FormEvent) {
    e.preventDefault();
    if (countedNum === null || isNaN(countedNum)) {
      setError('Please enter a valid physical count quantity.');
      return;
    }
    setError('');
    setMsg('');
    setBusy(true);
    try {
      const sheet = await api.createCountSheet({
        warehouseId: Number(selectedWhId),
        reference: reference.trim() || `COUNT-${Date.now().toString().slice(-5)}`,
        lines: [
          {
            productId: Number(selectedProdId),
            unitId: activeProduct?.baseUnitId ?? 1,
            countedQuantity: countedNum,
          },
        ],
      });

      if (isExec || variance === 0) {
        try {
          await api.approveCountSheet(sheet.id, 'Physical stock count verified');
          setMsg(`Count Sheet #${sheet.id} submitted & approved: ledger balance updated to ${countedNum} ${activeProduct?.baseUnit ?? 'units'}.`);
        } catch {
          setMsg(`Count Sheet #${sheet.id} created with variance of ${variance}. Routed for executive review.`);
        }
      } else {
        setMsg(`Count Sheet #${sheet.id} created with variance of ${variance}. Routed to Executive Manager approvals.`);
      }

      setCountedQty('');
      setReference('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleApproveSheet(id: number) {
    setError('');
    setMsg('');
    try {
      await api.approveCountSheet(id, 'Physical count approved by manager');
      setMsg(`Count Sheet #${id} approved and posted to the authoritative ledger.`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleCancelSheet(id: number) {
    if (!window.confirm(`Are you sure you want to cancel draft Count Sheet #${id}?`)) return;
    setError('');
    setMsg('');
    try {
      await api.cancelCountSheet(id);
      setMsg(`Count Sheet #${id} has been cancelled.`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const lowStockItems = products.filter((p) => p.totalStock <= p.reorderLevel && p.reorderLevel > 0);

  const tabs: TabDefinition<StockCountSubTab>[] = [
    {
      key: 'count',
      label: '1. Manual Stock Count Sheet',
      badge: undefined,
      purpose: 'Count physical goods on shelves and reconcile against system ledger stock.',
    },
    {
      key: 'history',
      label: '2. Count History & Variances',
      badge: countSheets.length,
      purpose: 'Review past count sheets, audit variance records, and approve adjustments.',
    },
    {
      key: 'reorder',
      label: '3. Low Stock & Reorder Alerts',
      badge: lowStockItems.length > 0 ? lowStockItems.length : undefined,
      purpose: 'Products running low that need immediate restocking.',
    },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Stock Count &amp; Reconciliation</h1>
          <span className="vernacular-sub">
            {subLabel(
              'Kuverenga Zvinhu zvepaSherufu • Kuenzanisa neZviri muSystem',
              'Ukubala Impahla Yesitolo • Ukuqathanisa Lezisemagwalweni',
            )}
          </span>
        </div>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      {msg && <p className="form-success" role="status">{msg}</p>}

      <section className="card">
        {/* TIER 3: Horizontal Sub-Menu Tabs */}
        <AccessibleTabs
          idPrefix="stock-count"
          ariaLabel="Physical stock count sections"
          tabs={tabs}
          active={activeTab}
          onChange={setActiveTab}
        />

        {/* SUB-MENU 1: Manual Stock Count Sheet Form */}
        {activeTab === 'count' && (
          <div id="stock-count-panel-count" role="tabpanel" aria-labelledby="stock-count-tab-count">
            <div
              className="subcard"
              style={{
                marginBottom: '1.25rem',
                borderLeft: '4px solid var(--emerald)',
                background: 'var(--surface-alt)',
              }}
            >
              <h3 style={{ margin: '0 0 0.35rem', color: 'var(--charcoal)' }}>
                Physical Stocktake Verification
              </h3>
              <p style={{ margin: 0, fontSize: '0.86rem', color: 'var(--muted)', lineHeight: 1.5 }}>
                Count the items currently sitting on your shelves, racks, or yard bays. Enter the counted quantity below
                to automatically compare against what the system expects. Discrepancies are logged as variances and posted
                to adjust the authoritative stock ledger.
              </p>
            </div>

            <form className="form-grid subcard" style={{ marginBottom: '1.5rem' }} onSubmit={handleCreateCountSheet}>
              <label>
                Store / Warehouse Location
                <select value={selectedWhId} onChange={(e) => setSelectedWhId(e.target.value)} required>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Product to Count
                <select value={selectedProdId} onChange={(e) => setSelectedProdId(e.target.value)} required>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku}) — Total: {p.totalStock} {p.baseUnit}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Count Reference / Batch Label (Optional)
                <input
                  type="text"
                  placeholder="e.g. End of Month Shelf Count"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </label>

              <label>
                Physical Counted Quantity ({activeProduct?.baseUnit ?? 'units'})
                <input
                  type="number"
                  step="any"
                  min="0"
                  placeholder="e.g. 45"
                  value={countedQty}
                  onChange={(e) => setCountedQty(e.target.value)}
                  required
                />
              </label>

              {/* Live Variance Calculation Card */}
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
                    System Expected Balance
                  </span>
                  <div style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--charcoal)', marginTop: '0.2rem' }}>
                    {systemQty.toLocaleString()} {activeProduct?.baseUnit ?? 'units'}
                  </div>
                </div>

                <div>
                  <span className="muted" style={{ fontSize: '0.78rem', textTransform: 'uppercase' }}>
                    Your Physical Count
                  </span>
                  <div style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--charcoal)', marginTop: '0.2rem' }}>
                    {countedNum !== null ? `${countedNum.toLocaleString()} ${activeProduct?.baseUnit ?? 'units'}` : '—'}
                  </div>
                </div>

                <div>
                  <span className="muted" style={{ fontSize: '0.78rem', textTransform: 'uppercase' }}>
                    Calculated Variance
                  </span>
                  <div
                    style={{
                      fontSize: '1.35rem',
                      fontWeight: 800,
                      marginTop: '0.2rem',
                      color:
                        variance === null
                          ? 'var(--muted)'
                          : variance === 0
                          ? 'var(--emerald)'
                          : variance > 0
                          ? 'var(--zim-gold-500)'
                          : 'var(--danger)',
                    }}
                  >
                    {variance === null
                      ? '—'
                      : variance === 0
                      ? '✓ Exact Match (0)'
                      : variance > 0
                      ? `+${variance} (Surplus / Overage)`
                      : `${variance} (Shortage / Shrinkage)`}
                  </div>
                </div>
              </div>

              <div className="form-actions" style={{ gridColumn: '1 / -1' }}>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? 'Saving Count Sheet…' : '✓ Post Physical Stock Count'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* SUB-MENU 2: Count History & Variances */}
        {activeTab === 'history' && (
          <div id="stock-count-panel-history" role="tabpanel" aria-labelledby="stock-count-tab-history">
            <div className="section-head" style={{ marginBottom: '0.75rem' }}>
              <div>
                <h3 style={{ margin: 0 }}>Stocktake &amp; Count Sheets History</h3>
                <span className="vernacular-sub" style={{ fontSize: '0.82rem' }}>
                  Audit log of physical stock counts, variances discovered, and ledger reconciliations.
                </span>
              </div>
            </div>

            {loading ? (
              <div style={{ padding: '3rem', textAlign: 'center' }}>
                <Spinner label="Loading count sheets" />
                <p className="muted" style={{ marginTop: '0.5rem' }}>Loading count sheet records…</p>
              </div>
            ) : countSheets.length === 0 ? (
              <div className="empty-state-box" style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
                <p className="muted" style={{ margin: 0 }}>
                  No stock count sheets recorded yet. Use the Manual Stock Count tab to begin a count.
                </p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Sheet #</th>
                      <th>Reference</th>
                      <th>Location</th>
                      <th className="num">Items</th>
                      <th>Status</th>
                      <th>Recorded By</th>
                      <th>Date</th>
                      <th className="num">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {countSheets.map((cs) => (
                      <tr key={cs.id}>
                        <td>
                          <code>#{cs.id}</code>
                        </td>
                        <td>
                          <strong>{cs.reference || `COUNT-${cs.id}`}</strong>
                        </td>
                        <td>{cs.warehouseName}</td>
                        <td className="num">{cs.lineCount} item(s)</td>
                        <td>
                          <span
                            className={`status-pill ${
                              cs.status === 'approved' ? 'optimal' : cs.status === 'draft' ? 'warn' : 'low'
                            }`}
                          >
                            {cs.status.toUpperCase()}
                          </span>
                        </td>
                        <td>Staff</td>
                        <td>{cs.createdAt.slice(0, 16)}</td>
                        <td className="num">
                          {cs.status === 'draft' && (
                            <div style={{ display: 'inline-flex', gap: '0.4rem' }}>
                              {(isExec || cs.status === 'draft') && (
                                <button
                                  type="button"
                                  className="btn btn-primary btn-sm"
                                  onClick={() => handleApproveSheet(cs.id)}
                                >
                                  ✓ Approve
                                </button>
                              )}
                              <button
                                type="button"
                                className="btn btn-outline btn-sm"
                                style={{ color: 'var(--danger)', borderColor: 'var(--line)' }}
                                onClick={() => handleCancelSheet(cs.id)}
                              >
                                ✕ Cancel
                              </button>
                            </div>
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

        {/* SUB-MENU 3: Low Stock & Reorder Alerts */}
        {activeTab === 'reorder' && (
          <div id="stock-count-panel-reorder" role="tabpanel" aria-labelledby="stock-count-tab-reorder">
            <div className="section-head" style={{ marginBottom: '0.75rem' }}>
              <div>
                <h3 style={{ margin: 0 }}>Low Stock &amp; Critical Depletion Alerts</h3>
                <span className="vernacular-sub" style={{ fontSize: '0.82rem' }}>
                  Goods that have reached or dropped below their minimum safe shelf reorder threshold.
                </span>
              </div>
            </div>

            {lowStockItems.length === 0 ? (
              <div className="empty-state-box" style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
                <p className="muted" style={{ margin: 0 }}>
                  ✓ All stock is healthy! No products are currently below their minimum reorder thresholds.
                </p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Product &amp; SKU</th>
                      <th>Department</th>
                      <th className="num">Current Shelf Stock</th>
                      <th className="num">Reorder Threshold</th>
                      <th className="num">Shortfall</th>
                      <th className="num">Unit Cost</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lowStockItems.map((p) => {
                      const shortfall = Math.max(0, p.reorderLevel - p.totalStock);
                      return (
                        <tr key={p.id}>
                          <td>
                            <strong>{p.name}</strong> <code>({p.sku})</code>
                          </td>
                          <td>{p.departmentName}</td>
                          <td className="num">
                            <strong style={{ color: p.totalStock === 0 ? 'var(--danger)' : 'var(--warning)' }}>
                              {p.totalStock} {p.baseUnit}
                            </strong>
                          </td>
                          <td className="num">
                            {p.reorderLevel} {p.baseUnit}
                          </td>
                          <td className="num">
                            <span className="neg" style={{ color: 'var(--danger)', fontWeight: 700 }}>
                              -{shortfall} {p.baseUnit}
                            </span>
                          </td>
                          <td className="num">{formatMoney(p.unitCost)}</td>
                          <td>
                            <span className={`status-pill ${p.totalStock === 0 ? 'low' : 'warn'}`}>
                              {p.totalStock === 0 ? 'OUT OF STOCK' : 'LOW STOCK'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
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
