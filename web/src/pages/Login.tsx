import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ApiError } from '../api';
import { portalPath, useAuth } from '../auth';
import { Logo } from '../components/Logo';

const messages: Record<string, string> = {
  invalid_credentials: 'Incorrect email, password, or 4-digit staff PIN.',
  account_locked: 'Too many failed attempts. This account is locked for 15 minutes. Contact an administrator if you need help.',
  validation_error: 'Enter a valid email and password.',
  rate_limit_exceeded: 'Too many attempts. Please wait a minute and try again.',
  'Too Many Requests': 'Too many attempts. Please wait a minute and try again.',
};

export function Login() {
  const { user, loading, needsSetup, login, pinLogin } = useAuth();
  const [mode, setMode] = useState<'email' | 'pin'>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to={portalPath(user.role)} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'pin') {
        await pinLogin(pin);
      } else {
        await login(email, password);
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? messages[err.code] ?? messages[err.message] ?? (err.status === 0 ? err.message : err.message || 'Sign in failed.')
          : 'Sign in failed.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="card login-card animate-scale-up" onSubmit={submit} noValidate>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.25rem' }}>
          <Logo size={48} variant="full" themeColor="dark" />
        </div>
        <h1>Sign in</h1>
        <p className="muted" style={{ marginTop: '-0.25rem', fontSize: '0.84rem' }}>
          Groceries &amp; Hardware Dual-Department SME Inventory • Pinda muHurongwa
        </p>

        {needsSetup && (
          <div
            className="animate-fade-in"
            style={{
              marginBottom: '1rem',
              textAlign: 'left',
              background: 'var(--surface-alt)',
              borderLeft: '4px solid var(--zim-gold-500)',
              padding: '0.75rem 1rem',
              borderRadius: '8px',
            }}
          >
            <div style={{ fontWeight: 800, color: 'var(--charcoal)', fontSize: '0.88rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <span className="live-dot" style={{ background: 'var(--zim-gold-500)' }} />
              Initial Setup Required
            </div>
            <p style={{ margin: '0.25rem 0 0.65rem', fontSize: '0.82rem', color: 'var(--muted)' }}>
              No owner account exists. Initialize StockRoom to create your Executive Manager profile and set up departments.
            </p>
            <Link to="/setup" className="btn btn-sm btn-primary" style={{ display: 'inline-block' }}>
              Launch Setup Wizard →
            </Link>
          </div>
        )}

        <div className="zim-subnav-bar" style={{ margin: '0.25rem 0 0.5rem' }} role="tablist" aria-label="Sign in method">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'email'}
            className={`zim-subnav-pill ${mode === 'email' ? 'active' : ''}`}
            onClick={() => {
              setMode('email');
              setError('');
            }}
          >
            Email &amp; Password
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'pin'}
            className={`zim-subnav-pill ${mode === 'pin' ? 'active' : ''}`}
            onClick={() => {
              setMode('pin');
              setError('');
            }}
          >
            4-Digit Staff PIN
          </button>
        </div>

        {mode === 'email' ? (
          <>
            <label>
              Email
              <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label>
              Password
              <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="btn btn-primary" disabled={busy || !email || !password}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </>
        ) : (
          <>
            <label>
              4-Digit Staff Fast PIN (Storefloor &amp; Yard)
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                placeholder="••••"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                style={{ fontSize: '1.35rem', letterSpacing: '0.35em', textAlign: 'center', fontWeight: 700 }}
                required
              />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.4rem' }}>
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((key) => (
                <button
                  key={key}
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '0.55rem', fontSize: '1rem', fontWeight: 700 }}
                  onClick={() => {
                    if (key === 'C') setPin('');
                    else if (key === '⌫') setPin((p) => p.slice(0, -1));
                    else if (pin.length < 4) setPin((p) => p + key);
                  }}
                >
                  {key}
                </button>
              ))}
            </div>
            <p className="muted" style={{ fontSize: '0.76rem', margin: 0 }}>
              Demo PINs: <strong>1980</strong> (Owner) • <strong>2468</strong> (Storekeeper) • <strong>1357</strong> (Hardware Yard) • <strong>4321</strong> (Grocery Till)
            </p>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="btn btn-primary" disabled={busy || pin.length !== 4}>
              {busy ? 'Unlocking Counter…' : 'Unlock Storefloor with PIN'}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
