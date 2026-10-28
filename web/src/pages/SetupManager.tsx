import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ApiError } from '../api';
import { portalPath, useAuth } from '../auth';
import { Logo } from '../components/Logo';
import { EyeIcon, EyeOffIcon, ShieldUserIcon } from '../components/Icons';

const DEFAULT_DEPARTMENTS = [
  'Groceries & FMCG',
  'Hardware & Building Supplies',
  'Agrovet, Fertilizer & Seed',
  'Solar, Gas & Electronics',
];

export function SetupManager() {
  const { user, loading, needsSetup, setupInitialManager } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Step 1: Owner / Executive Manager
  const [managerName, setManagerName] = useState('');
  const [managerEmail, setManagerEmail] = useState('');
  const [managerPassword, setManagerPassword] = useState('');
  const [managerPin, setManagerPin] = useState('1980');
  const [showPassword, setShowPassword] = useState(false);

  // Step 2: Business Profile & Currency
  const [businessName, setBusinessName] = useState('StockRoom Hardware & Groceries');
  const [city, setCity] = useState('Harare');
  const [currencyCode, setCurrencyCode] = useState<'USD' | 'ZiG' | 'ZAR'>('USD');

  // Step 3: Departments & POS Counter
  const [departments, setDepartments] = useState<string[]>([
    'Groceries & FMCG',
    'Hardware & Building Supplies',
  ]);
  const [customDeptInput, setCustomDeptInput] = useState('');
  const [posDepartmentName, setPosDepartmentName] = useState('Groceries & FMCG');

  if (!loading && user) {
    return <Navigate to={portalPath(user.role)} replace />;
  }

  function toggleDepartment(dept: string) {
    setDepartments((prev) => {
      if (prev.includes(dept)) {
        if (prev.length <= 1) return prev; // Keep at least one
        const next = prev.filter((d) => d !== dept);
        if (posDepartmentName === dept) setPosDepartmentName(next[0]);
        return next;
      }
      return [...prev, dept];
    });
  }

  function addCustomDepartment() {
    const val = customDeptInput.trim();
    if (val && !departments.includes(val)) {
      setDepartments((prev) => [...prev, val]);
      setCustomDeptInput('');
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (step < 3) {
      if (step === 1) {
        if (!managerName.trim() || !managerEmail.trim() || managerPassword.length < 8) {
          setError('Please provide your name, a valid email, and a password with at least 8 characters.');
          return;
        }
        if (!/^\d{4}$/.test(managerPin.trim())) {
          setError('Staff PIN must be exactly 4 digits.');
          return;
        }
      }
      if (step === 2) {
        if (!businessName.trim() || !city.trim()) {
          setError('Please specify the business name and operating city.');
          return;
        }
      }
      setError('');
      setStep((s) => (s + 1) as 2 | 3);
      return;
    }

    // Submit final setup
    setError('');
    setBusy(true);
    try {
      const newUser = await setupInitialManager({
        managerName: managerName.trim(),
        managerEmail: managerEmail.trim(),
        managerPassword,
        managerPin: managerPin.trim(),
        businessName: businessName.trim(),
        city: city.trim(),
        currencyCode,
        departments,
        posDepartmentName,
      });
      navigate(portalPath(newUser.role), { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.code === 'system_already_initialized'
            ? 'The system has already been initialized. Please sign in.'
            : err.message
          : 'Setup failed. Please check your connection and try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="card login-card animate-scale-up" style={{ maxWidth: '580px', width: '100%', padding: '2rem' }}>
        {/* Top Branding */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '1.5rem' }}>
          <Logo size={52} variant="full" themeColor="dark" />
          <div className="ndebele-ribbon" style={{ marginTop: '0.85rem', borderRadius: '2px' }} />
        </div>

        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0 }}>StockRoom Initialization Wizard</h1>
          <p className="muted" style={{ fontSize: '0.86rem', marginTop: '0.35rem', marginBottom: 0 }}>
            {step === 1 && 'Step 1 of 3: Create Executive Manager / Business Owner Account'}
            {step === 2 && 'Step 2 of 3: Set Business Profile & Multi-Currency Standards'}
            {step === 3 && 'Step 3 of 3: Configure Store Departments & Fast POS Counter'}
          </p>
        </div>

        {/* Stepper Progress Bar */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              style={{
                flex: 1,
                height: '5px',
                borderRadius: '3px',
                background: s <= step ? 'var(--zim-green-700)' : 'var(--line)',
                transition: 'background 0.25s ease',
              }}
            />
          ))}
        </div>

        {error && (
          <div className="banner danger animate-scale-up" style={{ marginBottom: '1.25rem' }}>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          {/* STEP 1: Executive Manager Details */}
          {step === 1 && (
            <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="info-banner" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', fontSize: '0.84rem', padding: '0.75rem 1rem', background: 'var(--zim-green-50)', borderRadius: '8px', borderLeft: '4px solid var(--zim-green-700)', color: 'var(--zim-green-900)' }}>
                <ShieldUserIcon size={20} style={{ color: 'var(--zim-green-700)', flexShrink: 0 }} />
                <span><strong>Executive Owner Account:</strong> Controls all store valuations, staff permissions, stock governance, and ZIMRA compliance.</span>
              </div>

              <label>
                Full Name of Business Owner / Executive
                <input
                  type="text"
                  placeholder="e.g. Farai Chitepo"
                  value={managerName}
                  onChange={(e) => setManagerName(e.target.value)}
                  required
                  autoFocus
                />
              </label>

              <label>
                Business Work Email (Sign-in Identifier)
                <input
                  type="email"
                  placeholder="e.g. owner@stockroom.co.zw"
                  value={managerEmail}
                  onChange={(e) => setManagerEmail(e.target.value)}
                  required
                />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <label>
                  Password (min 8 characters)
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      value={managerPassword}
                      onChange={(e) => setManagerPassword(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowPassword((p) => !p)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      style={{
                        position: 'absolute',
                        right: '10px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--zim-charcoal-800)',
                        display: 'flex',
                        alignItems: 'center',
                        padding: '4px',
                      }}
                    >
                      {showPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                    </button>
                  </div>
                </label>

                <label>
                  4-Digit Fast Storefloor PIN
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="e.g. 1980"
                    value={managerPin}
                    onChange={(e) => setManagerPin(e.target.value.replace(/\D/g, ''))}
                    required
                  />
                  <small className="muted" style={{ fontSize: '0.72rem' }}>
                    Instant 1-tap storefloor &amp; POS login
                  </small>
                </label>
              </div>
            </div>
          )}

          {/* STEP 2: Business Profile & Currency */}
          {step === 2 && (
            <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <label>
                Enterprise / Trading Store Name
                <input
                  type="text"
                  placeholder="e.g. StockRoom Hardware & Groceries"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  required
                  autoFocus
                />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <label>
                  Operating City / Town
                  <input
                    type="text"
                    placeholder="e.g. Harare"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    required
                  />
                </label>

                <label>
                  Primary Financial Ledger Currency
                  <select
                    value={currencyCode}
                    onChange={(e) => setCurrencyCode(e.target.value as 'USD' | 'ZiG' | 'ZAR')}
                  >
                    <option value="USD">USD ($) - United States Dollar</option>
                    <option value="ZiG">ZiG - Zimbabwe Gold</option>
                    <option value="ZAR">ZAR (R) - South African Rand</option>
                  </select>
                </label>
              </div>

              <div className="info-banner" style={{ fontSize: '0.82rem', padding: '0.75rem 1rem', background: 'var(--zim-gold-50)', borderRadius: '8px', borderLeft: '4px solid var(--zim-gold-500)' }}>
                <strong>🇿🇼 Multi-Currency Standard:</strong> You can switch display currencies at any second in the top header and configure live daily RBZ / market exchange rates in Settings.
              </div>
            </div>
          )}

          {/* STEP 3: Store Departments & Fast POS Binding */}
          {step === 3 && (
            <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <label>
                Active Storefloor Departments
                <span className="muted" style={{ display: 'block', fontSize: '0.76rem', fontWeight: 'normal', marginBottom: '0.5rem' }}>
                  Select the departments running in your store (e.g. Hardware and Groceries combined):
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  {DEFAULT_DEPARTMENTS.map((dept) => {
                    const active = departments.includes(dept);
                    return (
                      <button
                        key={dept}
                        type="button"
                        onClick={() => toggleDepartment(dept)}
                        style={{
                          padding: '0.45rem 0.85rem',
                          borderRadius: '20px',
                          border: active ? '1.5px solid var(--zim-green-700)' : '1px solid var(--line)',
                          background: active ? 'var(--zim-green-50)' : '#fff',
                          color: active ? 'var(--zim-green-900)' : 'var(--charcoal)',
                          fontWeight: active ? 700 : 500,
                          fontSize: '0.82rem',
                          cursor: 'pointer',
                        }}
                      >
                        {active ? '✓ ' : '+ '} {dept}
                      </button>
                    );
                  })}
                </div>
              </label>

              {/* Add custom department */}
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  placeholder="Add custom department name…"
                  value={customDeptInput}
                  onChange={(e) => setCustomDeptInput(e.target.value)}
                  style={{ flex: 1, fontSize: '0.85rem' }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addCustomDepartment();
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={addCustomDepartment}
                  disabled={!customDeptInput.trim()}
                >
                  + Add
                </button>
              </div>

              {/* POS department linking */}
              <label style={{ marginTop: '0.5rem' }}>
                Select Department for Fast Storefloor POS Counter
                <span className="muted" style={{ display: 'block', fontSize: '0.76rem', fontWeight: 'normal', marginBottom: '0.35rem' }}>
                  The fast checkout counter will automatically query inventory from this department:
                </span>
                <select
                  value={posDepartmentName}
                  onChange={(e) => setPosDepartmentName(e.target.value)}
                >
                  {departments.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {/* Stepper Navigation Buttons */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.75rem', paddingTop: '1rem', borderTop: '1px solid var(--line)' }}>
            {step > 1 ? (
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setError('');
                  setStep((s) => (s - 1) as 1 | 2);
                }}
                disabled={busy}
              >
                ← Back
              </button>
            ) : (
              <div />
            )}

            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy}
              style={{ minWidth: '150px' }}
            >
              {busy ? (
                'Initializing StockRoom…'
              ) : step < 3 ? (
                'Continue →'
              ) : (
                'Launch StockRoom →'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
