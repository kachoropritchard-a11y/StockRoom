import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type BalanceItem, type ProductItem } from '../api';
import { Spinner } from '../components/Spinner';

const PAGE_SIZE = 10;

export function Products() {
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [totalProducts, setTotalProducts] = useState(0);
  const [page, setPage] = useState(0);
  const [balances, setBalances] = useState<BalanceItem[]>([]);
  const [categories, setCategories] = useState<{ id: number; name: string; active: number }[]>([]);
  const [units, setUnits] = useState<{ id: number; code: string; name: string }[]>([]);
  const [warehouses, setWarehouses] = useState<{ id: number; name: string }[]>([]);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState<number | undefined>(undefined);
  const [whFilter, setWhFilter] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  // New Product form
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [baseUnitId, setBaseUnitId] = useState<string>('');
  const [unitCost, setUnitCost] = useState('0');
  const [reorderLevel, setReorderLevel] = useState('10');

  // Edit Product state
  const [editingProduct, setEditingProduct] = useState<ProductItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editCategoryId, setEditCategoryId] = useState<string>('');
  const [editUnitCost, setEditUnitCost] = useState('0');
  const [editReorderLevel, setEditReorderLevel] = useState('0');

  // Packaging form
  const [pkgProductId, setPkgProductId] = useState<string>('');
  const [pkgUnitId, setPkgUnitId] = useState<string>('');
  const [pkgFactor, setPkgFactor] = useState('12');

  // Category & Unit forms
  const [newCategory, setNewCategory] = useState('');
  const [newUnitCode, setNewUnitCode] = useState('');
  const [newUnitName, setNewUnitName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, bRes, cRes, uRes, wRes] = await Promise.all([
        api.products(search, { categoryId: catFilter, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
        api.balances(whFilter),
        api.categories(),
        api.units(),
        api.warehouses(),
      ]);
      setProducts(pRes.items);
      setTotalProducts(pRes.total);
      setBalances(bRes.items);
      setCategories(cRes);
      setUnits(uRes);
      setWarehouses(wRes);
      if (!baseUnitId && uRes[0]) setBaseUnitId(String(uRes[0].id));
      if (!pkgProductId && pRes.items[0]) setPkgProductId(String(pRes.items[0].id));
      if (!pkgUnitId && uRes[1]) setPkgUnitId(String(uRes[1].id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [search, catFilter, page, whFilter, baseUnitId, pkgProductId, pkgUnitId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreateProduct(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMsg('');
    try {
      await api.createProduct({
        sku,
        name,
        categoryId: categoryId ? Number(categoryId) : null,
        baseUnitId: Number(baseUnitId),
        unitCost: Number(unitCost),
        reorderLevel: Number(reorderLevel),
      });
      setSku('');
      setName('');
      setMsg('Product created.');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function startEditProduct(p: ProductItem) {
    setEditingProduct(p);
    setEditName(p.name);
    setEditCategoryId(p.categoryId ? String(p.categoryId) : '');
    setEditUnitCost(String(p.unitCost));
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
        unitCost: Number(editUnitCost),
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

  async function handleToggleCategory(c: { id: number; name: string; active: number }) {
    setError('');
    try {
      await api.updateCategory(c.id, { active: !c.active });
      setMsg(`Category "${c.name}" ${c.active ? 'deactivated' : 'activated'}.`);
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

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Product &amp; Category Management</h1>
          <p className="muted">Catalogue with unit conversions, categories, reorder levels, unit costs and live warehouse balances.</p>
        </div>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      {msg && <p className="form-success" role="status">{msg}</p>}

      <div className="dashboard-panels">
        <section className="card">
          <h2>Add New Product</h2>
          <form className="form-grid" onSubmit={handleCreateProduct}>
            <label>
              SKU
              <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="e.g. GRN-MZ10" required />
            </label>
            <label>
              Product Name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Roller Meal 10kg" required />
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
              Base Unit
              <select value={baseUnitId} onChange={(e) => setBaseUnitId(e.target.value)} required>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>{u.name} ({u.code})</option>
                ))}
              </select>
            </label>
            <label>
              Base Unit Cost (USD)
              <input type="number" step="0.01" min="0" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} required />
            </label>
            <label>
              Reorder Level (Base Units)
              <input type="number" step="0.001" min="0" value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} required />
            </label>
            <div className="form-actions">
              <button className="btn btn-primary" type="submit">Create Product</button>
            </div>
          </form>
        </section>

        <section className="card">
          <h2>Packaging Conversions &amp; Categories</h2>
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
              <button className="btn btn-outline" type="submit">+ Add Conversion</button>
            </div>
          </form>

          <hr className="divider" />
          <div className="inline-forms">
            <form onSubmit={handleAddCategory} className="inline-form">
              <input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="New category name" />
              <button className="btn btn-outline" type="submit">+ Category</button>
            </form>
            <form onSubmit={handleAddUnit} className="inline-form">
              <input value={newUnitCode} onChange={(e) => setNewUnitCode(e.target.value)} placeholder="Unit code (e.g. bag)" style={{ maxWidth: '130px' }} />
              <input value={newUnitName} onChange={(e) => setNewUnitName(e.target.value)} placeholder="Unit label (e.g. 50kg Bag)" />
              <button className="btn btn-outline" type="submit">+ Unit</button>
            </form>
          </div>
          {categories.length > 0 && (
            <div className="chip-row" style={{ marginTop: '.75rem' }}>
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`chip-toggle ${c.active ? 'active' : 'inactive'}`}
                  onClick={() => handleToggleCategory(c)}
                  title="Click to toggle active status"
                >
                  {c.name} {c.active ? '✓' : '(inactive)'}
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      {editingProduct && (
        <section className="card" style={{ marginTop: '1.25rem' }}>
          <div className="section-head">
            <h2>Edit Product: {editingProduct.sku}</h2>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditingProduct(null)}>Cancel</button>
          </div>
          <form className="form-grid" onSubmit={handleSaveEditProduct}>
            <label>
              Product Name
              <input value={editName} onChange={(e) => setEditName(e.target.value)} required />
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
              Base Unit Cost (USD)
              <input type="number" step="0.01" min="0" value={editUnitCost} onChange={(e) => setEditUnitCost(e.target.value)} required />
            </label>
            <label>
              Reorder Level ({editingProduct.baseUnit})
              <input type="number" step="0.001" min="0" value={editReorderLevel} onChange={(e) => setEditReorderLevel(e.target.value)} required />
            </label>
            <div className="form-actions">
              <button className="btn btn-primary" type="submit">Save Changes</button>
            </div>
          </form>
        </section>
      )}

      <section className="card" style={{ marginTop: '1.25rem' }}>
        <div className="section-head">
          <h2>Product Catalogue ({totalProducts})</h2>
          <div className="filter-bar">
            <select
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
              placeholder="Search by SKU or product name…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </div>
        </div>
        {loading ? (
          <Spinner label="Loading products" />
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Product</th>
                    <th>Category</th>
                    <th>Base Unit</th>
                    <th>Packagings</th>
                    <th className="num">Unit Cost</th>
                    <th className="num">Reorder At</th>
                    <th className="num">Total On Hand</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.id}>
                      <td><code>{p.sku}</code></td>
                      <td>
                        <strong>{p.name}</strong>
                        {!p.active && <span className="badge badge-write_off" style={{ marginLeft: '.4rem' }}>Inactive</span>}
                      </td>
                      <td>{p.categoryName ?? '—'}</td>
                      <td>{p.baseUnit}</td>
                      <td>
                        {p.packagings.length > 0
                          ? p.packagings.map((g) => `1 ${g.unit} = ${g.factor} ${p.baseUnit}`).join(', ')
                          : 'Base unit only'}
                      </td>
                      <td className="num">${p.unitCost.toFixed(2)}</td>
                      <td className="num">{p.reorderLevel} {p.baseUnit}</td>
                      <td className={`num ${p.reorderLevel > 0 && p.totalStock <= p.reorderLevel ? 'badge-danger-text' : ''}`}>
                        <strong>{p.totalStock} {p.baseUnit}</strong>
                      </td>
                      <td className="action-row">
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => startEditProduct(p)}>
                          Edit
                        </button>
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => handleToggleProductActive(p)}>
                          {p.active ? 'Deactivate' : 'Activate'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination-bar">
              <span className="muted">
                Page {page + 1} of {totalPages} ({totalProducts} total items)
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
          </>
        )}
      </section>

      <section className="card" style={{ marginTop: '1.25rem' }}>
        <div className="section-head">
          <h2>Stock Balances by Warehouse</h2>
          <select value={whFilter ?? ''} onChange={(e) => setWhFilter(e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">All Warehouses</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Warehouse</th>
                <th>SKU</th>
                <th>Product</th>
                <th className="num">On Hand</th>
                <th className="num">Unit Cost</th>
                <th className="num">Stock Value</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {balances.map((b) => (
                <tr key={`${b.productId}-${b.warehouseId}`}>
                  <td>{b.warehouseName}</td>
                  <td><code>{b.sku}</code></td>
                  <td><strong>{b.productName}</strong></td>
                  <td className="num">{b.quantity} {b.unit}</td>
                  <td className="num">${b.unitCost.toFixed(2)}</td>
                  <td className="num">${b.stockValue.toFixed(2)}</td>
                  <td>
                    {b.lowStock ? (
                      <span className="badge badge-write_off">Low stock (≤ {b.reorderLevel})</span>
                    ) : (
                      <span className="badge badge-receipt">Healthy</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
