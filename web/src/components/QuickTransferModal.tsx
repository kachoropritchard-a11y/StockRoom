import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type BalanceItem, type ProductItem } from '../api';

export interface QuickTransferModalProps {
  open: boolean;
  initialProductId?: number;
  initialFromWarehouseId?: number;
  onClose: () => void;
  onSuccess?: (msg: string) => void;
}

/**
 * Glassmorphic "QUICK-TRANSFER STOCK" modal inspired by the reference design.
 * Supports full keyboard navigation (Escape to close, Tab/Enter to authorize) and mouse interaction.
 */
export function QuickTransferModal({
  open,
  initialProductId,
  initialFromWarehouseId,
  onClose,
  onSuccess,
}: QuickTransferModalProps) {
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [warehouses, setWarehouses] = useState<{ id: number; name: string }[]>([]);
  const [balances, setBalances] = useState<BalanceItem[]>([]);
  const [productId, setProductId] = useState('');
  const [fromWhId, setFromWhId] = useState('');
  const [toWhId, setToWhId] = useState('');
  const [qty, setQty] = useState('10');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const firstSelectRef = useRef<HTMLSelectElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setError('');
    Promise.all([api.products('', { limit: 200 }), api.warehouses(), api.balances()])
      .then(([pRes, wRes, bRes]) => {
        setProducts(pRes.items);
        setWarehouses(wRes);
        setBalances(bRes.items);
        const pId = initialProductId ? String(initialProductId) : pRes.items[0] ? String(pRes.items[0].id) : '';
        setProductId(pId);
        const fId = initialFromWarehouseId ? String(initialFromWarehouseId) : wRes[0] ? String(wRes[0].id) : '';
        setFromWhId(fId);
        const dest = wRes.find((w) => String(w.id) !== fId) ?? wRes[1] ?? wRes[0];
        if (dest) setToWhId(String(dest.id));
        setTimeout(() => firstSelectRef.current?.focus(), 20);
      })
      .catch((e: Error) => setError(e.message));
  }, [open, initialProductId, initialFromWarehouseId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const selectedProduct = products.find((p) => String(p.id) === productId);
  const sourceBalance =
    balances.find((b) => String(b.productId) === productId && String(b.warehouseId) === fromWhId)?.quantity ?? 0;
  const capacityPct = selectedProduct?.reorderLevel
    ? Math.min(100, Math.round((sourceBalance / Math.max(1, selectedProduct.reorderLevel * 2)) * 100))
    : sourceBalance > 0
      ? 80
      : 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedProduct) return;
    if (fromWhId === toWhId) {
      setError('Source and destination warehouses must be different.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api.postStock('transfers', {
        reference: reference.trim() || `QTRF-${Date.now().toString().slice(-5)}`,
        lines: [
          {
            productId: Number(productId),
            warehouseId: Number(fromWhId),
            toWarehouseId: Number(toWhId),
            unitId: selectedProduct.baseUnitId,
            quantity: Number(qty),
          },
        ],
      });
      onSuccess?.(`Authorized Quick-Transfer Document #${res.document.id} (${qty} ${selectedProduct.baseUnit} of ${selectedProduct.sku}).`);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-transfer-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="modal-card modal-card-transfer">
        <div className="modal-header-row">
          <h3 id="quick-transfer-title" className="modal-uppercase-title">QUICK-TRANSFER STOCK</h3>
          <button type="button" className="btn-icon-close" aria-label="Close modal" onClick={onClose}>
            ✕
          </button>
        </div>

        {error && <p className="form-error" role="alert" style={{ marginTop: '.5rem' }}>{error}</p>}

        <form onSubmit={handleSubmit} className="transfer-modal-form">
          <label>
            <span>Search / Select Stock (SKU)</span>
            <select ref={firstSelectRef} value={productId} onChange={(e) => setProductId(e.target.value)} required>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} ({p.name})
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Source Warehouse / Bin</span>
            <select value={fromWhId} onChange={(e) => setFromWhId(e.target.value)} required>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  FROM: {w.name}
                </option>
              ))}
            </select>
            <div className="source-meter-row">
              <span className="muted" style={{ margin: 0, fontSize: '.8rem' }}>
                Available in source: <strong>{sourceBalance} {selectedProduct?.baseUnit ?? 'units'}</strong>
              </span>
              <div className="stock-bar-track" style={{ maxWidth: '120px' }}>
                <div className="stock-bar-fill optimal" style={{ width: `${capacityPct}%` }} />
              </div>
            </div>
          </label>

          <label>
            <span>Destination Warehouse / Bin</span>
            <select value={toWhId} onChange={(e) => setToWhId(e.target.value)} required>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  TO: {w.name}
                </option>
              ))}
            </select>
            <span className="live-vacancy-hint">● Live destination ready for transfer</span>
          </label>

          <div className="transfer-split-row">
            <label style={{ flex: 1 }}>
              <span>Quantity ({selectedProduct?.baseUnit ?? 'units'})</span>
              <div className="qty-with-max">
                <input
                  type="number"
                  step="0.001"
                  min="0.001"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  required
                />
                <span className="qty-max-hint">(max {sourceBalance})</span>
              </div>
            </label>
            <label style={{ flex: 1 }}>
              <span>Reference (Optional)</span>
              <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. TRF-FAST-01" />
            </label>
          </div>

          <div className="transfer-modal-actions">
            <button type="submit" className="btn btn-authorize" disabled={busy}>
              {busy ? 'Authorizing…' : 'Authorize Transfer'}
            </button>
            <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
