import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { ApiError } from '../api';
import { portalPath, useAuth } from '../auth';

const messages: Record<string, string> = {
  invalid_credentials: 'Incorrect email or password.',
  account_locked: 'Too many failed attempts. This account is locked for 15 minutes. Contact an administrator if you need help.',
  validation_error: 'Enter a valid email and password.',
  'Too Many Requests': 'Too many attempts. Please wait a minute and try again.',
};

export function Login() {
  const { user, loading, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to={portalPath(user.role)} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? messages[err.message] ?? (err.status === 0 ? err.message : 'Sign in failed.') : 'Sign in failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="card login-card" onSubmit={submit} noValidate>
        <div className="brand brand-dark">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">Stockroom</span>
        </div>
        <h1>Sign in</h1>
        <label>
          Email
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn btn-primary" disabled={busy || !email || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
