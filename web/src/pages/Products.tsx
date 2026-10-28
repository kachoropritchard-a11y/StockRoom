import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type BalanceItem, type ProductItem } from '../api';
import { AccessibleTabs, type TabDefinition } from '../components/AccessibleTabs';
import { Spinner } from '../components/Spinner';
import { useZim } from '../zimContext';
import { ProductRetailIcon } from '../components/Icons';

const PAGE_SIZE = 10;
type ProductTab = 'catalog' | 'categories' | 'packaging';

export function Products() {
  const [searchParams] = useSearchParams();
  const initialQ = searchParams.get('q') ?? '';
  const { formatMoney, subLabel } = useZim();

  const [activeTab, setActiveTab] = useState<ProductTab>('catalog');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [showAddDrawer, setShowAddDrawer] = useState(false);

  const [products, setProducts] = useState<ProductItem[]>([]);
  const [totalProducts, setTotalProducts] = useState(0);
  const [page, setPage] = useState(0);
  const [balances, setBalances] = useState<BalanceItem[]>([]);
  const [categories, setCategories] = useState<{ id: number; name: string; code?: string; active: number }[]>([]);
  const [departments, setDepartments] = useState<{ id: number; name: string; code?: string; active: number }[]>([]);
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
      const [pRes, bRes, cRes, uRes, wRes, dRes] = await Promise.all([
        api.products(search, { categoryId: catFilter, departmentId: deptFilter, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
        api.balances(whFilter),
        api.categories(),
        api.units(),
        api.warehouses(),
        api.departments().catch(() => []),
      ]);
      setProducts(pRes.items);
      setTotalProducts(pRes.total);
      setBalances(bRes.items);
      setCategories(cRes);
      setUnits(uRes);
      setWarehouses(wRes);
      setDepartments(dRes);
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
      const res = await api.createProduct({
        sku: sku.trim() || undefined,
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
      setMsg(`Product created successfully with Code/SKU: ${res.sku ?? sku}`);
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
      const res = await api.createCategory({ name: newCategory.trim() });
      setNewCategory('');
      setMsg(`Category added with code: ${res.code ?? 'saved'}`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleAddUnit(e: FormEvent) {
    e.preventDefault();
    if (!newUnitName.trim()) return;
    setError('');
    try {
      const res = await api.createUnit({ code: newUnitCode.trim() || undefined, name: newUnitName.trim() });
      setNewUnitCode('');
      setNewUnitName('');
      setMsg(`Unit of measure added with code: ${res.code ?? 'saved'}`);
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
      purpose: 'Visual Picture Cards with +1 Add / -1 Issue / +Bulk steppers, Auto-Generated SKUs, and Compact Table view.',
    },
    {
      key: 'categories',
      label: '2. Product Categories',
      badge: categories.length,
      purpose: 'Manage store categories with auto-generated category codes (CAT-xxx).',
    },
    {
      key: 'packaging',
      label: '3. Packaging & Bulk Units',
      badge: units.length,
      purpose: 'Define packaging conversion rules (e.g. 1 Box = 24 Units) and units of measure.',
    },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Product Manager</h1>
          <span className="vernacular-sub">
            {subLabel(
              'Zvinhu Zviri Muchitoro • Product Catalog, Categories & Packaging Units',
              'Impahla Yesitolo • Uhlu Lwempahla, Izigaba & Amabhokisi',
              'Stock Catalog, Auto-Generated Codes & SKUs, Categories, and Bulk Packaging Rules',
            )}
          </span>
        </div>
        <div className="quick-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              if (!showAddDrawer && !sku) {
                const nextNum = (totalProducts + 1).toString().padStart(4, '0');
                setSku(`PRD-${nextNum}`);
              }
              setShowAddDrawer((s) => !s);
            }}
          >
            {showAddDrawer ? '✕ Close Form' : '+ Add New Product'}
          </button>
        </div>
      </div>

      {/* Helpful context banner explaining where Batch/Expiry & Layby are managed */}
      <div className="card" style={{ marginBottom: '1.25rem', backgroundColor: 'var(--card-subtle-bg, rgba(0,0,0,0.02))' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <span style={{ fontSize: '1.4rem' }}>💡</span>
            <div style={{ fontSize: '0.875rem', lineHeight: 1.4 }}>
              <strong>Looking for Batch &amp; Expiry dates or Serial / IMEI numbers?</strong>
              <div>These are embedded directly in <strong>Stock Intake</strong> when receiving new goods. Customer lay-by orders &amp; till small-change slips are in the dedicated <strong>Lay-by &amp; Customer Change</strong> tab.</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Link to="/inventory/intake" className="btn btn-sm btn-outline">
              📦 Go to Stock Intake
            </Link>
            <Link to="/inventory/layby-and-change" className="btn btn-sm btn-outline">
              🪙 Lay-by &amp; Change
            </Link>
          </div>
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>SKU / Product Code</span>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  style={{ padding: '0.1rem 0.45rem', fontSize: '0.72rem', height: 'auto', minHeight: '22px' }}
                  onClick={() => setSku(`PRD-${Math.floor(1000 + Math.random() * 9000)}`)}
                  title="Generate a fresh unique SKU code"
                >
                  ↻ Auto-Generate
                </button>
              </div>
              <input
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="Auto-generated (e.g. PRD-0001) or scan barcode"
              />
              <span className="muted" style={{ fontSize: '0.74rem', marginTop: '0.15rem' }}>
                ⚡ Auto-generated by system (leave as is or scan item barcode)
              </span>
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
                  <option key={d.id} value={d.id}>[{d.code ?? `DPT-${String(d.id).padStart(3, '0')}`}] {d.name}</option>
                ))}
              </select>
            </label>
            <label>
              Category
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Uncategorised</option>
                {categories.filter((c) => c.active).map((c) => (
                  <option key={c.id} value={c.id}>[{c.code ?? `CAT-${String(c.id).padStart(3, '0')}`}] {c.name}</option>
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

      <section className="card">
        {/* TIER 3: Horizontal In-Page Sub-Menu Bar */}
        <AccessibleTabs
          idPrefix="products"
          ariaLabel="Product catalog views and packaging conversions"
          tabs={tabs}
          active={activeTab}
          onChange={(k) => setActiveTab(k)}
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
                    Visual Picture Cards
                  </button>
                  <button
                    type="button"
                    className={`topbar-seg-btn ${viewMode === 'table' ? 'active' : ''}`}
                    onClick={() => setViewMode('table')}
                  >
                    Compact Table
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
                        <option key={d.id} value={d.id}>[{d.code ?? `DPT-${String(d.id).padStart(3, '0')}`}] {d.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Category
                    <select value={editCategoryId} onChange={(e) => setEditCategoryId(e.target.value)}>
                      <option value="">Uncategorised</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>[{c.code ?? `CAT-${String(c.id).padStart(3, '0')}`}] {c.name}</option>
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
            ) : totalProducts === 0 ? (
              <div className="empty-state-box" style={{ padding: '3.5rem 1.5rem', textAlign: 'center' }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem', color: 'var(--zim-green-700)' }}>
                  <ProductRetailIcon name="box" size={48} />
                </div>
                <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.2rem', fontWeight: 800 }}>Your Stockroom is Empty</h3>
                <p className="muted" style={{ maxWidth: '420px', margin: '0 auto 1.5rem', fontSize: '0.9rem' }}>
                  Get started by adding your first grocery or hardware item, setting retail pricing and reorder levels.
                </p>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setShowAddDrawer(true)}
                  style={{ minWidth: '180px' }}
                >
                  + Add Your First Product
                </button>
              </div>
            ) : products.length === 0 ? (
              <div className="empty-state-box">
                <strong>No products match your search or category filter.</strong>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    setSearch('');
                    setCatFilter(undefined);
                    setDeptFilter(undefined);
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
                            <ProductRetailIcon name={p.name} category={p.categoryName} size={26} />
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
                              <strong style={{ color: 'var(--emerald)' }}>
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

        {/* SUB-MENU 2: Product Categories */}
        {activeTab === 'categories' && (
          <div id="products-panel-categories" role="tabpanel">
            <div className="section-head" style={{ marginBottom: '1rem' }}>
              <div>
                <h2>Store Categories &amp; Auto-Codes</h2>
                <span className="vernacular-sub">
                  {subLabel(
                    'Mhando dzeZvinhu • Categories dzine maCode eSystem (CAT-xxx)',
                    'Izigaba Zempahla • Uhlu Lwezigaba Zesitolo',
                    'Organize products into store categories with auto-generated category codes.',
                  )}
                </span>
              </div>
            </div>

            <div className="card" style={{ maxWidth: '540px', marginBottom: '1.25rem' }}>
              <h3 style={{ margin: '0 0 0.5rem' }}>+ Add New Product Category</h3>
              <form onSubmit={handleAddCategory} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <input
                    className="input"
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    placeholder="Category name (e.g. Beverages, Cereal and Grain)"
                    required
                  />
                  <span className="muted" style={{ fontSize: '0.75rem', display: 'block', marginTop: '0.25rem' }}>
                    ⚡ Category code is auto-generated by the system (e.g. CAT-004)
                  </span>
                </div>
                <button className="btn btn-primary" type="submit">+ Add Category</button>
              </form>
            </div>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Category Name</th>
                    <th>Products Count</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="muted text-center" style={{ padding: '2rem' }}>
                        No categories created yet.
                      </td>
                    </tr>
                  ) : (
                    categories.map((c) => {
                      const count = products.filter((p) => p.categoryId === c.id).length;
                      return (
                        <tr key={c.id}>
                          <td><code>{c.code ?? `CAT-${String(c.id).padStart(3, '0')}`}</code></td>
                          <td><strong>{c.name}</strong></td>
                          <td>{count} products linked</td>
                          <td>
                            <span className={`status-pill ${c.active ? 'optimal' : 'out'}`}>
                              {c.active ? 'ACTIVE' : 'INACTIVE'}
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

        {/* SUB-MENU 3: Packaging & Bulk Units */}
        {activeTab === 'packaging' && (
          <div id="products-panel-packaging" role="tabpanel">
            <div className="section-head" style={{ marginBottom: '1rem' }}>
              <div>
                <h2>Packaging Conversions &amp; Units of Measure</h2>
                <span className="vernacular-sub">
                  {subLabel(
                    'Kupatsanura Mabhero, Makatoni neCrates muZvibedu',
                    'Ukwehlukanisa Amabhokisi Lokungaphakathi',
                    'Configure how cartons, cases, crates, and bulk bags break down into base single shelf units.',
                  )}
                </span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem', marginBottom: '1.25rem' }}>
              <div className="subcard">
                <h3>+ Add Bulk Packaging Conversion</h3>
                <p className="muted" style={{ fontSize: '0.84rem', margin: '0 0 0.75rem' }}>
                  Define how many base single units make up a carton, case, bale, or crate.
                </p>
                <form className="form-grid" onSubmit={handleAddPackaging}>
                  <label>
                    Product
                    <select value={pkgProductId} onChange={(e) => setPkgProductId(e.target.value)} required>
                      <option value="">Select product...</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>[{p.sku}] {p.name} (base: {p.baseUnit})</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Bulk Packaging Unit
                    <select value={pkgUnitId} onChange={(e) => setPkgUnitId(e.target.value)} required>
                      <option value="">Select unit...</option>
                      {units.map((u) => (
                        <option key={u.id} value={u.id}>{u.name} ({u.code})</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Base Units per Bulk Pack (Factor)
                    <input type="number" step="0.001" min="0.001" value={pkgFactor} onChange={(e) => setPkgFactor(e.target.value)} required />
                  </label>
                  <div className="form-actions">
                    <button className="btn btn-primary" type="submit">+ Save Packaging Rule</button>
                  </div>
                </form>
              </div>

              <div className="subcard">
                <h3>+ Add New Unit of Measure</h3>
                <p className="muted" style={{ fontSize: '0.84rem', margin: '0 0 0.75rem' }}>
                  Register single or bulk units (e.g. 50kg Bag, Carton of 24, Litre).
                </p>
                <form onSubmit={handleAddUnit} className="form-grid">
                  <label>
                    Unit Label / Name *
                    <input
                      value={newUnitName}
                      onChange={(e) => setNewUnitName(e.target.value)}
                      placeholder="e.g. 50kg Bag or Carton of 24"
                      required
                    />
                  </label>
                  <label>
                    Unit Code (Auto-generated if blank)
                    <input
                      value={newUnitCode}
                      onChange={(e) => setNewUnitCode(e.target.value)}
                      placeholder="e.g. BAG-50 or leave blank"
                    />
                  </label>
                  <div className="form-actions">
                    <button className="btn btn-primary" type="submit">+ Add Unit of Measure</button>
                  </div>
                </form>
              </div>
            </div>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Unit Code</th>
                    <th>Unit Name</th>
                    <th>Registered Products with Bulk Packs</th>
                  </tr>
                </thead>
                <tbody>
                  {units.map((u) => {
                    const productsWithThisUnit = products.filter((p) => p.baseUnitId === u.id || p.packagings.some((g) => g.unitId === u.id));
                    return (
                      <tr key={u.id}>
                        <td><code>{u.code}</code></td>
                        <td><strong>{u.name}</strong></td>
                        <td>{productsWithThisUnit.length} products using this unit</td>
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
