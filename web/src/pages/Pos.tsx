import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Spinner } from '../components/Spinner';
import { useZim } from '../zimContext';
import { StorefloorIcon, CartIcon, PrinterIcon, CheckCircleIcon } from '../components/Icons';

interface CartItem {
  productId: number;
  sku: string;
  name: string;
  unitCode: string;
  unitId: number;
  unitSellingPrice: number;
  unitCost: number;
  vatCategory: 'standard_15' | 'zero_rated' | 'exempt';
  quantity: number;
  maxStock: number;
}

interface PosProduct {
  id: number;
  sku: string;
  name: string;
  unitId: number;
  unitCode: string;
  unitCost: number;
  sellingPrice: number;
  wholesalePrice: number;
  vatCategory: 'standard_15' | 'zero_rated' | 'exempt';
  departmentId: number | null;
  departmentName: string;
  currentStock: number;
}

export function Pos() {
  const { user } = useAuth();
  const { formatMoney, subLabel, rates, fdms } = useZim();

  const [catalog, setCatalog] = useState<PosProduct[]>([]);
  const [posDeptName, setPosDeptName] = useState('Groceries & Staples');
  const [posDeptId, setPosDeptId] = useState<number | null>(null);
  const [defaultWarehouseId, setDefaultWarehouseId] = useState<number>(1);
  const [allDepartments, setAllDepartments] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<'all' | 'groceries' | 'hardware'>('all');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [tenderType, setTenderType] = useState<
    'USD_CASH' | 'ZIG_CASH' | 'ZAR_CASH' | 'ECOCASH_USD' | 'ECOCASH_ZIG' | 'INNBUCKS' | 'ONEMONEY_ZIG' | 'CREDIT'
  >('USD_CASH');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [changeVoucherAmountUsd, setChangeVoucherAmountUsd] = useState<number>(0);
  const [holdForYardCollection, setHoldForYardCollection] = useState(false);
  const [busyCheckout, setBusyCheckout] = useState(false);
  const [receiptModal, setReceiptModal] = useState<any | null>(null);
  const [error, setError] = useState('');
  const [successNotice, setSuccessNotice] = useState('');
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.posCatalog();
      setCatalog(res.products);
      setPosDeptName(res.posDepartmentName);
      setPosDeptId(res.posDepartmentId);
      setDefaultWarehouseId(res.defaultWarehouseId);
      setAllDepartments(res.departments);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  // Quick keyboard shortcut (F2 to focus search, F9 or Enter to pay)
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  function addToCart(p: PosProduct) {
    setSuccessNotice('');
    setCart((prev) => {
      const existing = prev.find((item) => item.productId === p.id);
      if (existing) {
        return prev.map((item) =>
          item.productId === p.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [
        ...prev,
        {
          productId: p.id,
          sku: p.sku,
          name: p.name,
          unitCode: p.unitCode,
          unitId: p.unitId,
          unitSellingPrice: p.sellingPrice,
          unitCost: p.unitCost,
          vatCategory: p.vatCategory,
          quantity: 1,
          maxStock: p.currentStock,
        },
      ];
    });
  }

  function updateQty(productId: number, delta: number) {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.productId === productId) {
            const nextQty = Math.max(0, item.quantity + delta);
            return { ...item, quantity: nextQty };
          }
          return item;
        })
        .filter((item) => item.quantity > 0)
    );
  }

  function updatePrice(productId: number, newPrice: number) {
    setCart((prev) =>
      prev.map((item) =>
        item.productId === productId ? { ...item, unitSellingPrice: Math.max(0, newPrice) } : item
      )
    );
  }

  function removeItem(productId: number) {
    setCart((prev) => prev.filter((item) => item.productId !== productId));
  }

  function clearCart() {
    setCart([]);
    setChangeVoucherAmountUsd(0);
    setCustomerName('');
    setCustomerPhone('');
    setHoldForYardCollection(false);
    setError('');
  }

  const subtotalUsd = cart.reduce((sum, item) => sum + item.unitSellingPrice * item.quantity, 0);
  const vat15Usd = cart
    .filter((i) => i.vatCategory === 'standard_15')
    .reduce((sum, item) => sum + (item.unitSellingPrice * item.quantity * 15) / 115, 0);
  const totalUsd = subtotalUsd;

  // Multi-currency equivalencies
  const totalZig = Math.round(totalUsd * rates.ZiG * 100) / 100;
  const totalZar = Math.round(totalUsd * rates.ZAR * 100) / 100;

  async function handleCheckout(e: FormEvent) {
    e.preventDefault();
    if (cart.length === 0) return;
    setBusyCheckout(true);
    setError('');
    try {
      const saleLines = cart.map((item) => ({
        productId: item.productId,
        unitId: item.unitId,
        quantity: item.quantity,
        unitSellingPrice: item.unitSellingPrice,
      }));

      const res = await api.counterSale({
        warehouseId: defaultWarehouseId,
        departmentId: posDeptId,
        departmentName: posDeptName,
        tenderType,
        customerName: customerName.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
        holdForLaterCollection: holdForYardCollection,
        changeVoucherAmountUsd: changeVoucherAmountUsd > 0 ? changeVoucherAmountUsd : undefined,
        lines: saleLines,
      });

      // Show receipt modal with real ZIMRA fiscal record
      setReceiptModal({
        sale: res,
        lines: [...cart],
        subtotalUsd,
        vat15Usd,
        totalUsd,
        tenderType,
        customerName: customerName || 'Walk-In Customer',
        customerPhone,
        cashier: user?.name ?? 'Counter Staff',
        department: posDeptName,
        issuedVoucherCode: res.issuedVoucherCode,
        fiscalReceipt: res.fiscalReceipt,
        date: new Date().toLocaleString(),
      });

      setSuccessNotice(`✓ Sale #${res.document.id} recorded with ZIMRA fiscalization!`);
      clearCart();
      loadCatalog();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyCheckout(false);
    }
  }

  const filteredCatalog = catalog.filter((p) => {
    const q = search.toLowerCase();
    const matchSearch = p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
    if (!matchSearch) return false;
    if (selectedCategoryFilter === 'groceries') {
      return (
        p.departmentName.toLowerCase().includes('groc') ||
        p.vatCategory === 'zero_rated'
      );
    }
    if (selectedCategoryFilter === 'hardware') {
      return (
        p.departmentName.toLowerCase().includes('hard') ||
        p.departmentName.toLowerCase().includes('yard')
      );
    }
    return true;
  });

  return (
    <div className="pos-workspace animate-fade-in">
      {/* POS Top Header Banner */}
      <div className="pos-topbar card" style={{ padding: '0.85rem 1.25rem', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          <div className="pos-station-badge">
            <span className="live-dot" style={{ background: '#10b981' }} />
            <strong>POS Counter</strong>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span className="pos-dept-title">Linked Department:</span>
              <span className="status-pill optimal" style={{ fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                <StorefloorIcon size={14} /> {posDeptName}
              </span>
            </div>
            <span className="vernacular-sub" style={{ fontSize: '0.74rem' }}>
              {subLabel('Kutengesa Kwepakaunda ZIMRA FDMS Yabatidzwa', 'Ukuthengisa Esitolo ZIMRA FDMS')}
            </span>
          </div>
        </div>

        {/* ZIMRA FDMS Status Indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div className="zimra-live-pill" title="ZIMRA FDMS Fiscal Device Status">
            <span className="stockroom-title-badge" style={{ fontSize: '0.65rem' }}>ZW</span>
            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--emerald)' }}>ZIMRA FDMS ACTIVE</div>
              <div className="muted" style={{ fontSize: '0.68rem', margin: 0 }}>Device: ESD-ZW-88421 • Day #1</div>
            </div>
          </div>
          <button type="button" className="btn btn-outline btn-sm" onClick={loadCatalog} title="Refresh Stock Quantities">
            ↻ Sync Stock
          </button>
        </div>
      </div>

      {successNotice && (
        <div className="banner success animate-scale-up" style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between' }}>
          <span>{successNotice}</span>
          <button type="button" className="btn btn-link btn-sm" onClick={() => setSuccessNotice('')}>✕</button>
        </div>
      )}

      {error && (
        <div className="banner danger animate-scale-up" style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between' }}>
          <span>{error}</span>
          <button type="button" className="btn btn-link btn-sm" onClick={() => setError('')}>✕</button>
        </div>
      )}

      {/* POS Two-Column Grid: Catalog on Left (60%), Cart & Checkout on Right (40%) */}
      <div className="pos-grid" style={{ display: 'grid', gridTemplateColumns: '1.25fr 0.95fr', gap: '1rem', alignItems: 'start' }}>
        
        {/* LEFT COLUMN: Fast Search & Product Tiles */}
        <div className="pos-catalog-col">
          <div className="card" style={{ padding: '1rem' }}>
            {/* Search Input & Quick Filters */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <input
                  ref={searchInputRef}
                  type="search"
                  className="search-input"
                  placeholder="Scan barcode or type product name (F2)..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ width: '100%', fontSize: '0.95rem', padding: '0.65rem 0.85rem' }}
                />
              </div>
              <div className="pos-filter-group" style={{ display: 'flex', gap: '0.35rem' }}>
                <button
                  type="button"
                  className={`btn btn-sm ${selectedCategoryFilter === 'all' ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setSelectedCategoryFilter('all')}
                >
                  All ({catalog.length})
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${selectedCategoryFilter === 'groceries' ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setSelectedCategoryFilter('groceries')}
                >
                  Groceries
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${selectedCategoryFilter === 'hardware' ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setSelectedCategoryFilter('hardware')}
                >
                  Hardware
                </button>
              </div>
            </div>

            {loading ? (
              <Spinner label="Loading POS catalog" />
            ) : catalog.length === 0 ? (
              <div className="empty-state" style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.75rem', color: 'var(--muted)' }}>
                  <CartIcon size={44} />
                </div>
                <h3 style={{ margin: '0 0 0.5rem' }}>No Products in POS Department</h3>
                <p className="muted" style={{ fontSize: '0.86rem', maxWidth: '400px', margin: '0 auto 1.25rem' }}>
                  There are no products currently assigned to <strong>&ldquo;{posDeptName}&rdquo;</strong>. Add grocery or hardware products in the Stock Catalog to start selling.
                </p>
                <Link to={user?.role === 'executive_manager' ? '/executive/products' : '/inventory/products'} className="btn btn-primary btn-sm">
                  + Add Products to Catalog
                </Link>
              </div>
            ) : filteredCatalog.length === 0 ? (
              <div className="empty-state" style={{ padding: '2rem 1rem', textAlign: 'center' }}>
                <p className="muted">No products found matching &quot;{search}&quot;</p>
              </div>
            ) : (
              <div className="pos-product-tiles" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '0.65rem', maxHeight: '560px', overflowY: 'auto', paddingRight: '0.25rem' }}>
                {filteredCatalog.map((p) => {
                  const inCartItem = cart.find((c) => c.productId === p.id);
                  const isOutOfStock = p.currentStock <= 0;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={isOutOfStock}
                      onClick={() => addToCart(p)}
                      className={`pos-product-card transition-all ${inCartItem ? 'in-cart' : ''} ${isOutOfStock ? 'out-of-stock' : ''}`}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        textAlign: 'left',
                        padding: '0.75rem',
                        borderRadius: '10px',
                        border: inCartItem ? '2px solid var(--zim-gold-500)' : '1px solid var(--line)',
                        background: inCartItem ? 'var(--zim-gold-50)' : 'var(--surface)',
                        cursor: isOutOfStock ? 'not-allowed' : 'pointer',
                        opacity: isOutOfStock ? 0.55 : 1,
                        position: 'relative',
                      }}
                    >
                      {inCartItem && (
                        <span className="cart-badge-pill" style={{ position: 'absolute', top: '6px', right: '6px', background: 'var(--zim-green-700)', color: '#fff', fontSize: '0.7rem', padding: '2px 6px', borderRadius: '12px', fontWeight: 800 }}>
                          ×{inCartItem.quantity}
                        </span>
                      )}

                      <div style={{ fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 600 }}>{p.sku}</div>
                      <div style={{ fontSize: '0.86rem', fontWeight: 700, margin: '0.2rem 0', minHeight: '2.4em', lineHeight: 1.25 }}>
                        {p.name}
                      </div>

                      <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--emerald)' }}>
                          {formatMoney(p.sellingPrice)}
                        </span>
                        <span style={{ fontSize: '0.74rem', color: isOutOfStock ? 'var(--danger)' : 'var(--emerald)', fontWeight: 600 }}>
                          {p.currentStock} {p.unitCode}
                        </span>
                      </div>

                      <div style={{ fontSize: '0.68rem', marginTop: '0.25rem', color: p.vatCategory === 'standard_15' ? '#d97706' : '#2563eb' }}>
                        {p.vatCategory === 'standard_15' ? '15% VAT' : '0% Zero-Rated'}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Active Cart, Multi-Tender & Fast Checkout */}
        <div className="pos-cart-col">
          <div className="card" style={{ padding: '1rem', borderTop: '4px solid var(--zim-gold-500)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <h3 style={{ margin: 0 }}>Current Order</h3>
                <span className="status-pill optimal" style={{ fontSize: '0.75rem' }}>
                  {cart.reduce((s, i) => s + i.quantity, 0)} Items
                </span>
              </div>
              {cart.length > 0 && (
                <button type="button" className="btn btn-outline btn-sm" onClick={clearCart} style={{ color: 'var(--danger)', borderColor: 'var(--line)' }}>
                  Clear Cart
                </button>
              )}
            </div>

            {/* Cart Items List */}
            <div className="pos-cart-items" style={{ maxHeight: '250px', overflowY: 'auto', marginBottom: '1rem', borderBottom: '1px solid var(--line)', paddingBottom: '0.5rem' }}>
              {cart.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--muted)' }}>
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.4rem' }}>
                    <CartIcon size={32} />
                  </div>
                  <p style={{ margin: 0, fontSize: '0.88rem' }}>Cart is empty. Tap items on the left to add.</p>
                </div>
              ) : (
                <table className="pos-cart-table" style={{ width: '100%', fontSize: '0.84rem', borderCollapse: 'collapse' }}>
                  <tbody>
                    {cart.map((item) => (
                      <tr key={item.productId} style={{ borderBottom: '1px dashed var(--line)' }}>
                        <td style={{ padding: '0.4rem 0' }}>
                          <div style={{ fontWeight: 700 }}>{item.name}</div>
                          <div className="muted" style={{ fontSize: '0.72rem' }}>
                            {formatMoney(item.unitSellingPrice)} / {item.unitCode} • {item.vatCategory === 'standard_15' ? '15% VAT' : 'Zero-Rated'}
                          </div>
                        </td>
                        <td style={{ padding: '0.4rem 0.25rem', textAlign: 'center' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              style={{ padding: '0.15rem 0.45rem', fontSize: '0.8rem', height: 'auto' }}
                              onClick={() => updateQty(item.productId, -1)}
                            >
                              -
                            </button>
                            <span style={{ fontWeight: 800, minWidth: '1.5rem', textAlign: 'center' }}>
                              {item.quantity}
                            </span>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              style={{ padding: '0.15rem 0.45rem', fontSize: '0.8rem', height: 'auto' }}
                              onClick={() => updateQty(item.productId, 1)}
                            >
                              +
                            </button>
                          </div>
                        </td>
                        <td style={{ padding: '0.4rem 0', textAlign: 'right', fontWeight: 800 }}>
                          {formatMoney(item.unitSellingPrice * item.quantity)}
                        </td>
                        <td style={{ padding: '0.4rem 0 0.4rem 0.4rem', textAlign: 'right' }}>
                          <button
                            type="button"
                            className="btn btn-link btn-sm"
                            style={{ color: 'var(--danger)', padding: 0 }}
                            onClick={() => removeItem(item.productId)}
                            title="Remove"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Price Breakdown Totals */}
            <div className="pos-totals-box" style={{ background: 'var(--surface-alt)', border: '1.5px solid var(--line)', padding: '0.85rem', borderRadius: '10px', marginBottom: '1rem', boxShadow: 'var(--shadow-sm)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', margin: '0.2rem 0', fontWeight: 600 }}>
                <span className="muted">Subtotal:</span>
                <span>{formatMoney(subtotalUsd)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', margin: '0.2rem 0', fontWeight: 600 }}>
                <span className="muted">ZIMRA 15% VAT Portion:</span>
                <span style={{ color: 'var(--zim-gold-500)', fontWeight: 700 }}>{formatMoney(vat15Usd)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.3rem', fontWeight: 900, borderTop: '2px solid var(--line)', paddingTop: '0.5rem', marginTop: '0.4rem', color: 'var(--charcoal)' }}>
                <span>Total Due:</span>
                <span style={{ color: 'var(--emerald)' }}>{formatMoney(totalUsd)}</span>
              </div>

              {/* Multi-Currency Equivalents */}
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', fontSize: '0.78rem', background: 'var(--surface)', border: '1px solid var(--line)', padding: '0.45rem 0.65rem', borderRadius: '6px' }}>
                <div style={{ flex: 1 }}>
                  <span className="muted" style={{ marginRight: '4px' }}>ZiG:</span> <strong>{totalZig.toFixed(2)} ZiG</strong>
                </div>
                <div style={{ flex: 1 }}>
                  <span className="muted" style={{ marginRight: '4px' }}>ZAR:</span> <strong>R {totalZar.toFixed(2)}</strong>
                </div>
              </div>
            </div>

            {/* Payment Tender Selection */}
            <form onSubmit={handleCheckout}>
              <div style={{ marginBottom: '0.75rem' }}>
                <label style={{ fontSize: '0.82rem', fontWeight: 700, marginBottom: '0.35rem', display: 'block' }}>
                  Select Tender / Payment Method:
                </label>
                <div className="tender-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.35rem' }}>
                  {[
                    { id: 'USD_CASH', label: 'USD ($)' },
                    { id: 'ZIG_CASH', label: 'ZiG (Cash)' },
                    { id: 'ZAR_CASH', label: 'ZAR (R)' },
                    { id: 'ECOCASH_USD', label: 'EcoCash $' },
                    { id: 'ECOCASH_ZIG', label: 'EcoCash ZiG' },
                    { id: 'INNBUCKS', label: 'InnBucks' },
                    { id: 'CREDIT', label: 'Chikwereti' },
                    { id: 'ONEMONEY_ZIG', label: 'OneMoney' },
                  ].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={`btn btn-sm ${tenderType === t.id ? 'btn-primary' : 'btn-outline'}`}
                      style={{ padding: '0.45rem 0.2rem', fontSize: '0.76rem', fontWeight: 700 }}
                      onClick={() => setTenderType(t.id as any)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Customer Details & Options */}
              <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <label style={{ fontSize: '0.78rem' }}>
                  Customer Name
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Walk-In Customer"
                    style={{ padding: '0.4rem' }}
                  />
                </label>
                <label style={{ fontSize: '0.78rem' }}>
                  Phone / EcoCash / WhatsApp
                  <input
                    type="text"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="+263 77..."
                    style={{ padding: '0.4rem' }}
                  />
                </label>
              </div>

              {/* Hardware Yard Lay-By & Small-Change Options */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '1rem', fontSize: '0.8rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={holdForYardCollection}
                    onChange={(e) => setHoldForYardCollection(e.target.checked)}
                  />
                  <span><strong>Hold in Yard for Later Collection</strong> (Hardware Lay-By)</span>
                </label>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="muted">USD Change Voucher:</span>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    max="10"
                    placeholder="$0.00"
                    value={changeVoucherAmountUsd || ''}
                    onChange={(e) => setChangeVoucherAmountUsd(parseFloat(e.target.value) || 0)}
                    style={{ width: '80px', padding: '0.25rem 0.4rem', fontSize: '0.85rem' }}
                  />
                  <span className="muted" style={{ fontSize: '0.72rem' }}>e.g. $0.35 credit voucher</span>
                </div>
              </div>

              {/* Oversized Fast Checkout Button */}
              <button
                type="submit"
                disabled={busyCheckout || cart.length === 0}
                className="btn btn-primary pos-checkout-btn"
                style={{
                  width: '100%',
                  padding: '0.9rem',
                  fontSize: '1.15rem',
                  fontWeight: 800,
                  background: 'linear-gradient(135deg, var(--zim-green-700), var(--zim-green-800))',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: '0.65rem',
                }}
              >
                {busyCheckout ? (
                  <span>Processing Fiscal Sale…</span>
                ) : (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                    <CheckCircleIcon size={20} /> Complete Fiscal Sale • {formatMoney(totalUsd)}
                  </span>
                )}
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* ZIMRA Fiscal Receipt Modal */}
      {receiptModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card fiscal-receipt-modal animate-scale-up" style={{ maxWidth: '440px' }}>
            <div className="receipt-paper" style={{ background: '#fff', color: '#111827', padding: '1.25rem', border: '1px solid #ddd', borderRadius: '4px', fontFamily: 'monospace', fontSize: '0.82rem', lineHeight: 1.4 }}>
              <div style={{ textAlign: 'center', marginBottom: '0.75rem' }}>
                <h3 style={{ margin: '0 0 0.2rem', fontSize: '1.1rem', fontFamily: 'sans-serif', color: '#111827' }}>StockRoom ZW</h3>
                <div>FISCAL TAX INVOICE</div>
                <div>ZIMRA FDMS Virtual Fiscal Device</div>
                <div style={{ fontSize: '0.74rem', color: '#666' }}>TIN: 1002948201 • VAT: 10029482</div>
                <div style={{ fontSize: '0.74rem', color: '#666' }}>Device: ESD-ZW-88421 • Fiscal Day: #1</div>
                <div style={{ borderBottom: '1px dashed #000', margin: '0.5rem 0' }} />
              </div>

              <div style={{ marginBottom: '0.5rem' }}>
                <div>Receipt: {receiptModal.fiscalReceipt?.receiptNumber ?? `FR-${receiptModal.sale.document.id}`}</div>
                <div>Date: {receiptModal.date}</div>
                <div>Cashier: {receiptModal.cashier}</div>
                <div>Department: {receiptModal.department}</div>
                <div>Customer: {receiptModal.customerName} {receiptModal.customerPhone}</div>
                <div>Tender: {receiptModal.tenderType}</div>
                <div style={{ borderBottom: '1px dashed #000', margin: '0.5rem 0' }} />
              </div>

              {/* Line Items */}
              <table style={{ width: '100%', marginBottom: '0.5rem' }}>
                <tbody>
                  {receiptModal.lines.map((l: CartItem) => (
                    <tr key={l.productId}>
                      <td>{l.quantity}x {l.name}</td>
                      <td style={{ textAlign: 'right' }}>${(l.quantity * l.unitSellingPrice).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ borderBottom: '1px dashed #000', margin: '0.5rem 0' }} />

              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Subtotal (Net):</span>
                <span>${(receiptModal.totalUsd - receiptModal.vat15Usd).toFixed(2)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>15% Output VAT:</span>
                <span>${receiptModal.vat15Usd.toFixed(2)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.1rem', fontWeight: 800, margin: '0.35rem 0' }}>
                <span>TOTAL USD:</span>
                <span>${receiptModal.totalUsd.toFixed(2)}</span>
              </div>

              {receiptModal.issuedVoucherCode && (
                <div style={{ background: '#fef3c7', padding: '0.4rem', borderRadius: '4px', textAlign: 'center', margin: '0.5rem 0', fontWeight: 700 }}>
                  Change Voucher Issued: {receiptModal.issuedVoucherCode} (${changeVoucherAmountUsd.toFixed(2)})
                </div>
              )}

              {/* ZIMRA QR Code Stamp */}
              <div style={{ textAlign: 'center', marginTop: '0.75rem', padding: '0.5rem', background: '#f9f9f9', border: '1px solid #eee' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#114B3E' }}>VERIFIED FISCAL DOCUMENT</div>
                <div style={{ fontSize: '0.68rem', wordBreak: 'break-all', color: '#666', marginTop: '0.2rem' }}>
                  {receiptModal.fiscalReceipt?.verificationUrl ?? 'https://fdms.zimra.co.zw/verify'}
                </div>
                <div style={{ fontSize: '0.68rem', marginTop: '0.2rem', color: '#888' }}>
                  Scan with ZIMRA Fiscal App to Validate
                </div>
              </div>
            </div>

            <div className="form-actions" style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                className="btn btn-primary"
                style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.45rem' }}
                onClick={() => window.print()}
              >
                <PrinterIcon size={16} /> Print Slip (Esc)
              </button>
              <button type="button" className="btn btn-outline" onClick={() => setReceiptModal(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
