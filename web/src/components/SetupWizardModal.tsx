import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { useZim } from '../zimContext';
import { Logo } from './Logo';

interface SetupWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const TEMPLATE_PRESETS = [
  {
    id: 'groceries_hardware',
    title: 'Dual-Department: Groceries & Hardware (Harare / Bulawayo)',
    departments: ['Groceries & Staples', 'Hardware & Building', 'Retail Dispatch'],
    posDepartment: 'Groceries & Staples',
    starterProducts: [
      { sku: 'RICE-2KG', name: 'Mahatma Rice 2kg', department: 'Groceries & Staples', unitCost: 2.2, sellingPrice: 2.9, vatCategory: 'zero_rated' as const, initialStock: 50 },
      { sku: 'OIL-2L', name: 'Roil Cooking Oil 2L', department: 'Groceries & Staples', unitCost: 3.2, sellingPrice: 3.8, vatCategory: 'zero_rated' as const, initialStock: 40 },
      { sku: 'SUGAR-2KG', name: 'Huletts White Sugar 2kg', department: 'Groceries & Staples', unitCost: 2.4, sellingPrice: 3.1, vatCategory: 'zero_rated' as const, initialStock: 60 },
      { sku: 'CEM-50KG', name: 'PPC Surebuild Cement 50kg', department: 'Hardware & Building', unitCost: 9.8, sellingPrice: 12.5, vatCategory: 'standard_15' as const, initialStock: 80 },
      { sku: 'IBR-36M', name: 'IBR Chromadek Sheet 3.6m', department: 'Hardware & Building', unitCost: 16.5, sellingPrice: 22.0, vatCategory: 'standard_15' as const, initialStock: 30 },
      { sku: 'NAILS-3IN', name: 'Wire Nails 3-Inch (1kg)', department: 'Hardware & Building', unitCost: 1.8, sellingPrice: 2.5, vatCategory: 'standard_15' as const, initialStock: 45 },
    ],
  },
  {
    id: 'tuckshop_supermarket',
    title: 'Tuckshop / Minimarket Retail',
    departments: ['Dry Groceries', 'Beverages & Dairy', 'Bakery & Confectionery'],
    posDepartment: 'Dry Groceries',
    starterProducts: [
      { sku: 'MAZOE-2L', name: 'Mazoe Orange Crush 2L', department: 'Beverages & Dairy', unitCost: 3.1, sellingPrice: 4.0, vatCategory: 'standard_15' as const, initialStock: 35 },
      { sku: 'MEALIE-10KG', name: 'Roller Meal 10kg', department: 'Dry Groceries', unitCost: 5.8, sellingPrice: 7.2, vatCategory: 'zero_rated' as const, initialStock: 30 },
      { sku: 'BREAD-LOAF', name: 'Bakers Inn Sliced Bread', department: 'Bakery & Confectionery', unitCost: 0.9, sellingPrice: 1.2, vatCategory: 'zero_rated' as const, initialStock: 50 },
    ],
  },
  {
    id: 'hardware_yard',
    title: 'Hardware & Timber Yard Only',
    departments: ['Cement & Aggregates', 'Timber & Roofing', 'Plumbing & Electrical'],
    posDepartment: 'Cement & Aggregates',
    starterProducts: [
      { sku: 'CEM-32N', name: 'PPC Cement 50kg (32.5N)', department: 'Cement & Aggregates', unitCost: 9.8, sellingPrice: 12.5, vatCategory: 'standard_15' as const, initialStock: 100 },
      { sku: 'TIMBER-38X114', name: 'Structural Timber 38x114 (6m)', department: 'Timber & Roofing', unitCost: 12.0, sellingPrice: 16.5, vatCategory: 'standard_15' as const, initialStock: 40 },
    ],
  },
];

export function SetupWizardModal({ isOpen, onClose, onSuccess }: SetupWizardModalProps) {
  const { subLabel } = useZim();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [orgName, setOrgName] = useState('StockRoom Dual-Trading Store');
  const [currency, setCurrency] = useState<'USD' | 'ZiG' | 'ZAR'>('USD');
  const [branchName, setBranchName] = useState('Main Branch');
  const [city, setCity] = useState('Harare');
  const [selectedPreset, setSelectedPreset] = useState(TEMPLATE_PRESETS[0]);
  const [posDept, setPosDept] = useState(TEMPLATE_PRESETS[0].posDepartment);
  const [departmentsText, setDepartmentsText] = useState(TEMPLATE_PRESETS[0].departments.join(', '));
  const [includeStarterStock, setIncludeStarterStock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  async function handleFinish(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const depts = departmentsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const payload = {
        organisationName: orgName,
        currencyCode: currency,
        branchName,
        city,
        departments: depts.length > 0 ? depts : selectedPreset.departments,
        posDepartmentName: posDept || depts[0] || 'General Storefloor',
        starterProducts: includeStarterStock ? selectedPreset.starterProducts : [],
      };

      await api.initializeSystem(payload);
      onSuccess();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="setup-wizard-title">
      <div className="modal-card setup-wizard-card animate-scale-up" style={{ maxWidth: '640px' }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Logo size={32} variant="mark" />
            <div>
              <h2 id="setup-wizard-title" style={{ margin: 0 }}>StockRoom Initialization Wizard</h2>
              <span className="vernacular-sub" style={{ fontSize: '0.76rem' }}>
                {subLabel('Kugadzirisa & Kutanga Bhizinesi Idzva', 'Ukusetha Lokuvula Ibhizimusi')}
              </span>
            </div>
          </div>
          <button type="button" className="btn btn-outline btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Wizard Step Progression Bar */}
        <div className="wizard-progress-bar" style={{ margin: '1rem 0 1.25rem' }}>
          <div className={`wizard-step ${step >= 1 ? 'active' : ''}`}>
            <span className="step-num">1</span>
            <span>Business Info</span>
          </div>
          <div className="wizard-line" />
          <div className={`wizard-step ${step >= 2 ? 'active' : ''}`}>
            <span className="step-num">2</span>
            <span>Departments &amp; POS</span>
          </div>
          <div className="wizard-line" />
          <div className={`wizard-step ${step >= 3 ? 'active' : ''}`}>
            <span className="step-num">3</span>
            <span>Starter Catalog</span>
          </div>
        </div>

        {error && <div className="banner danger" style={{ marginBottom: '1rem' }}>{error}</div>}

        {/* STEP 1: Business Identity & Currency */}
        {step === 1 && (
          <div className="wizard-step-content animate-fade-in">
            <p className="muted" style={{ margin: '0 0 1rem', fontSize: '0.88rem' }}>
              Set up your business identity, primary trading currency, and default operational branch.
            </p>
            <div className="form-grid">
              <label>
                Business / Enterprise Name
                <input
                  type="text"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="e.g. Ruwa Hardware & Groceries Mart"
                  required
                />
              </label>

              <label>
                Primary Trading Currency
                <select value={currency} onChange={(e) => setCurrency(e.target.value as any)}>
                  <option value="USD">USD ($) — Multi-Currency with ZiG/ZAR cash-up</option>
                  <option value="ZiG">ZiG — Zimbabwe Gold Primary</option>
                  <option value="ZAR">ZAR (R) — South African Rand Primary</option>
                </select>
              </label>

              <label>
                Main Branch Name
                <input
                  type="text"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  placeholder="e.g. Harare Central HQ"
                  required
                />
              </label>

              <label>
                Location / City
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="e.g. Harare / Bulawayo / Mutare"
                  required
                />
              </label>
            </div>

            <div className="form-actions" style={{ marginTop: '1.5rem', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-primary" onClick={() => setStep(2)}>
                Next: Setup Departments &amp; POS →
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: Departments & POS Binding */}
        {step === 2 && (
          <div className="wizard-step-content animate-fade-in">
            <p className="muted" style={{ margin: '0 0 1rem', fontSize: '0.88rem' }}>
              Choose your business preset and select which department will be bound to the fast Storefloor POS counter.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
              {TEMPLATE_PRESETS.map((preset) => (
                <label
                  key={preset.id}
                  className={`card preset-card ${selectedPreset.id === preset.id ? 'is-selected' : ''}`}
                  style={{
                    padding: '0.75rem 1rem',
                    border: selectedPreset.id === preset.id ? '2px solid var(--zim-gold-500)' : '1px solid var(--line)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                  }}
                >
                  <input
                    type="radio"
                    name="preset_select"
                    checked={selectedPreset.id === preset.id}
                    onChange={() => {
                      setSelectedPreset(preset);
                      setPosDept(preset.posDepartment);
                      setDepartmentsText(preset.departments.join(', '));
                    }}
                  />
                  <div>
                    <strong style={{ fontSize: '0.92rem' }}>{preset.title}</strong>
                    <div className="muted" style={{ fontSize: '0.78rem' }}>
                      Departments: {preset.departments.join(' • ')}
                    </div>
                  </div>
                </label>
              ))}
            </div>

            <div className="form-grid">
              <label>
                Configured Departments (comma-separated)
                <input
                  type="text"
                  value={departmentsText}
                  onChange={(e) => setDepartmentsText(e.target.value)}
                  placeholder="Groceries, Hardware, Dispatch"
                  required
                />
              </label>

              <label>
                Default POS Counter Department
                <input
                  type="text"
                  value={posDept}
                  onChange={(e) => setPosDept(e.target.value)}
                  placeholder="e.g. Groceries & Staples"
                  required
                />
              </label>
            </div>

            <div className="form-actions" style={{ marginTop: '1.5rem', justifyContent: 'space-between' }}>
              <button type="button" className="btn btn-outline" onClick={() => setStep(1)}>
                ← Back
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setStep(3)}>
                Next: Starter Stock →
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: Starter Products & Final Review */}
        {step === 3 && (
          <form className="wizard-step-content animate-fade-in" onSubmit={handleFinish}>
            <p className="muted" style={{ margin: '0 0 1rem', fontSize: '0.88rem' }}>
              Review your starter configuration and seed initial inventory products with verified stock balances.
            </p>

            <div className="subcard" style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <strong>Pre-load Realistic Starter Products</strong>
                  <div className="muted" style={{ fontSize: '0.8rem' }}>
                    Includes {selectedPreset.starterProducts.length} items ({selectedPreset.starterProducts.map((p) => p.name).slice(0, 3).join(', ')}…)
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={includeStarterStock}
                  onChange={(e) => setIncludeStarterStock(e.target.checked)}
                  style={{ width: '1.25rem', height: '1.25rem', cursor: 'pointer' }}
                />
              </div>
            </div>

            <div className="subcard" style={{ fontSize: '0.84rem', lineHeight: 1.6 }}>
              <div><strong>Business Name:</strong> {orgName}</div>
              <div><strong>Branch &amp; Warehouse:</strong> {branchName} ({city}) • Main Store &amp; Yard</div>
              <div><strong>Active Currency:</strong> {currency} ($)</div>
              <div><strong>Linked POS Department:</strong> <span className="status-pill optimal">{posDept}</span></div>
            </div>

            <div className="form-actions" style={{ marginTop: '1.5rem', justifyContent: 'space-between' }}>
              <button type="button" className="btn btn-outline" onClick={() => setStep(2)}>
                ← Back
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Initializing StockRoom…' : '✓ Finish & Initialize System'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
