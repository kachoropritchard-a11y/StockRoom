import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type BalanceItem, type ProductItem } from '../api';
import { Spinner } from '../components/Spinner';

export function Products() {
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [balances, setBalances] = useState<BalanceItem[]>([]);
  const [categories, setCategories] = useState<{ id: number; name: string }[]>([]);
  const [units, setUnits] = useState<{ id: number; code: string; name: string }[]>([]);
  const [warehouses, setWarehouses] = useState<{ id: number; name: string }[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: number; name: string; email: string | null; phone: string | null }[]>([]);
  const [search, setSearch] = useState('');
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

  // Packaging form
  const [pkgProductId, setPkgProductId] = useState<string>('');
  const [pkgUnitId, setPkgUnitId] = useState<string>('');
  const [pkgFactor, setPkgFactor] = useState('12');

  // Quick master data forms
  const [newCategory, setNewCategory] = useState('');
  const [newSupplierName, setNewSupplierName] = useState('');
  const [newSupplierPhone, setNewSupplierPhone] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, bRes, cRes, uRes, wRes, sRes] = await Promise.all([
        api.products(search),
        api.balances(whFilter),
        api.categories(),
        api.units(),
        api.warehouses(),
        api.suppliers(),
      ]);
      setProducts(pRes.items);
      setBalances(bRes.items);
      setCategories(cRes);
      setUnits(uRes);
      setWarehouses(wRes);
      setSuppliers(sRes);
      if (!baseUnitId && uRes[0]) setBaseUnitId(String(uRes[0].id));
      if (!pkgProductId && pRes.items[0]) setPkgProductId(String(pRes.items[0].id));
      if (!pkgUnitId && uRes[1]) setPkgUnitId(String(uRes[1].id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [search, whFilter, baseUnitId, pkgProductId, pkgUnitId]);

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

  async function handleAddSupplier(e: FormEvent) {
    e.preventDefault();
    if (!newSupplierName.trim()) return;
    setError('');
    try {
      await api.createSupplier({ name: newSupplierName.trim(), phone: newSupplierPhone.trim() || undefined });
      setNewSupplierName('');
      setNewSupplierPhone('');
      setMsg('Supplier added.');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Products, Packaging &amp; Balances</h1>
          <p className="muted">Catalogue with unit conversions, reorder levels, unit costs and live warehouse balances.</p>
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
              <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="e.g. GRN-mz10" required />
            </label>
            <label>
              Product Name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Roller Meal 10kg" required />
            </label>
            <label>
              Category
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Uncategorised</option>
                {categories.map((c) => (
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
          <h2>Packaging Conversion &amp; Master Data</h2>
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
            <form onSubmit={handleAddSupplier} className="inline-form">
              <input value={newSupplierName} onChange={(e) => setNewSupplierName(e.target.value)} placeholder="New supplier name" />
              <input value={newSupplierPhone} onChange={(e) => setNewSupplierPhone(e.target.value)} placeholder="Phone (optional)" />
              <button className="btn btn-outline" type="submit">+ Supplier</button>
            </form>
          </div>
          {suppliers.length > 0 && (
            <p className="muted" style={{ marginTop: '.6rem', marginBottom: 0 }}>
              Active suppliers: {suppliers.map((s) => s.name).join(' • ')}
            </p>
          )}
        </section>
      </div>

      <section className="card" style={{ marginTop: '1.25rem' }}>
        <div className="section-head">
          <h2>Product Catalogue ({products.length})</h2>
          <input
            className="search-input"
            type="search"
            placeholder="Search by SKU or product name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {loading ? (
          <Spinner label="Loading products" />
        ) : (
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
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id}>
                    <td><code>{p.sku}</code></td>
                    <td><strong>{p.name}</strong></td>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
