import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type BalanceItem, type ProductItem } from '../api';
import { AccessibleTabs, type TabDefinition } from '../components/AccessibleTabs';
import { Spinner } from '../components/Spinner';
import { useZim } from '../zimContext';

const PAGE_SIZE = 10;
type ProductTab = 'catalog' | 'batches' | 'serials' | 'layby';

interface BatchRecord {
  id: string;
  sku: string;
  productName: string;
  batchNo: string;
  mcazReg: string;
  expiryDate: string;
  qty: number;
  unit: string;
  fefoRank: 'ISSUE_FIRST' | 'HEALTHY' | 'EXPIRING_SOON';
}

interface SerialWarrantyRecord {
  id: string;
  sku: string;
  productName: string;
  serialOrImei: string;
  warrantyMonths: number;
  customerOrStatus: string;
  soldDate: string;
}

interface PaidUncollectedRecord {
  id: string;
  receiptNo: string;
  customerName: string;
  phone: string;
  productName: string;
  paidQty: number;
  collectedQty: number;
  unit: string;
  status: 'AWAITING_COLLECTION' | 'PARTIAL_PICKUP' | 'COLLECTED';
}

const INITIAL_BATCHES: BatchRecord[] = [
  { id: 'B-101', sku: 'MED-AMOX500', productName: 'Amoxicillin 500mg Capsules (MCAZ)', batchNo: 'BN-2026-04A', mcazReg: 'MCAZ-88412', expiryDate: '2026-11-30', qty: 42, unit: 'pack', fefoRank: 'EXPIRING_SOON' },
  { id: 'B-102', sku: 'AGR-DIP2L', productName: 'TickBuster Cattle Dip 2L (Agrovet)', batchNo: 'AG-9910-Z', mcazReg: 'VET-1104', expiryDate: '2027-02-15', qty: 18, unit: 'bottle', fefoRank: 'ISSUE_FIRST' },
  { id: 'B-103', sku: 'OIL-RG2L', productName: 'Roil Cooking Oil 2L', batchNo: 'NF-2026-11', mcazReg: 'FOOD-STD', expiryDate: '2027-08-20', qty: 120, unit: 'each', fefoRank: 'HEALTHY' },
];

const INITIAL_SERIALS: SerialWarrantyRecord[] = [
  { id: 'S-1', sku: 'SOL-INV5K', productName: 'Must 5kVA Hybrid Solar Inverter 48V', serialOrImei: 'SN-MUST-88492019', warrantyMonths: 24, customerOrStatus: 'In Stock — Harare Showroom', soldDate: '-' },
  { id: 'S-2', sku: 'SOL-BAT100', productName: 'Svolt 48V 100Ah Lithium LiFePO4 Battery', serialOrImei: 'SN-SVLT-44109822', warrantyMonths: 60, customerOrStatus: 'Sold — T. Moyo (Borrowdale)', soldDate: '2026-10-12' },
  { id: 'S-3', sku: 'ELC-SAM15', productName: 'Samsung Galaxy A15 Dual-SIM 128GB', serialOrImei: 'IMEI-358901129481023', warrantyMonths: 12, customerOrStatus: 'In Stock — Locked Cabinet', soldDate: '-' },
];

const INITIAL_LAYBY: PaidUncollectedRecord[] = [
  { id: 'PU-1', receiptNo: 'INV-8821', customerName: 'VaChikowore Builders', phone: '+263 77 241 8890', productName: 'PPC Surebuild Cement 50kg (32.5N)', paidQty: 100, collectedQty: 40, unit: 'bag', status: 'PARTIAL_PICKUP' },
  { id: 'PU-2', receiptNo: 'INV-8849', customerName: 'Mai Tawanda (Mbare Hardware)', phone: '+263 71 902 1145', productName: 'IBR Chromadek Roofing Sheets 6m', paidQty: 24, collectedQty: 0, unit: 'sheet', status: 'AWAITING_COLLECTION' },
];

function getProductIcon(name: string, category?: string | null): string {
  const s = `${name} ${category ?? ''}`.toLowerCase();
  if (s.includes('oil') || s.includes('cooking')) return '🫙';
  if (s.includes('meal') || s.includes('maize') || s.includes('flour') || s.includes('grain')) return '🌽';
  if (s.includes('sugar') || s.includes('salt')) return '🧂';
  if (s.includes('cement') || s.includes('brick') || s.includes('roof') || s.includes('hardware')) return '🧱';
  if (s.includes('solar') || s.includes('inverter') || s.includes('battery')) return '☀️';
  if (s.includes('med') || s.includes('pharma') || s.includes('caps')) return '💊';
  if (s.includes('soap') || s.includes('clean')) return '🧼';
  if (s.includes('drink') || s.includes('mazoe') || s.includes('beverage')) return '🧃';
  return '📦';
}

export function Products() {
  const [searchParams] = useSearchParams();
  const initialQ = searchParams.get('q') ?? '';
  const { formatMoney, subLabel } = useZim();

  const [activeTab, setActiveTab] = useState<ProductTab>('catalog');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [showAddDrawer, setShowAddDrawer] = useState(false);
  const [showPkgDrawer, setShowPkgDrawer] = useState(false);

  const [products, setProducts] = useState<ProductItem[]>([]);
  const [totalProducts, setTotalProducts] = useState(0);
  const [page, setPage] = useState(0);
  const [balances, setBalances] = useState<BalanceItem[]>([]);
  const [categories, setCategories] = useState<{ id: number; name: string; active: number }[]>([]);
  const [departments, setDepartments] = useState<{ id: number; name: string; active: number }[]>([]);
  const [units, setUnits] = useState<{ id: number; code: string; name: string }[]>([]);
  const [warehouses, setWarehouses] = useState<{ id: number; name: string }[]>([]);
  const [search, setSearch] = useState(initialQ);
  const [catFilter, setCatFilter] = useState<number | undefined>(undefined);
  const [deptFilter, setDeptFilter] = useState<number | undefined>(undefined);
  const [whFilter] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [stepBusyId, setStepBusyId] = useState<number | null>(null);

  // Sub-Menu 2, 3, 4 state
  const [batches, setBatches] = useState<BatchRecord[]>(INITIAL_BATCHES);
  const [serials, setSerials] = useState<SerialWarrantyRecord[]>(INITIAL_SERIALS);
  const [newSerialNo, setNewSerialNo] = useState('');
  const [newSerialProd, setNewSerialProd] = useState('Must 5kVA Hybrid Solar Inverter 48V');
  const [newSerialWarranty, setNewSerialWarranty] = useState('24');
  const [laybyItems, setLaybyItems] = useState<PaidUncollectedRecord[]>(INITIAL_LAYBY);

  // New Product form
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [departmentId, setDepartmentId] = useState<string>('');
  const [baseUnitId, setBaseUnitId] = useState<string>('');
  const [unitCost, setUnitCost] = useState('5.00');
  const [sellingPrice, setSellingPrice] = useState('6.50');
  const [wholesalePrice, setWholesalePrice] = useState('5.80');
  const [vatCategory, setVatCategory] = useState<'standard_15' | 'zero_rated' | 'exempt'>('standard_15');
  const [reorderLevel, setReorderLevel] = useState('10');

  // Edit Product state
  const [editingProduct, setEditingProduct] = useState<ProductItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editCategoryId, setEditCategoryId] = useState<string>('');
  const [editDepartmentId, setEditDepartmentId] = useState<string>('');
  const [editUnitCost, setEditUnitCost] = useState('0');
  const [editSellingPrice, setEditSellingPrice] = useState('0');
  const [editVatCategory, setEditVatCategory] = useState<'standard_15' | 'zero_rated' | 'exempt'>('standard_15');
  const [editReorderLevel, setEditReorderLevel] = useState('0');

  // Packaging & Category form
  const [pkgProductId, setPkgProductId] = useState<string>('');
  const [pkgUnitId, setPkgUnitId] = useState<string>('');
  const [pkgFactor, setPkgFactor] = useState('12');
  const [newCategory, setNewCategory] = useState('');
  const [newUnitCode, setNewUnitCode] = useState('');
  const [newUnitName, setNewUnitName] = useState('');

  useEffect(() => {
    if (initialQ) setSearch(initialQ);
  }, [initialQ]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, bRes, cRes, uRes, wRes, dRes, smeRes] = await Promise.all([
        api.products(search, { categoryId: catFilter, departmentId: deptFilter, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
        api.balances(whFilter),
        api.categories(),
        api.units(),
        api.warehouses(),
        api.departments().catch(() => []),
        api.smeOverview().catch(() => null),
      ]);
      setProducts(pRes.items);
      setTotalProducts(pRes.total);
      setBalances(bRes.items);
      setCategories(cRes);
      setUnits(uRes);
      setWarehouses(wRes);
      setDepartments(dRes);
      if (smeRes && smeRes.laybys.length > 0) {
        setLaybyItems(
          smeRes.laybys.map((l) => ({
            id: String(l.id),
            receiptNo: l.receiptRef,
            customerName: l.customerName,
            phone: l.customerPhone,
            productName: l.productName,
            paidQty: l.orderedQty,
            collectedQty: l.collectedQty,
            unit: l.unit,
            status:
              l.status === 'COMPLETED'
                ? 'COLLECTED'
                : l.status === 'PARTIAL_COLLECTED'
                  ? 'PARTIAL_PICKUP'
                  : 'AWAITING_COLLECTION',
          })),
        );
      }
      if (uRes[0]) setBaseUnitId((prev) => prev || String(uRes[0].id));
      if (pRes.items[0]) setPkgProductId((prev) => prev || String(pRes.items[0].id));
      if (uRes[1]) setPkgUnitId((prev) => prev || String(uRes[1].id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [search, catFilter, deptFilter, page, whFilter]);

  useEffect(() => {
    load();
    const onSync = () => load();
    window.addEventListener('stockroom:sync', onSync);
    return () => window.removeEventListener('stockroom:sync', onSync);
  }, [load]);

  // 1-Tap Oversized Stepper Handler (+1 Add, -1 Issue, +Bulk) posted through the real stock engine!
  async function handleQuickStep(p: ProductItem, delta: number, bulkUnit?: { unitId: number; unit: string; factor: number }) {
    const defaultWh = warehouses[0]?.id;
    if (!defaultWh) {
      setError('No warehouse available to post stock movement.');
      return;
    }
    setError('');
    setMsg('');
    setStepBusyId(p.id);
    try {
      if (delta > 0) {
        await api.postStock('receipts', {
          reference: `STEP-ADD-${Date.now().toString().slice(-4)}`,
          lines: [
            {
              productId: p.id,
              warehouseId: defaultWh,
              unitId: bulkUnit ? bulkUnit.unitId : p.baseUnitId,
              quantity: Math.abs(delta),
              unitCost: p.unitCost || 1,
            },
          ],
        });
        setMsg(
          bulkUnit
            ? `Added +1 ${bulkUnit.unit} (+${bulkUnit.factor} ${p.baseUnit}) of ${p.name} into ${warehouses[0].name}.`
            : `Added +${delta} ${p.baseUnit} of ${p.name} into ${warehouses[0].name}.`,
        );
      } else {
        await api.postStock('issues', {
          reference: `STEP-ISS-${Date.now().toString().slice(-4)}`,
          lines: [
            {
              productId: p.id,
              warehouseId: defaultWh,
              unitId: p.baseUnitId,
              quantity: Math.abs(delta),
            },
          ],
        });
        setMsg(`Issued -${Math.abs(delta)} ${p.baseUnit} of ${p.name} from ${warehouses[0].name}.`);
      }
      await load();
      window.dispatchEvent(new CustomEvent('stockroom:sync'));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStepBusyId(null);
    }
  }

  async function handleCreateProduct(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMsg('');
    try {
      await api.createProduct({
        sku,
        name,
        categoryId: categoryId ? Number(categoryId) : null,
        departmentId: departmentId ? Number(departmentId) : null,
        baseUnitId: Number(baseUnitId),
        unitCost: Number(unitCost),
        sellingPrice: Number(sellingPrice),
        wholesalePrice: Number(wholesalePrice),
        vatCategory,
        reorderLevel: Number(reorderLevel),
      });
      setSku('');
      setName('');
      setShowAddDrawer(false);
      setMsg('Product created with retail selling price and department assignment.');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function startEditProduct(p: ProductItem) {
    setEditingProduct(p);
    setEditName(p.name);
    setEditCategoryId(p.categoryId ? String(p.categoryId) : '');
    setEditDepartmentId(p.departmentId ? String(p.departmentId) : '');
    setEditUnitCost(String(p.unitCost));
    setEditSellingPrice(String(p.sellingPrice ?? Math.round(p.unitCost * 1.3 * 100) / 100));
    setEditVatCategory(p.vatCategory ?? 'standard_15');
    setEditReorderLevel(String(p.reorderLevel));
  }

  async function handleSaveEditProduct(e: FormEvent) {
    e.preventDefault();
    if (!editingProduct) return;
    setError('');
    setMsg('');
    try {
      await api.updateProduct(editingProduct.id, {
        name: editName.trim(),
        categoryId: editCategoryId ? Number(editCategoryId) : null,
        departmentId: editDepartmentId ? Number(editDepartmentId) : null,
        unitCost: Number(editUnitCost),
        sellingPrice: Number(editSellingPrice),
        vatCategory: editVatCategory,
        reorderLevel: Number(editReorderLevel),
      });
      setEditingProduct(null);
      setMsg(`Updated product ${editName}.`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleToggleProductActive(p: ProductItem) {
    setError('');
    setMsg('');
    try {
      await api.updateProduct(p.id, { active: !p.active });
      setMsg(`${p.name} marked ${p.active ? 'inactive' : 'active'}.`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleAddPackaging(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMsg('');
    try {
      await api.addPackaging(Number(pkgProductId), {
        unitId: Number(pkgUnitId),
        factor: Number(pkgFactor),
      });
      setMsg('Packaging conversion added.');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleAddCategory(e: FormEvent) {
    e.preventDefault();
    if (!newCategory.trim()) return;
    setError('');
    try {
      await api.createCategory({ name: newCategory.trim() });
      setNewCategory('');
      setMsg('Category added.');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleAddUnit(e: FormEvent) {
    e.preventDefault();
    if (!newUnitCode.trim() || !newUnitName.trim()) return;
    setError('');
    try {
      await api.createUnit({ code: newUnitCode.trim(), name: newUnitName.trim() });
      setNewUnitCode('');
      setNewUnitName('');
      setMsg('Unit of measure added.');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalProducts / PAGE_SIZE));

  const tabs: TabDefinition<ProductTab>[] = [
    {
      key: 'catalog',
      label: '1. Stock Catalog',
      badge: totalProducts,
      purpose: 'Toggle between Visual Picture Cards with +1 Add / -1 Issue / +Bulk steppers and Compact Table view.',
    },
    {
      key: 'batches',
      label: '2. Batch & Expiry (MCAZ Pharmacy / Agro FEFO)',
      badge: batches.length,
      purpose: 'Track batch numbers, MCAZ/Veterinary registration numbers, and First-Expired-First-Out (FEFO) shelf priority.',
    },
    {
      key: 'serials',
      label: '3. Serial / IMEI & Warranty (Solar / Electronics)',
      badge: serials.length,
      purpose: 'Scan or record unique serial numbers and IMEIs for solar inverters, lithium batteries, and phones to prevent swap fraud.',
    },
    {
      key: 'layby',
      label: '4. Paid & Uncollected Stock (Hardware "Collect Later" / Lay-By)',
      badge: laybyItems.filter((x) => x.status !== 'COLLECTED').length,
      purpose: 'Separate customer-paid cement, roofing sheets, or lay-by goods still sitting in your yard from available store stock.',
    },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Products &amp; Zimbabwean SME Stock Catalog</h1>
          <span className="vernacular-sub">
            {subLabel(
              'Zvinhu Zviri Muchitoro • Wedzera (+1) kana Kubvisa (-1) pasina kunyora',
              'Impahla Yesitolo • Engeza (+1) kumbe Susa (-1) ngaphandle kokubhala',
              'Visual Picture Cards, MCAZ Batch FEFO, Solar Serials & Hardware Lay-By',
            )}
          </span>
        </div>
        <div className="quick-actions">
          <button type="button" className="btn btn-primary" onClick={() => setShowAddDrawer((s) => !s)}>
            {showAddDrawer ? '✕ Close Form' : '+ Add New Product'}
          </button>
          <button type="button" className="btn btn-outline" onClick={() => setShowPkgDrawer((s) => !s)}>
            {showPkgDrawer ? '✕ Close Packagings' : '📦 Packagings & Categories'}
          </button>
        </div>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      {msg && <p className="form-success" role="status">{msg}</p>}

      {/* Collapsible New Product Drawer so it never clutters the main view */}
      {showAddDrawer && (
        <section className="card" style={{ marginBottom: '1.2rem', borderTop: '4px solid var(--zim-gold-500)' }}>
          <div className="section-head">
            <h3>Register New Product SKU • Nyoresa Chinhu Chitsva</h3>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowAddDrawer(false)}>
              Cancel
            </button>
          </div>
          <form className="form-grid" onSubmit={handleCreateProduct}>
            <label>
              SKU Code
              <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="e.g. GRN-MZ10" required />
            </label>
            <label>
              Product Name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ngwerewere Roller Meal 10kg" required />
            </label>
            <label>
              Shop Department (Groceries vs Hardware)
              <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                <option value="">General Store</option>
                {departments.filter((d) => d.active).map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </label>
            <label>
              Category
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Uncategorised</option>
                {categories.filter((c) => c.active).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label>
              Base Unit of Measure
              <select value={baseUnitId} onChange={(e) => setBaseUnitId(e.target.value)} required>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>{u.name} ({u.code})</option>
                ))}
              </select>
            </label>
            <label>
              Buying / Landed Cost (USD)
              <input type="number" step="0.01" min="0" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} required />
            </label>
            <label>
              Retail Selling Price (USD)
              <input type="number" step="0.01" min="0" value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value)} required />
            </label>
            <label>
              Wholesale / Bulk Price (USD)
              <input type="number" step="0.01" min="0" value={wholesalePrice} onChange={(e) => setWholesalePrice(e.target.value)} required />
            </label>
            <label>
              ZIMRA VAT Category
              <select value={vatCategory} onChange={(e) => setVatCategory(e.target.value as 'standard_15' | 'zero_rated' | 'exempt')}>
                <option value="standard_15">Standard Rated (15% VAT)</option>
                <option value="zero_rated">Zero-Rated Staple (0% VAT)</option>
                <option value="exempt">VAT Exempt</option>
              </select>
            </label>
            <label>
              Reorder Alert Threshold
              <input type="number" step="0.001" min="0" value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} required />
            </label>
            <div className="form-actions">
              <button className="btn btn-primary" type="submit">Save Product</button>
            </div>
          </form>
        </section>
      )}

      {showPkgDrawer && (
        <section className="card" style={{ marginBottom: '1.2rem' }}>
          <div className="dashboard-panels">
            <div className="subcard">
              <h3>Add Packaging Conversion (e.g. 1 Crate/Carton = 12 Each)</h3>
              <form className="form-grid" onSubmit={handleAddPackaging}>
                <label>
                  Product
                  <select value={pkgProductId} onChange={(e) => setPkgProductId(e.target.value)} required>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} (base: {p.baseUnit})</option>
                    ))}
                  </select>
                </label>
                <label>
                  Pack Unit
                  <select value={pkgUnitId} onChange={(e) => setPkgUnitId(e.target.value)} required>
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>{u.name} ({u.code})</option>
                    ))}
                  </select>
                </label>
                <label>
                  Base Units per Pack
                  <input type="number" step="0.001" min="0.001" value={pkgFactor} onChange={(e) => setPkgFactor(e.target.value)} required />
                </label>
                <div className="form-actions">
                  <button className="btn btn-primary" type="submit">+ Add Conversion</button>
                </div>
              </form>
            </div>

            <div className="subcard">
              <h3>Categories &amp; Units of Measure</h3>
              <div className="inline-forms">
                <form onSubmit={handleAddCategory} className="inline-form">
                  <input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="New category name" />
                  <button className="btn btn-outline" type="submit">+ Category</button>
                </form>
                <form onSubmit={handleAddUnit} className="inline-form">
                  <input value={newUnitCode} onChange={(e) => setNewUnitCode(e.target.value)} placeholder="Code (e.g. bag)" style={{ maxWidth: '130px' }} />
                  <input value={newUnitName} onChange={(e) => setNewUnitName(e.target.value)} placeholder="Label (e.g. 50kg Bag)" />
                  <button className="btn btn-outline" type="submit">+ Unit</button>
                </form>
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="card">
        {/* TIER 3: Horizontal In-Page Sub-Menu Bar */}
        <AccessibleTabs
          idPrefix="products"
          ariaLabel="Product management sections"
          tabs={tabs}
          active={activeTab}
          onChange={setActiveTab}
        />

        {/* SUB-MENU 1: Stock Catalog (Visual Picture Cards vs Compact Table) */}
        {activeTab === 'catalog' && (
          <div id="products-panel-catalog" role="tabpanel" aria-labelledby="products-tab-catalog">
            <div className="section-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <h2>Stock Catalog ({totalProducts})</h2>
                <div className="topbar-seg-group" role="group" aria-label="Catalog display mode">
                  <button
                    type="button"
                    className={`topbar-seg-btn ${viewMode === 'cards' ? 'active' : ''}`}
                    onClick={() => setViewMode('cards')}
                  >
                    🖼️ Visual Picture Cards
                  </button>
                  <button
                    type="button"
                    className={`topbar-seg-btn ${viewMode === 'table' ? 'active' : ''}`}
                    onClick={() => setViewMode('table')}
                  >
                    📋 Compact Table
                  </button>
                </div>
              </div>

              <div className="filter-bar">
                <select
                  aria-label="Filter by department"
                  value={deptFilter ?? ''}
                  onChange={(e) => {
                    setDeptFilter(e.target.value ? Number(e.target.value) : undefined);
                    setPage(0);
                  }}
                >
                  <option value="">All Departments (Groceries + Hardware)</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                <select
                  aria-label="Filter by category"
                  value={catFilter ?? ''}
                  onChange={(e) => {
                    setCatFilter(e.target.value ? Number(e.target.value) : undefined);
                    setPage(0);
                  }}
                >
                  <option value="">All Categories</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <input
                  className="search-input"
                  type="search"
                  placeholder="Search SKU or product name…"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(0);
                  }}
                />
                {(search || catFilter !== undefined || deptFilter !== undefined) && (
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => {
                      setSearch('');
                      setCatFilter(undefined);
                      setDeptFilter(undefined);
                      setPage(0);
                    }}
                  >
                    Reset Filters
                  </button>
                )}
              </div>
            </div>

            {editingProduct && (
              <div className="subcard" style={{ marginBottom: '1rem' }}>
                <div className="section-head">
                  <h3>Edit Product Pricing &amp; Department: {editingProduct.sku}</h3>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditingProduct(null)}>
                    Cancel
                  </button>
                </div>
                <form className="form-grid" onSubmit={handleSaveEditProduct}>
                  <label>
                    Product Name
                    <input value={editName} onChange={(e) => setEditName(e.target.value)} required />
                  </label>
                  <label>
                    Department (Groceries vs Hardware)
                    <select value={editDepartmentId} onChange={(e) => setEditDepartmentId(e.target.value)}>
                      <option value="">General Store</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Category
                    <select value={editCategoryId} onChange={(e) => setEditCategoryId(e.target.value)}>
                      <option value="">Uncategorised</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Buying / Landed Cost (USD)
                    <input type="number" step="0.01" min="0" value={editUnitCost} onChange={(e) => setEditUnitCost(e.target.value)} required />
                  </label>
                  <label>
                    Retail Selling Price (USD)
                    <input type="number" step="0.01" min="0" value={editSellingPrice} onChange={(e) => setEditSellingPrice(e.target.value)} required />
                  </label>
                  <label>
                    ZIMRA VAT Category
                    <select value={editVatCategory} onChange={(e) => setEditVatCategory(e.target.value as 'standard_15' | 'zero_rated' | 'exempt')}>
                      <option value="standard_15">Standard Rated (15% VAT)</option>
                      <option value="zero_rated">Zero-Rated Staple (0% VAT)</option>
                      <option value="exempt">VAT Exempt</option>
                    </select>
                  </label>
                  <label>
                    Reorder Level ({editingProduct.baseUnit})
                    <input type="number" step="0.001" min="0" value={editReorderLevel} onChange={(e) => setEditReorderLevel(e.target.value)} required />
                  </label>
                  <div className="form-actions">
                    <button className="btn btn-primary" type="submit">Save Changes</button>
                  </div>
                </form>
              </div>
            )}

            {loading ? (
              <Spinner label="Loading products" />
            ) : products.length === 0 ? (
              <div className="empty-state-box">
                <strong>No products match your search or category filter.</strong>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    setSearch('');
                    setCatFilter(undefined);
                    setPage(0);
                  }}
                >
                  ↺ Reset Filters
                </button>
              </div>
            ) : viewMode === 'cards' ? (
              <div className="picture-card-grid">
                {products.map((p) => {
                  const isLow = p.reorderLevel > 0 && p.totalStock <= p.reorderLevel;
                  const statusClass = p.totalStock <= 0 ? 'out' : isLow ? 'low' : 'optimal';
                  const statusText = p.totalStock <= 0 ? 'Out of Stock' : isLow ? 'Low Stock' : 'In Stock';
                  const pct = p.reorderLevel > 0 ? Math.min(100, Math.round((p.totalStock / (p.reorderLevel * 2)) * 100)) : 80;
                  const firstPack = p.packagings[0];
                  const isBusy = stepBusyId === p.id;

                  return (
                    <article key={p.id} className="picture-card">
                      <div>
                        <div className="picture-card-head">
                          <div className="picture-thumb" aria-hidden="true">
                            {getProductIcon(p.name, p.categoryName)}
                          </div>
                          <div className="picture-meta">
                            <h3 className="picture-title">{p.name}</h3>
                            <div className="picture-sku">
                              {p.sku} · {p.departmentName ?? p.categoryName ?? 'General'}
                            </div>
                          </div>
                          <span className={`status-pill ${statusClass}`}>{statusText}</span>
                        </div>

                        <div style={{ marginTop: '0.75rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '0.25rem', flexWrap: 'wrap', gap: '0.25rem' }}>
                            <span>
                              On Shelf: <strong>{p.totalStock} {p.baseUnit}</strong>
                            </span>
                            <span>
                              Buy: <strong>{formatMoney(p.unitCost)}</strong> · Sell:{' '}
                              <strong style={{ color: 'var(--zim-green-700)' }}>
                                {formatMoney(p.sellingPrice ?? p.unitCost * 1.3)}
                              </strong>
                            </span>
                          </div>
                          <div className="stock-bar-track">
                            <div className={`stock-bar-fill ${statusClass}`} style={{ width: `${Math.max(8, pct)}%` }} />
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', color: 'var(--muted)', marginTop: '0.2rem' }}>
                            <span>Reorder at: {p.reorderLevel} {p.baseUnit}</span>
                            <span>
                              {firstPack ? `1 ${firstPack.unit} = ${firstPack.factor} ${p.baseUnit}` : `Base: ${p.baseUnit}`}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div>
                        {/* Oversized +1 Add, -1 Issue, +Bulk Steppers */}
                        <div className="stepper-row">
                          <button
                            type="button"
                            className="btn-step btn-step-add"
                            disabled={isBusy}
                            onClick={() => handleQuickStep(p, 1)}
                            title={`Add +1 ${p.baseUnit} into stock`}
                          >
                            +1 Add
                          </button>
                          <button
                            type="button"
                            className="btn-step btn-step-issue"
                            disabled={isBusy || p.totalStock <= 0}
                            onClick={() => handleQuickStep(p, -1)}
                            title={`Issue -1 ${p.baseUnit} out of stock`}
                          >
                            -1 Issue
                          </button>
                          {firstPack ? (
                            <button
                              type="button"
                              className="btn-step btn-step-bulk"
                              disabled={isBusy}
                              onClick={() => handleQuickStep(p, 1, firstPack)}
                              title={`Receive 1 ${firstPack.unit} (+${firstPack.factor} ${p.baseUnit})`}
                            >
                              +Bulk ({firstPack.unit})
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn-step btn-step-bulk"
                              disabled={isBusy}
                              onClick={() => handleQuickStep(p, 10)}
                              title={`Receive +10 ${p.baseUnit} bulk pack`}
                            >
                              +Bulk (+10)
                            </button>
                          )}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.55rem' }}>
                          <button type="button" className="btn btn-outline btn-sm" onClick={() => startEditProduct(p)}>
                            Edit Price / Level
                          </button>
                          <button type="button" className="btn btn-outline btn-sm" onClick={() => handleToggleProductActive(p)}>
                            {p.active ? 'Archive' : 'Activate'}
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Product</th>
                      <th>Category</th>
                      <th>Packagings</th>
                      <th className="num">Unit Cost</th>
                      <th>Stock Level</th>
                      <th>Status</th>
                      <th className="num">Quick Stepper / Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((p) => {
                      const isLow = p.reorderLevel > 0 && p.totalStock <= p.reorderLevel;
                      const statusClass = p.totalStock <= 0 ? 'out' : isLow ? 'low' : 'optimal';
                      const statusText = p.totalStock <= 0 ? 'Out of Stock' : isLow ? 'Low Stock' : 'In Stock';
                      const pct = p.reorderLevel > 0 ? Math.min(100, Math.round((p.totalStock / (p.reorderLevel * 2)) * 100)) : 80;
                      const isBusy = stepBusyId === p.id;
                      return (
                        <tr key={p.id}>
                          <td><code>{p.sku}</code></td>
                          <td>
                            <strong>{p.name}</strong>
                            {!p.active && <span className="badge badge-write_off" style={{ marginLeft: '.4rem' }}>Inactive</span>}
                          </td>
                          <td>{p.categoryName ?? 'Uncategorised'}</td>
                          <td>
                            {p.packagings.length > 0
                              ? p.packagings.map((g) => `1 ${g.unit} = ${g.factor} ${p.baseUnit}`).join(', ')
                              : `Base (${p.baseUnit})`}
                          </td>
                          <td className="num">{formatMoney(p.unitCost)}</td>
                          <td style={{ minWidth: '150px' }}>
                            <div className="stock-level-cell">
                              <div className="stock-bar-track">
                                <div className={`stock-bar-fill ${statusClass}`} style={{ width: `${Math.max(8, pct)}%` }} />
                              </div>
                              <span className="stock-level-num">
                                {p.totalStock} / {p.reorderLevel} {p.baseUnit}
                              </span>
                            </div>
                          </td>
                          <td>
                            <span className={`status-pill ${statusClass}`}>{statusText}</span>
                          </td>
                          <td className="num">
                            <div className="action-row" style={{ justifyContent: 'flex-end' }}>
                              <button type="button" className="btn-step btn-step-add" disabled={isBusy} onClick={() => handleQuickStep(p, 1)}>
                                +1
                              </button>
                              <button type="button" className="btn-step btn-step-issue" disabled={isBusy || p.totalStock <= 0} onClick={() => handleQuickStep(p, -1)}>
                                -1
                              </button>
                              <button type="button" className="btn btn-outline btn-sm" onClick={() => startEditProduct(p)}>
                                Edit
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="pagination-bar">
              <span className="muted" style={{ margin: 0 }}>
                Page {page + 1} of {totalPages} ({totalProducts} total SKUs · {balances.length} warehouse bin records)
              </span>
              <div className="action-row">
                <button type="button" className="btn btn-outline btn-sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                  Previous
                </button>
                <button type="button" className="btn btn-outline btn-sm" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  Next
                </button>
              </div>
            </div>
          </div>
        )}

        {/* SUB-MENU 2: Batch & Expiry (MCAZ Pharmacy / Agro FEFO) */}
        {activeTab === 'batches' && (
          <div id="products-panel-batches" role="tabpanel" aria-labelledby="products-tab-batches">
            <div className="section-head">
              <div>
                <h2>MCAZ Pharmacy &amp; Agrovet FEFO Batch Register</h2>
                <span className="vernacular-sub">
                  {subLabel(
                    'Zvinhu Zvine Zuva Rekupera (FEFO — Tangai Kubudisa Zviri Kuda Kupera)',
                    'Impahla Elesikhathi Sokuphela (FEFO — Khipha Kuqala Okuzaphela Masinyane)',
                  )}
                </span>
              </div>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => {
                  const nextId = `B-${100 + batches.length + 1}`;
                  setBatches((prev) => [
                    {
                      id: nextId,
                      sku: products[0]?.sku ?? 'MED-PARA500',
                      productName: products[0]?.name ?? 'Paracetamol 500mg Blister Pack',
                      batchNo: `BN-2026-${batches.length + 10}`,
                      mcazReg: 'MCAZ-90122',
                      expiryDate: '2027-04-30',
                      qty: 50,
                      unit: 'pack',
                      fefoRank: 'ISSUE_FIRST',
                    },
                    ...prev,
                  ]);
                  setMsg('New MCAZ/FEFO batch logged.');
                }}
              >
                + Log New Batch Expiry
              </button>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Batch No.</th>
                    <th>MCAZ / Vet Reg</th>
                    <th>SKU &amp; Product</th>
                    <th>Expiry Date</th>
                    <th className="num">Batch Qty</th>
                    <th>FEFO Dispatch Priority</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => (
                    <tr key={b.id}>
                      <td><code>{b.batchNo}</code></td>
                      <td><strong>{b.mcazReg}</strong></td>
                      <td>
                        <strong>{b.productName}</strong> <span className="muted">({b.sku})</span>
                      </td>
                      <td>{b.expiryDate}</td>
                      <td className="num">{b.qty} {b.unit}</td>
                      <td>
                        <span
                          className={`status-pill ${
                            b.fefoRank === 'EXPIRING_SOON' ? 'out' : b.fefoRank === 'ISSUE_FIRST' ? 'low' : 'optimal'
                          }`}
                        >
                          {b.fefoRank === 'EXPIRING_SOON'
                            ? '⚠️ Expiring Soon — Issue Immediately'
                            : b.fefoRank === 'ISSUE_FIRST'
                              ? 'FEFO #1 — Issue Before Newer Stock'
                              : 'Healthy Shelf Life'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* SUB-MENU 3: Serial / IMEI & Warranty (Solar / Electronics) */}
        {activeTab === 'serials' && (
          <div id="products-panel-serials" role="tabpanel" aria-labelledby="products-tab-serials">
            <div className="section-head">
              <div>
                <h2>Solar Inverter, Lithium Battery &amp; IMEI Warranty Tracker</h2>
                <span className="vernacular-sub">
                  {subLabel(
                    'Nhamba dzeSolar neMaPhone (Kudzivirira Kuchinjwa kweZvinhu Zvakafa)',
                    'Izinombolo zeSolar lamaFoni (Ukuvikela Ukuntshintshwa Kwempahla)',
                  )}
                </span>
              </div>
            </div>

            <form
              className="form-grid subcard"
              style={{ marginBottom: '1rem' }}
              onSubmit={(e) => {
                e.preventDefault();
                if (!newSerialNo.trim()) return;
                setSerials((prev) => [
                  {
                    id: `S-${prev.length + 1}`,
                    sku: 'SOL-UNIT',
                    productName: newSerialProd,
                    serialOrImei: newSerialNo.trim().toUpperCase(),
                    warrantyMonths: Number(newSerialWarranty) || 12,
                    customerOrStatus: 'In Stock — Verified Serial',
                    soldDate: '-',
                  },
                  ...prev,
                ]);
                setNewSerialNo('');
                setMsg('Serial / IMEI number registered into anti-swap warranty log.');
              }}
            >
              <label>
                Solar / Electronic Item
                <input value={newSerialProd} onChange={(e) => setNewSerialProd(e.target.value)} required />
              </label>
              <label>
                Serial Number or 15-Digit IMEI
                <input
                  value={newSerialNo}
                  onChange={(e) => setNewSerialNo(e.target.value)}
                  placeholder="e.g. SN-MUST-99201184"
                  required
                />
              </label>
              <label>
                Warranty Period (Months)
                <input type="number" min="1" max="120" value={newSerialWarranty} onChange={(e) => setNewSerialWarranty(e.target.value)} required />
              </label>
              <div className="form-actions">
                <button type="submit" className="btn btn-primary">+ Register Serial / IMEI</button>
              </div>
            </form>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Serial / IMEI</th>
                    <th>Product</th>
                    <th className="num">Warranty</th>
                    <th>Current Status / Buyer</th>
                    <th>Date Dispatched</th>
                  </tr>
                </thead>
                <tbody>
                  {serials.map((s) => (
                    <tr key={s.id}>
                      <td><code>{s.serialOrImei}</code></td>
                      <td><strong>{s.productName}</strong></td>
                      <td className="num">{s.warrantyMonths} Months</td>
                      <td>
                        <span className={`status-pill ${s.soldDate === '-' ? 'optimal' : 'low'}`}>
                          {s.customerOrStatus}
                        </span>
                      </td>
                      <td>{s.soldDate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* SUB-MENU 4: Paid & Uncollected Stock (Hardware "Collect Later" / Lay-By) */}
        {activeTab === 'layby' && (
          <div id="products-panel-layby" role="tabpanel" aria-labelledby="products-tab-layby">
            <div className="section-head">
              <div>
                <h2>Paid &amp; Uncollected Customer Stock (&quot;Collect Later&quot; / Lay-By)</h2>
                <span className="vernacular-sub">
                  {subLabel(
                    'Zvinhu Zvakabhadharwa Asi Zvisati Zvatorwa neVatengi (Simende, Marata)',
                    'Impahla Ebhadaliweyo Kodwa Engakathathwa Ngabathengi',
                  )}
                </span>
              </div>
            </div>
            <p className="muted" style={{ fontSize: '0.86rem' }}>
              Prevents hardware yard staff from accidentally selling cement or roofing sheets that have already been paid for by another customer.
            </p>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Receipt #</th>
                    <th>Customer &amp; Phone</th>
                    <th>Item Reserved in Yard</th>
                    <th className="num">Paid Qty</th>
                    <th className="num">Collected</th>
                    <th className="num">Still Owed to Customer</th>
                    <th>Status</th>
                    <th className="num">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {laybyItems.map((item) => {
                    const remaining = Math.max(0, item.paidQty - item.collectedQty);
                    return (
                      <tr key={item.id}>
                        <td><code>{item.receiptNo}</code></td>
                        <td>
                          <strong>{item.customerName}</strong>
                          <div className="muted" style={{ margin: 0, fontSize: '0.78rem' }}>{item.phone}</div>
                        </td>
                        <td><strong>{item.productName}</strong></td>
                        <td className="num">{item.paidQty} {item.unit}</td>
                        <td className="num">{item.collectedQty} {item.unit}</td>
                        <td className="num"><strong>{remaining} {item.unit}</strong></td>
                        <td>
                          <span
                            className={`status-pill ${
                              remaining === 0 ? 'optimal' : item.collectedQty > 0 ? 'low' : 'out'
                            }`}
                          >
                            {remaining === 0 ? 'Fully Collected' : `${remaining} ${item.unit} Reserved in Yard`}
                          </span>
                        </td>
                        <td className="num">
                          {remaining > 0 && (
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={async () => {
                                const numId = Number(item.id);
                                if (Number.isFinite(numId) && numId > 0) {
                                  await api.collectLayby(numId, remaining).catch(() => null);
                                  await load();
                                } else {
                                  setLaybyItems((prev) =>
                                    prev.map((x) =>
                                      x.id === item.id
                                        ? { ...x, collectedQty: x.paidQty, status: 'COLLECTED' }
                                        : x,
                                    ),
                                  );
                                }
                                setMsg(`Marked remaining ${remaining} ${item.unit} for ${item.customerName} as collected.`);
                              }}
                            >
                              ✓ Release to Customer Truck
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
