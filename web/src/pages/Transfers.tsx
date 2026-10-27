import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type ProductItem, type RequisitionSummary } from '../api';
import { AccessibleTabs, type TabDefinition } from '../components/AccessibleTabs';
import { QuickTransferModal } from '../components/QuickTransferModal';
import { Spinner } from '../components/Spinner';
import { useZim } from '../zimContext';

type TransferSubTab = 'move' | 'breakbulk' | 'yield';

interface BreakBulkLogItem {
  id: string;
  productName: string;
  bulkType: string;
  bulkQtyOpened: number;
  shelfUnitsCreated: number;
  warehouseName: string;
  createdAt: string;
}

interface YieldBatchItem {
  id: string;
  department: 'Butchery' | 'Bakery' | 'Kitchen';
  rawInputDesc: string;
  rawInputWeightKg: number;
  finishedOutputDesc: string;
  finishedUnits: number;
  wasteOrBoneKg: number;
  yieldPct: number;
  createdAt: string;
}

const INITIAL_BREAK_BULK: BreakBulkLogItem[] = [
  {
    id: 'BB-101',
    productName: 'Roil Cooking Oil 2L',
    bulkType: '1 Carton / Case (× 6 bottles)',
    bulkQtyOpened: 5,
    shelfUnitsCreated: 30,
    warehouseName: 'Harare Central Store',
    createdAt: 'Today 08:30 CAT',
  },
  {
    id: 'BB-102',
    productName: 'Chibataura Brown Sugar 2kg',
    bulkType: '1 Master Bale (× 10 packs)',
    bulkQtyOpened: 4,
    shelfUnitsCreated: 40,
    warehouseName: 'Harare Central Store',
    createdAt: 'Yesterday 15:10 CAT',
  },
];

const INITIAL_YIELD_BATCHES: YieldBatchItem[] = [
  {
    id: 'YD-301',
    department: 'Butchery',
    rawInputDesc: 'Whole Beef Hindquarter Carcass',
    rawInputWeightKg: 85,
    finishedOutputDesc: 'T-Bone, Chuck, Boerewors & Soup Bones',
    finishedUnits: 79,
    wasteOrBoneKg: 6,
    yieldPct: 92.9,
    createdAt: 'Today 07:15 CAT',
  },
  {
    id: 'YD-302',
    department: 'Bakery',
    rawInputDesc: '50kg Bakers Flour + Yeast + Sugar + Shortening',
    rawInputWeightKg: 54,
    finishedOutputDesc: 'Fresh Standard White Loaves (700g)',
    finishedUnits: 112,
    wasteOrBoneKg: 1.2,
    yieldPct: 97.8,
    createdAt: 'Today 05:45 CAT',
  },
];

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

  // Sub-Menu 2: Break Bulk state
  const [breakLogs, setBreakLogs] = useState<BreakBulkLogItem[]>(INITIAL_BREAK_BULK);
  const [bbProdId, setBbProdId] = useState('');
  const [bbWhId, setBbWhId] = useState('');
  const [bbBulkLabel, setBbBulkLabel] = useState('1 Master Bale / Case');
  const [bbCasesOpened, setBbCasesOpened] = useState('2');
  const [bbUnitsPerCase, setBbUnitsPerCase] = useState('12');

  // Sub-Menu 3: Recipe / Butchery / Bakery Yield Transformation state
  const [yieldBatches, setYieldBatches] = useState<YieldBatchItem[]>(INITIAL_YIELD_BATCHES);
  const [ydDept, setYdDept] = useState<'Butchery' | 'Bakery' | 'Kitchen'>('Butchery');
  const [ydRawDesc, setYdRawDesc] = useState('Whole Pork Carcass (60kg)');
  const [ydRawKg, setYdRawKg] = useState('60');
  const [ydOutDesc, setYdOutDesc] = useState('Pork Chops, Rashers & Sausages');
  const [ydOutUnits, setYdOutUnits] = useState('56');
  const [ydWasteKg, setYdWasteKg] = useState('4');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, wRes, dRes, rRes, smeRes] = await Promise.all([
        api.products('', { limit: 200 }),
        api.warehouses(),
        api.departments(),
        api.requisitions(),
        api.smeOverview().catch(() => null),
      ]);
      setProducts(pRes.items);
      setWarehouses(wRes);
      setDepartments(dRes);
      setRequisitions(rRes.items);
      if (smeRes && smeRes.yieldBatches.length > 0) {
        const breaks = smeRes.yieldBatches.filter((y) => y.kind === 'BREAK_BULK');
        const yields = smeRes.yieldBatches.filter((y) => y.kind === 'RECIPE_YIELD');
        if (breaks.length > 0) {
          setBreakLogs(
            breaks.map((b) => ({
              id: b.batchRef,
              productName: b.outputName,
              bulkType: b.sourceName,
              bulkQtyOpened: b.inputQty,
              shelfUnitsCreated: b.actualOutputQty,
              warehouseName: b.departmentName,
              createdAt: b.createdAt.slice(0, 16),
            })),
          );
        }
        if (yields.length > 0) {
          setYieldBatches(
            yields.map((y) => ({
              id: y.batchRef,
              department: (y.departmentName as 'Butchery' | 'Bakery' | 'Kitchen') || 'Butchery',
              rawInputDesc: y.sourceName,
              rawInputWeightKg: y.inputQty,
              finishedOutputDesc: y.outputName,
              finishedUnits: y.actualOutputQty,
              wasteOrBoneKg: y.wasteQty,
              yieldPct: y.yieldPct,
              createdAt: y.createdAt.slice(0, 16),
            })),
          );
        }
      }
      if (pRes.items[0]) {
        const first = pRes.items[0];
        setProdId((prev) => {
          if (prev) return prev;
          setUnitId(String(first.baseUnitId));
          return String(first.id);
        });
        setBbProdId((prev) => prev || String(first.id));
      }
      if (wRes[0]) {
        const w0 = String(wRes[0].id);
        setFromWhId((prev) => prev || w0);
        setBbWhId((prev) => prev || w0);
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

  const tabs: TabDefinition<TransferSubTab>[] = [
    {
      key: 'move',
      label: '1. Move Between Depts / Branches',
      badge: requisitions.length,
      purpose: 'Transfer stock between warehouses/branches or fulfill internal department requisitions.',
    },
    {
      key: 'breakbulk',
      label: '2. Break Bulk (Crate/Bale/Sling -> Single Shelf Units)',
      badge: breakLogs.length,
      purpose: 'Open wholesale crates, master sugar bales, or slings into individual retail shelf units.',
    },
    {
      key: 'yield',
      label: '3. Recipe / Butchery / Bakery Yield Transformation',
      badge: yieldBatches.length,
      purpose: 'Convert raw carcasses or 50kg flour sacks into finished retail cuts/loaves while tracking trimming loss.',
    },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Transfers, Break-Bulk &amp; Butchery/Bakery Yield</h1>
          <span className="vernacular-sub">
            {subLabel(
              'Kufambisa Zvinhu • Kupatsanura Mabhero/MaCrate • Kubika neKucheka Nyama',
              'Ukuthutha Impahla • Ukuhlukanisa Amabhele • Ukupheka Lokusika Inyama',
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
          ariaLabel="Transfers and yield transformation sub-menus"
          tabs={tabs}
          active={activeTab}
          onChange={setActiveTab}
        />

        {/* SUB-MENU 1: Move Between Depts / Branches */}
        {activeTab === 'move' && (
          <div id="transfers-panel-move" role="tabpanel" aria-labelledby="transfers-tab-move">
            <form className="form-grid subcard" style={{ marginBottom: '1.25rem' }} onSubmit={handleCreateTransferOrReq}>
              <label>
                Movement Type
                <select value={reqKind} onChange={(e) => setReqKind(e.target.value as 'warehouse_transfer' | 'department_issue')}>
                  <option value="warehouse_transfer">Branch / Warehouse Transfer (Store → Store)</option>
                  <option value="department_issue">Department Requisition (Store → Kitchen/Shopfloor)</option>
                </select>
              </label>
              <label>
                From Source Warehouse
                <select value={fromWhId} onChange={(e) => setFromWhId(e.target.value)} required>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </label>
              {reqKind === 'warehouse_transfer' ? (
                <label>
                  To Destination Warehouse
                  <select value={toWhId} onChange={(e) => setToWhId(e.target.value)} required>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <label>
                  To Internal Department
                  <select value={deptId} onChange={(e) => setDeptId(e.target.value)} required>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Product
                <select
                  value={prodId}
                  onChange={(e) => {
                    setProdId(e.target.value);
                    const p = products.find((x) => String(x.id) === e.target.value);
                    if (p) setUnitId(String(p.baseUnitId));
                  }}
                  required
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku}) — {p.totalStock} {p.baseUnit}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Quantity to Move
                <input type="number" step="0.001" min="0.001" value={qty} onChange={(e) => setQty(e.target.value)} required />
              </label>
              <div className="form-actions">
                <button type="submit" className="btn btn-primary">+ Submit Transfer Request</button>
              </div>
            </form>

            {loading ? (
              <Spinner label="Loading requisitions and transfers" />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Ref</th>
                      <th>Kind</th>
                      <th>From Store</th>
                      <th>Destination</th>
                      <th>Status</th>
                      <th>Created</th>
                      <th className="num">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requisitions.map((r) => (
                      <tr key={r.id}>
                        <td><strong>{r.reference}</strong></td>
                        <td>{r.kind === 'warehouse_transfer' ? 'Branch Transfer' : 'Dept Issue'}</td>
                        <td>{r.warehouseName}</td>
                        <td>{r.toWarehouseName ?? r.departmentName ?? '—'}</td>
                        <td>
                          <span className={`badge badge-${r.status === 'fulfilled' ? 'receipt' : r.status === 'rejected' ? 'write_off' : 'transfer'}`}>
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

        {/* SUB-MENU 2: Break Bulk (Crate/Bale/Sling -> Single Shelf Units) */}
        {activeTab === 'breakbulk' && (
          <div id="transfers-panel-breakbulk" role="tabpanel" aria-labelledby="transfers-tab-breakbulk">
            <div className="section-head">
              <div>
                <h2>Break Bulk Converter (Wholesale Crate / Bale / Sling → Single Shelf Units)</h2>
                <span className="vernacular-sub">
                  {subLabel(
                    'Kupatsanura Bhokisi kana Bhero Kuita Zvinhu Zvidiki zvepaSherufu',
                    'Ukuhlukanisa Ibhokisi Kumbe Ibhele Kube Ngamaphakethi Amancane',
                  )}
                </span>
              </div>
            </div>

            <form
              className="form-grid subcard"
              style={{ marginBottom: '1.25rem' }}
              onSubmit={async (e) => {
                e.preventDefault();
                const prod = products.find((p) => String(p.id) === bbProdId) ?? products[0];
                const wh = warehouses.find((w) => String(w.id) === bbWhId) ?? warehouses[0];
                const opened = Math.max(1, Number(bbCasesOpened) || 1);
                const factor = Math.max(1, Number(bbUnitsPerCase) || 1);
                const createdSingles = opened * factor;
                await api
                  .createYieldBatch({
                    kind: 'BREAK_BULK',
                    departmentName: wh?.name ?? 'Main Store',
                    sourceName: `${bbBulkLabel} (× ${factor} units)`,
                    inputQty: opened,
                    inputUnit: 'bulk',
                    outputName: prod?.name ?? 'Selected Product',
                    expectedOutputQty: createdSingles,
                    actualOutputQty: createdSingles,
                    outputUnit: prod?.baseUnit ?? 'each',
                    productId: prod?.id ?? null,
                    warehouseId: wh?.id ?? null,
                    unitId: prod?.baseUnitId ?? null,
                    deltaBaseQty: createdSingles,
                  })
                  .catch(() => null);
                setBreakLogs((prev) => [
                  {
                    id: `BB-${100 + prev.length + 1}`,
                    productName: prod?.name ?? 'Selected Product',
                    bulkType: `${bbBulkLabel} (× ${factor} units)`,
                    bulkQtyOpened: opened,
                    shelfUnitsCreated: createdSingles,
                    warehouseName: wh?.name ?? 'Main Store',
                    createdAt: 'Just Now',
                  },
                  ...prev,
                ]);
                setMsg(`Opened ${opened} × ${bbBulkLabel} of ${prod?.name ?? 'product'} → +${createdSingles} single shelf units added to ${wh?.name ?? 'Main Store'}!`);
                await load();
              }}
            >
              <label>
                Product Being Unpacked
                <select value={bbProdId} onChange={(e) => setBbProdId(e.target.value)}>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                  ))}
                </select>
              </label>
              <label>
                Store Location
                <select value={bbWhId} onChange={(e) => setBbWhId(e.target.value)}>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Bulk Pack Description
                <input value={bbBulkLabel} onChange={(e) => setBbBulkLabel(e.target.value)} required />
              </label>
              <label>
                Bales / Crates Opened
                <input type="number" min="1" value={bbCasesOpened} onChange={(e) => setBbCasesOpened(e.target.value)} required />
              </label>
              <label>
                Single Units Inside 1 Bale/Crate
                <input type="number" min="1" value={bbUnitsPerCase} onChange={(e) => setBbUnitsPerCase(e.target.value)} required />
              </label>
              <div className="form-actions">
                <button type="submit" className="btn btn-gold">📦 Break Bulk into Singles</button>
              </div>
            </form>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Ref #</th>
                    <th>Product</th>
                    <th>Bulk Pack Type</th>
                    <th className="num">Packs Opened</th>
                    <th className="num">Shelf Singles Created</th>
                    <th>Store Location</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {breakLogs.map((b) => (
                    <tr key={b.id}>
                      <td><code>{b.id}</code></td>
                      <td><strong>{b.productName}</strong></td>
                      <td>{b.bulkType}</td>
                      <td className="num">-{b.bulkQtyOpened} bulk</td>
                      <td className="num pos"><strong>+{b.shelfUnitsCreated} singles</strong></td>
                      <td>{b.warehouseName}</td>
                      <td>{b.createdAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* SUB-MENU 3: Recipe / Butchery / Bakery Yield Transformation */}
        {activeTab === 'yield' && (
          <div id="transfers-panel-yield" role="tabpanel" aria-labelledby="transfers-tab-yield">
            <div className="section-head">
              <div>
                <h2>Butchery Carcass, Bakery Flour &amp; Kitchen Yield Transformation</h2>
                <span className="vernacular-sub">
                  {subLabel(
                    'Kucheka Nyama muButchery kana Kubika Chingwa muBakery',
                    'Ukusika Inyama Ebhitsheri Kumbe Ukubhaka Isinkwa',
                  )}
                </span>
              </div>
            </div>

            <form
              className="form-grid subcard"
              style={{ marginBottom: '1.25rem' }}
              onSubmit={async (e) => {
                e.preventDefault();
                const inKg = Math.max(0.1, Number(ydRawKg) || 1);
                const waste = Math.max(0, Number(ydWasteKg) || 0);
                const pct = Math.max(0, Math.min(100, Number((((inKg - waste) / inKg) * 100).toFixed(1))));
                await api
                  .createYieldBatch({
                    kind: 'RECIPE_YIELD',
                    departmentName: ydDept,
                    sourceName: ydRawDesc,
                    inputQty: inKg,
                    inputUnit: 'kg',
                    outputName: ydOutDesc,
                    expectedOutputQty: inKg,
                    actualOutputQty: Number(ydOutUnits) || 1,
                    outputUnit: 'units',
                  })
                  .catch(() => null);
                setYieldBatches((prev) => [
                  {
                    id: `YD-${300 + prev.length + 1}`,
                    department: ydDept,
                    rawInputDesc: ydRawDesc,
                    rawInputWeightKg: inKg,
                    finishedOutputDesc: ydOutDesc,
                    finishedUnits: Number(ydOutUnits) || 1,
                    wasteOrBoneKg: waste,
                    yieldPct: pct,
                    createdAt: 'Just Transformed',
                  },
                  ...prev,
                ]);
                setMsg(`Recorded ${ydDept} yield transformation (${pct}% recovery yield).`);
                await load();
              }}
            >
              <label>
                Production Section
                <select value={ydDept} onChange={(e) => setYdDept(e.target.value as 'Butchery' | 'Bakery' | 'Kitchen')}>
                  <option value="Butchery">🥩 Butchery Blockman</option>
                  <option value="Bakery">🍞 Bakery Oven</option>
                  <option value="Kitchen">🍲 Takeaway / Kitchen</option>
                </select>
              </label>
              <label>
                Raw Input Issued
                <input value={ydRawDesc} onChange={(e) => setYdRawDesc(e.target.value)} required />
              </label>
              <label>
                Raw Weight (kg)
                <input type="number" step="0.1" value={ydRawKg} onChange={(e) => setYdRawKg(e.target.value)} required />
              </label>
              <label>
                Finished Retail Cuts / Loaves
                <input value={ydOutDesc} onChange={(e) => setYdOutDesc(e.target.value)} required />
              </label>
              <label>
                Finished Units / Packs Produced
                <input type="number" min="1" value={ydOutUnits} onChange={(e) => setYdOutUnits(e.target.value)} required />
              </label>
              <label>
                Trimming / Moisture Loss (kg)
                <input type="number" step="0.1" min="0" value={ydWasteKg} onChange={(e) => setYdWasteKg(e.target.value)} required />
              </label>
              <div className="form-actions">
                <button type="submit" className="btn btn-primary">+ Log Yield Batch</button>
              </div>
            </form>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Batch #</th>
                    <th>Section</th>
                    <th>Raw Input</th>
                    <th className="num">Input Mass</th>
                    <th>Finished Retail Output</th>
                    <th className="num">Finished Qty</th>
                    <th className="num">Trim Loss</th>
                    <th>Yield %</th>
                  </tr>
                </thead>
                <tbody>
                  {yieldBatches.map((y) => (
                    <tr key={y.id}>
                      <td><code>{y.id}</code></td>
                      <td><strong>{y.department}</strong></td>
                      <td>{y.rawInputDesc}</td>
                      <td className="num">{y.rawInputWeightKg} kg</td>
                      <td><strong>{y.finishedOutputDesc}</strong></td>
                      <td className="num pos">+{y.finishedUnits} units</td>
                      <td className="num">{y.wasteOrBoneKg} kg</td>
                      <td>
                        <span className={`status-pill ${y.yieldPct >= 90 ? 'optimal' : 'low'}`}>
                          {y.yieldPct}% Yield
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <QuickTransferModal
        open={transferModalOpen}
        onClose={() => setTransferModalOpen(false)}
        onSuccess={(message) => {
          setMsg(message);
          load();
        }}
      />
    </>
  );
}
