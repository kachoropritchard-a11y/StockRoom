import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useZim, type VernacularMode } from '../zimContext';
import { Spinner } from './Spinner';

interface ProfileModalProps {
  open: boolean;
  onClose: () => void;
  theme?: 'light' | 'dark';
  setTheme?: React.Dispatch<React.SetStateAction<'light' | 'dark'>>;
}

export function ProfileModal({ open, onClose, theme, setTheme }: ProfileModalProps) {
  const { user, updateCurrentUser, logout } = useAuth();
  const { vernacular, setVernacular, easyMode, setEasyMode, subLabel } = useZim();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Profile data
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [currentPin, setCurrentPin] = useState<string | null>(null);
  const [newPin, setNewPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [deptScope, setDeptScope] = useState('');

  // Password fields
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setSuccessMsg('');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setNewPin('');
    setShowPin(false);
    setLoading(true);

    api
      .profile()
      .then((p) => {
        setName(p.name);
        setEmail(p.email);
        setCurrentPin(p.pinCode);
        setOrgName(p.organisationName);
        setDeptScope(p.departmentScope);
      })
      .catch((err) => {
        setError((err as Error).message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [open]);

  if (!open) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (newPassword) {
      if (!currentPassword) {
        setError('Please enter your current password to verify this security change.');
        return;
      }
      if (newPassword.length < 8) {
        setError('New password must be at least 8 characters long.');
        return;
      }
      if (newPassword !== confirmPassword) {
        setError('New password and confirmation do not match.');
        return;
      }
    }

    if (newPin && !/^\d{4}$/.test(newPin.trim())) {
      setError('Staff PIN must be exactly 4 digits.');
      return;
    }

    setSaving(true);
    try {
      const res = await api.updateProfile({
        name: name.trim() !== user?.name ? name.trim() : undefined,
        email: email.trim().toLowerCase() !== user?.email ? email.trim().toLowerCase() : undefined,
        pinCode: newPin.trim() || undefined,
        currentPassword: newPassword ? currentPassword : undefined,
        newPassword: newPassword ? newPassword : undefined,
      });

      updateCurrentUser(res.user);
      if (res.pinCode) {
        setCurrentPin(res.pinCode);
        setNewPin('');
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSuccessMsg('Your profile and security credentials have been successfully updated!');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(17, 36, 33, 0.72)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '1rem',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div
        className="card animate-scale-up"
        style={{
          width: '100%',
          maxWidth: '560px',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: '1.75rem',
          borderRadius: '16px',
          boxShadow: '0 20px 40px rgba(0,0,0,0.25)',
          background: 'var(--surface)',
          border: '1.5px solid var(--line)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
          <div>
            <h2 id="profile-modal-title" style={{ margin: 0, fontSize: '1.35rem', color: 'var(--charcoal)' }}>
              My Profile &amp; Account Settings
            </h2>
            <span className="vernacular-sub" style={{ fontSize: '0.8rem', marginTop: '0.2rem' }}>
              {subLabel('Zvirongwa zveAkaunti Yenyu nePIN Rekupinda', 'Izilungiselelo Zomsebenzisi Lama-PIN')}
            </span>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            disabled={saving}
            aria-label="Close profile modal"
            style={{ fontSize: '1.2rem', padding: '0.2rem 0.5rem', lineHeight: 1, color: 'var(--charcoal)' }}
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center' }}>
            <Spinner label="Loading account details" />
            <p className="muted" style={{ marginTop: '0.75rem' }}>Loading account details…</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {error && (
              <div className="form-error" role="alert" style={{ margin: 0 }}>
                {error}
              </div>
            )}
            {successMsg && (
              <div className="form-success" role="status" style={{ margin: 0 }}>
                {successMsg}
              </div>
            )}

            {/* Account Overview Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '1rem',
                padding: '0.85rem 1rem',
                background: 'var(--surface-alt)',
                borderRadius: '12px',
                border: '1.5px solid var(--line)',
              }}
            >
              <div
                style={{
                  width: '46px',
                  height: '46px',
                  borderRadius: '50%',
                  background: 'var(--zim-green-700)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.25rem',
                  fontWeight: 800,
                  flexShrink: 0,
                }}
              >
                {name.slice(0, 1).toUpperCase() || 'U'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: '0.98rem', color: 'var(--charcoal)' }}>{name}</div>
                <div className="muted" style={{ fontSize: '0.78rem' }}>
                  {orgName} · {deptScope || 'All Departments'}
                </div>
              </div>
              <span
                className={`status-pill ${user?.role === 'executive_manager' ? 'optimal' : 'low'}`}
                style={{ textTransform: 'capitalize' }}
              >
                {user?.role === 'executive_manager' ? 'Executive Manager' : 'Inventory Manager'}
              </span>
            </div>

            {/* SECTION 1: Personal Details */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <h4 style={{ margin: '0 0 0.25rem', fontSize: '0.9rem', color: 'var(--zim-gold-500)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                1. Personal Details
              </h4>
              <label>
                Full Name
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="e.g. Tendai Moyo"
                />
              </label>
              <label>
                Email Address (Login Username)
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="e.g. tendai@business.co.zw"
                />
              </label>
            </div>

            {/* SECTION 2: Fast 4-Digit PIN */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
                padding: '1rem',
                borderRadius: '10px',
                background: 'var(--surface-alt)',
                border: '1.5px solid var(--zim-gold-500)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--zim-gold-500)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    2. Fast 4-Digit Sign-in PIN
                  </h4>
                  <span className="muted" style={{ fontSize: '0.74rem' }}>
                    Used for 1-tap PIN login at store counters and floor POS registers
                  </span>
                </div>
                {currentPin && (
                  <button
                    type="button"
                    onClick={() => setShowPin((s) => !s)}
                    style={{
                      border: 'none',
                      background: 'none',
                      cursor: 'pointer',
                      fontSize: '0.78rem',
                      color: 'var(--zim-gold-500)',
                      fontWeight: 700,
                      textDecoration: 'underline',
                    }}
                  >
                    {showPin ? `Current: ${currentPin}` : 'Show Current PIN'}
                  </button>
                )}
              </div>

              <label style={{ margin: 0, color: 'var(--charcoal)' }}>
                Set New 4-Digit PIN
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  pattern="\d{4}"
                  placeholder={currentPin ? 'Enter 4 digits to change PIN…' : 'Enter 4 digits e.g. 1234'}
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  style={{ letterSpacing: '0.25em', fontSize: '1.05rem', fontWeight: 700, background: 'var(--surface)', color: 'var(--charcoal)' }}
                />
              </label>
            </div>

            {/* SECTION 3: Password Update */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div>
                <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--zim-gold-500)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  3. Change Web Password
                </h4>
                <span className="muted" style={{ fontSize: '0.74rem' }}>
                  Leave blank if you do not wish to change your password
                </span>
              </div>

              <label>
                Current Password
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Required only when changing password"
                />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <label>
                  New Password
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Min. 8 characters"
                  />
                </label>
                <label>
                  Confirm New Password
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-type new password"
                  />
                </label>
              </div>
            </div>

            {/* SECTION 4: Preferences & Display */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <h4 style={{ margin: '0 0 0.25rem', fontSize: '0.9rem', color: 'var(--zim-gold-500)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                4. Display &amp; Regional Preferences
              </h4>

              <label>
                Vernacular Subtitles
                <select
                  value={vernacular}
                  onChange={(e) => setVernacular(e.target.value as VernacularMode)}
                >
                  <option value="bilingual">EN + Shona / Ndebele</option>
                  <option value="shona">ChiShona Subtitles</option>
                  <option value="ndebele">IsiNdebele Subtitles</option>
                  <option value="english">English Only</option>
                </select>
              </label>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderTop: '1px solid var(--line)' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>Visual Easy Mode</div>
                  <span className="muted" style={{ fontSize: '0.75rem' }}>Large steppers &amp; visual helpers</span>
                </div>
                <button
                  type="button"
                  className={`btn btn-sm ${easyMode ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setEasyMode(!easyMode)}
                >
                  {easyMode ? 'ON' : 'OFF'}
                </button>
              </div>

              {theme && setTheme && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderTop: '1px solid var(--line)' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>Appearance Theme</div>
                    <span className="muted" style={{ fontSize: '0.75rem' }}>{theme === 'dark' ? 'Dark theme active' : 'Light theme active'}</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline"
                    onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
                  >
                    {theme === 'dark' ? '🌙 Dark' : '☀️ Light'}
                  </button>
                </div>
              )}
            </div>

            {/* Modal Actions */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '0.75rem',
                marginTop: '0.5rem',
                paddingTop: '1rem',
                borderTop: '1px solid var(--line)',
              }}
            >
              <button
                type="button"
                className="btn btn-outline btn-sm"
                style={{ color: '#dc2626', borderColor: '#fca5a5' }}
                onClick={async () => {
                  await logout();
                  onClose();
                  navigate('/login', { replace: true });
                }}
                disabled={saving}
              >
                Sign out
              </button>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>
                  Close
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Saving Changes…' : '✓ Save Profile Changes'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
