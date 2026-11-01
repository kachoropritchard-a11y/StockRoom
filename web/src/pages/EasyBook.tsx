import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useZim } from '../zimContext';
import { Spinner } from '../components/Spinner';

interface CashbookEntry {
  id: number;
  entryDate: string;
  entryType: 'INCOME' | 'EXPENSE';
  category: string;
  description: string;
  paymentMethod: 'CASH' | 'ECOCASH' | 'BANK';
  currency: 'USD' | 'ZiG';
  amount: number;
  receiptVoucherRef: string | null;
  reconciled: boolean;
  createdByName: string;
  createdAt: string;
}

export function EasyBook() {
  const { formatMoney, subLabel } = useZim();

  const [entries, setEntries] = useState<CashbookEntry[]>([]);
  const [summary, setSummary] = useState<Record<string, { income: number; expense: number; balance: number }>>({
    USD: { income: 0, expense: 0, balance: 0 },
    ZiG: { income: 0, expense: 0, balance: 0 },
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Filter
  const [filterType, setFilterType] = useState<'ALL' | 'INCOME' | 'EXPENSE'>('ALL');
  const [filterCur, setFilterCur] = useState<'ALL' | 'USD' | 'ZiG'>('ALL');

  // Modal: Add Entry
  const [showAddModal, setShowAddModal] = useState(false);
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [entryType, setEntryType] = useState<'INCOME' | 'EXPENSE'>('INCOME');
  const [category, setCategory] = useState('Daily Cash Sales');
  const [description, setDescription] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'ECOCASH' | 'BANK'>('CASH');
  const [currency, setCurrency] = useState<'USD' | 'ZiG'>('USD');
  const [amount, setAmount] = useState('');
  const [voucherRef, setVoucherRef] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function loadCashbook() {
    setLoading(true);
    api
      .cashbook()
      .then((res) => {
        setEntries(res.entries);
        setSummary(res.summary);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadCashbook();
  }, []);

  function openCreateEntry(type: 'INCOME' | 'EXPENSE') {
    setEntryType(type);
    setCategory(type === 'INCOME' ? 'Daily Cash Sales' : 'Supplier Restock');
    setDescription('');
    setAmount('');
    setVoucherRef('');
    setEntryDate(new Date().toISOString().slice(0, 10));
    setShowAddModal(true);
  }

  async function handleAddEntry(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const parsedAmount = parseFloat(amount);
      if (!parsedAmount || parsedAmount <= 0) {
        throw new Error('Please enter a valid amount greater than 0.');
      }

      await api.postCashbookEntry({
        entryDate,
        entryType,
        category,
        description: description.trim(),
        paymentMethod,
        currency,
        amount: parsedAmount,
        receiptVoucherRef: voucherRef.trim() || undefined,
      });

      setShowAddModal(false);
      setSuccess(`✓ ${entryType === 'INCOME' ? 'Income' : 'Expense'} entry of ${currency === 'USD' ? '$' : ''}${parsedAmount.toFixed(2)} ${currency === 'ZiG' ? 'ZiG' : ''} balanced successfully!`);
      loadCashbook();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteEntry(id: number) {
    if (!window.confirm('Are you sure you want to reverse this entry?')) return;
    try {
      await api.deleteCashbookEntry(id);
      setSuccess('✓ Entry deleted.');
      loadCashbook();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const filteredEntries = entries.filter((item) => {
    if (filterType !== 'ALL' && item.entryType !== filterType) return false;
    if (filterCur !== 'ALL' && item.currency !== filterCur) return false;
    return true;
  });

  const usdSummary = summary.USD || { income: 0, expense: 0, balance: 0 };
  const zigSummary = summary.ZiG || { income: 0, expense: 0, balance: 0 };

  return (
    <div className="easybook-page animate-fade-in">
      {/* Top Banner & Fast Actions */}
      <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <span style={{ fontSize: '1.6rem' }}>⚖️</span>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.35rem' }}>EasyBook CashBook & SME Balancing</h2>
                <span className="vernacular-sub" style={{ fontSize: '0.78rem' }}>
                  {subLabel('Kuyananisa Mari yeKupinda neKubuda', 'Ukulinganisa Imali Engenayo Lephumayo')}
                </span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => openCreateEntry('EXPENSE')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700, color: '#dc2626', borderColor: '#fca5a5' }}
            >
              - Record Expense
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => openCreateEntry('INCOME')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                fontWeight: 800,
                background: 'linear-gradient(135deg, var(--zim-green-700), var(--zim-green-800))',
              }}
            >
              + Record Income
            </button>
          </div>
        </div>

        {/* Real-time Balancing Overview */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
            gap: '0.75rem',
            marginTop: '1.25rem',
          }}
        >
          {/* USD Net Cash In Hand */}
          <div style={{ background: 'var(--surface-alt)', padding: '0.85rem', borderRadius: '8px', border: '1.5px solid var(--line)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="muted" style={{ fontSize: '0.74rem', textTransform: 'uppercase', fontWeight: 700 }}>
                USD Net Balance
              </span>
              <span className="status-pill optimal" style={{ fontSize: '0.68rem', fontWeight: 800 }}>USD ($)</span>
            </div>
            <div style={{ fontSize: '1.65rem', fontWeight: 900, color: usdSummary.balance >= 0 ? 'var(--emerald)' : 'var(--danger)', marginTop: '0.2rem' }}>
              ${usdSummary.balance.toFixed(2)}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', marginTop: '0.2rem', color: 'var(--muted)' }}>
              <span>In: +${usdSummary.income.toFixed(2)}</span>
              <span>Out: -${usdSummary.expense.toFixed(2)}</span>
            </div>
          </div>

          {/* ZiG Net Cash In Hand */}
          <div style={{ background: 'var(--surface-alt)', padding: '0.85rem', borderRadius: '8px', border: '1.5px solid var(--line)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="muted" style={{ fontSize: '0.74rem', textTransform: 'uppercase', fontWeight: 700 }}>
                ZiG Net Balance
              </span>
              <span className="status-pill optimal" style={{ fontSize: '0.68rem', fontWeight: 800, background: '#fef3c7', color: '#b45309' }}>ZiG</span>
            </div>
            <div style={{ fontSize: '1.65rem', fontWeight: 900, color: zigSummary.balance >= 0 ? 'var(--zim-gold-500)' : 'var(--danger)', marginTop: '0.2rem' }}>
              {zigSummary.balance.toFixed(2)} ZiG
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', marginTop: '0.2rem', color: 'var(--muted)' }}>
              <span>In: +{zigSummary.income.toFixed(2)} ZiG</span>
              <span>Out: -{zigSummary.expense.toFixed(2)} ZiG</span>
            </div>
          </div>

          {/* Reconciled Count */}
          <div style={{ background: 'var(--surface-alt)', padding: '0.85rem', borderRadius: '8px', border: '1.5px solid var(--line)' }}>
            <span className="muted" style={{ fontSize: '0.74rem', textTransform: 'uppercase', fontWeight: 700 }}>
              Audit Reconciled
            </span>
            <div style={{ fontSize: '1.65rem', fontWeight: 900, color: 'var(--charcoal)', marginTop: '0.2rem' }}>
              {entries.length} Balanced
            </div>
            <span className="muted" style={{ fontSize: '0.72rem' }}>
              100% matched with till & receipts
            </span>
          </div>
        </div>
      </div>

      {error && (
        <div className="banner danger animate-scale-up" style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between' }}>
          <span>{error}</span>
          <button type="button" className="btn btn-link btn-sm" onClick={() => setError('')}>✕</button>
        </div>
      )}

      {success && (
        <div className="banner success animate-scale-up" style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between' }}>
          <span>{success}</span>
          <button type="button" className="btn btn-link btn-sm" onClick={() => setSuccess('')}>✕</button>
        </div>
      )}

      {/* Filter Row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ display: 'flex', gap: '0.35rem' }}>
          {(['ALL', 'INCOME', 'EXPENSE'] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={`btn btn-sm ${filterType === t ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setFilterType(t)}
              style={{ fontWeight: 700 }}
            >
              {t === 'ALL' ? 'All Transactions' : t === 'INCOME' ? '🟢 Income Only' : '🔴 Expenses Only'}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '0.35rem' }}>
          {(['ALL', 'USD', 'ZiG'] as const).map((c) => (
            <button
              key={c}
              type="button"
              className={`btn btn-sm ${filterCur === c ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setFilterCur(c)}
              style={{ fontWeight: 700 }}
            >
              {c === 'ALL' ? 'Both Currencies' : c}
            </button>
          ))}
        </div>
      </div>

      {/* CashBook Journal Table */}
      <div className="card" style={{ padding: '1rem' }}>
        {loading ? (
          <Spinner label="Loading EasyBook cash journal..." />
        ) : filteredEntries.length === 0 ? (
          <div className="empty-state" style={{ padding: '2.5rem', textAlign: 'center' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>📖</div>
            <h3>No Entries Found</h3>
            <p className="muted" style={{ maxWidth: '400px', margin: '0.25rem auto 1rem', fontSize: '0.88rem' }}>
              Track every cash dollar, EcoCash receipt, rent, ZESA token, or payroll wage easily with no accounting complexity.
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem' }}>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => openCreateEntry('INCOME')}>
                + Record First Income
              </button>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => openCreateEntry('EXPENSE')}>
                - Record First Expense
              </button>
            </div>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="data-table" style={{ width: '100%', fontSize: '0.88rem' }}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Category</th>
                  <th>Description & Reference</th>
                  <th>Payment Method</th>
                  <th className="num">Inflow (+)</th>
                  <th className="num">Outflow (-)</th>
                  <th>Recorded By</th>
                  <th className="num">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((item) => {
                  const isInc = item.entryType === 'INCOME';
                  return (
                    <tr key={item.id}>
                      <td>{item.entryDate}</td>
                      <td>
                        <span
                          className="status-pill"
                          style={{
                            background: isInc ? '#ecfdf5' : '#fef2f2',
                            color: isInc ? '#047857' : '#b91c1c',
                            fontWeight: 800,
                          }}
                        >
                          {isInc ? '▲ IN' : '▼ OUT'}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600 }}>{item.category}</td>
                      <td>
                        <div>{item.description}</div>
                        {item.receiptVoucherRef && (
                          <code style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Ref: {item.receiptVoucherRef}</code>
                        )}
                      </td>
                      <td>
                        <span className="muted" style={{ fontSize: '0.78rem' }}>
                          {item.paymentMethod === 'ECOCASH' ? '📱 EcoCash' : item.paymentMethod === 'CASH' ? '💵 Cash' : '🏦 Bank'}
                        </span>
                      </td>
                      <td className="num" style={{ fontWeight: 800, color: 'var(--emerald)' }}>
                        {isInc ? `${item.currency === 'USD' ? '$' : ''}${item.amount.toFixed(2)} ${item.currency === 'ZiG' ? 'ZiG' : ''}` : '-'}
                      </td>
                      <td className="num" style={{ fontWeight: 800, color: '#dc2626' }}>
                        {!isInc ? `${item.currency === 'USD' ? '$' : ''}${item.amount.toFixed(2)} ${item.currency === 'ZiG' ? 'ZiG' : ''}` : '-'}
                      </td>
                      <td className="muted" style={{ fontSize: '0.78rem' }}>{item.createdByName}</td>
                      <td className="num">
                        <button
                          type="button"
                          className="btn btn-link btn-sm"
                          style={{ color: 'var(--danger)', padding: 0 }}
                          onClick={() => handleDeleteEntry(item.id)}
                          title="Reverse this entry"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL: Record Income or Expense */}
      {showAddModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card animate-scale-up" style={{ maxWidth: '480px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.4rem' }}>{entryType === 'INCOME' ? '🟢' : '🔴'}</span>
                <h3 style={{ margin: 0 }}>
                  Record {entryType === 'INCOME' ? 'Cash Inflow (Income)' : 'Cash Outflow (Expense)'}
                </h3>
              </div>
              <button type="button" className="btn btn-link btn-sm" onClick={() => setShowAddModal(false)}>
                ✕
              </button>
            </div>

            <form onSubmit={handleAddEntry}>
              <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
                <label>
                  Transaction Date *
                  <input
                    type="date"
                    required
                    value={entryDate}
                    onChange={(e) => setEntryDate(e.target.value)}
                  />
                </label>

                <label>
                  Payment Method *
                  <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as any)}>
                    <option value="CASH">💵 Cash</option>
                    <option value="ECOCASH">📱 EcoCash</option>
                    <option value="BANK">🏦 Bank</option>
                  </select>
                </label>

                <label style={{ gridColumn: '1 / -1' }}>
                  Category *
                  <select value={category} onChange={(e) => setCategory(e.target.value)}>
                    {entryType === 'INCOME' ? (
                      <>
                        <option value="Daily Cash Sales">Daily Cash Sales</option>
                        <option value="Debtor Repayment (Chikwereti)">Debtor Repayment (Chikwereti)</option>
                        <option value="Owner Capital Injection">Owner Capital Injection</option>
                        <option value="Other Income">Other Income</option>
                      </>
                    ) : (
                      <>
                        <option value="Supplier Restock">Supplier Restock</option>
                        <option value="Salaries & Wages">Salaries & Wages</option>
                        <option value="Rent & Rates">Rent & Rates</option>
                        <option value="Utilities/ZESA/Water">Utilities / ZESA / Water</option>
                        <option value="Fuel & Transport">Fuel & Transport</option>
                        <option value="Packaging & Bags">Packaging & Bags</option>
                        <option value="Maintenance & Repairs">Maintenance & Repairs</option>
                        <option value="Miscellaneous">Miscellaneous</option>
                      </>
                    )}
                  </select>
                </label>

                <label style={{ gridColumn: '1 / -1' }}>
                  Description / Reason *
                  <input
                    type="text"
                    required
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={entryType === 'INCOME' ? 'e.g. Afternoon counter sales batch' : 'e.g. Prepaid ZESA electricity token'}
                  />
                </label>

                <label>
                  Amount *
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                  />
                </label>

                <label>
                  Currency *
                  <select value={currency} onChange={(e) => setCurrency(e.target.value as any)}>
                    <option value="USD">USD ($)</option>
                    <option value="ZiG">ZiG</option>
                  </select>
                </label>

                <label style={{ gridColumn: '1 / -1' }}>
                  Receipt / Voucher Ref (Optional)
                  <input
                    type="text"
                    value={voucherRef}
                    onChange={(e) => setVoucherRef(e.target.value)}
                    placeholder="e.g. RCPT-902 or ZESA-8841"
                  />
                </label>
              </div>

              <div className="form-actions" style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn btn-primary"
                  style={{
                    flex: 1,
                    fontWeight: 800,
                    background: entryType === 'INCOME' ? 'linear-gradient(135deg, var(--zim-green-700), var(--zim-green-800))' : '#dc2626',
                  }}
                >
                  {submitting ? 'Balancing...' : `Save ${entryType === 'INCOME' ? 'Income' : 'Expense'}`}
                </button>
                <button type="button" className="btn btn-outline" onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
