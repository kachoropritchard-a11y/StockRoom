import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type GranularPermissionItem, type User } from '../api';
import { useAuth } from '../auth';
import { AccessibleTabs, type TabDefinition } from '../components/AccessibleTabs';
import { Spinner } from '../components/Spinner';
import { useZim } from '../zimContext';

type UsersSubTab = 'users' | 'permissions';

interface UserAccount {
  id: number;
  email: string;
  name: string;
  role: User['role'];
  branchId: number | null;
  branchName: string | null;
  active: boolean;
  lockedUntil: string | null;
  pinCode?: string | null;
  departmentScope?: string | null;
  canViewCost?: boolean;
  canWriteOff?: boolean;
  createdAt?: string;
}

export function Users() {
  const { user: currentUser } = useAuth();
  const { subLabel } = useZim();
  const isExec = currentUser?.role === 'executive_manager';

  const [activeTab, setActiveTab] = useState<UsersSubTab>('users');
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);
  const [branches, setBranches] = useState<{ id: number; name: string }[]>([]);
  const [permissions, setPermissions] = useState<GranularPermissionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  // Show/hide add user form
  const [showAddForm, setShowAddForm] = useState(false);

  // Add User Form State
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formRole, setFormRole] = useState<User['role']>('inventory_manager');
  const [formPin, setFormPin] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formDept, setFormDept] = useState('');
  const [formHideCost, setFormHideCost] = useState(true);
  const [formRestrictWriteOff, setFormRestrictWriteOff] = useState(true);

  // Edit / Reset User Modal State
  const [editingUser, setEditingUser] = useState<UserAccount | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<User['role']>('inventory_manager');
  const [editPin, setEditPin] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editDept, setEditDept] = useState('');
  const [editHideCost, setEditHideCost] = useState(true);
  const [editRestrictWriteOff, setEditRestrictWriteOff] = useState(true);
  const [editActive, setEditActive] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [uRes, dRes, bRes, pRes] = await Promise.all([
        api.users().catch(() => []),
        api.departments().catch(() => []),
        api.branches().catch(() => []),
        api.permissions().catch(() => ({ permissions: [] })),
      ]);
      setUsers(uRes);
      setDepartments(dRes);
      setBranches(bRes);
      setPermissions(pRes.permissions);
      if (dRes[0] && !formDept) {
        setFormDept(dRes[0].name);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [formDept]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreateUser(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMsg('');

    if (!formName.trim() || !formEmail.trim() || !formPassword.trim()) {
      setError('Please fill in user name, email address, and initial password.');
      return;
    }

    if (formPassword.length < 8) {
      setError('Initial password must be at least 8 characters.');
      return;
    }

    if (formPin.trim() && !/^\d{4}$/.test(formPin.trim())) {
      setError('Staff 4-Digit Fast PIN must be exactly 4 numbers.');
      return;
    }

    setSaving(true);
    try {
      await api.createUser({
        name: formName.trim(),
        email: formEmail.trim().toLowerCase(),
        password: formPassword,
        role: formRole,
        pinCode: formPin.trim() || undefined,
        departmentScope: formDept.trim() || 'All Departments',
        canViewCost: !formHideCost,
        canWriteOff: !formRestrictWriteOff,
      });

      setFormName('');
      setFormEmail('');
      setFormPin('');
      setFormPassword('');
      setShowAddForm(false);
      setMsg(`User "${formName.trim()}" created successfully! They can log in with their email/password or 4-digit PIN.`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function openEditModal(u: UserAccount) {
    setEditingUser(u);
    setEditName(u.name);
    setEditRole(u.role);
    setEditPin(u.pinCode || '');
    setEditPassword('');
    setEditDept(u.departmentScope || (departments[0]?.name ?? 'All Departments'));
    setEditHideCost(!u.canViewCost);
    setEditRestrictWriteOff(!u.canWriteOff);
    setEditActive(u.active);
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editingUser) return;
    setError('');
    setMsg('');

    if (editPin.trim() && !/^\d{4}$/.test(editPin.trim())) {
      setError('Staff PIN must be exactly 4 digits.');
      return;
    }

    if (editPassword && editPassword.length < 8) {
      setError('New password must be at least 8 characters long.');
      return;
    }

    setSaving(true);
    try {
      await api.updateUser(editingUser.id, {
        name: editName.trim() !== editingUser.name ? editName.trim() : undefined,
        role: editRole !== editingUser.role ? editRole : undefined,
        active: editActive !== editingUser.active ? editActive : undefined,
        password: editPassword.trim() || undefined,
        pinCode: editPin.trim() || undefined,
        departmentScope: editDept.trim() || undefined,
        canViewCost: !editHideCost,
        canWriteOff: !editRestrictWriteOff,
      });

      setEditingUser(null);
      setMsg(`Account settings for "${editName}" updated successfully.`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(u: UserAccount) {
    if (u.id === currentUser?.id) {
      setError('You cannot deactivate your own logged-in account.');
      return;
    }
    const nextState = !u.active;
    setError('');
    setMsg('');
    try {
      await api.updateUser(u.id, { active: nextState });
      setMsg(`User "${u.name}" has been ${nextState ? 'activated' : 'suspended'}.`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDeleteUser(u: UserAccount) {
    if (u.id === currentUser?.id) {
      setError('You cannot delete your own logged-in account.');
      return;
    }
    if (!window.confirm(`Are you sure you want to permanently delete user account "${u.name}" (${u.email})?`)) {
      return;
    }
    setError('');
    setMsg('');
    try {
      await api.deleteUser(u.id);
      setMsg(`User "${u.name}" was permanently removed.`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleTogglePermission(key: GranularPermissionItem['key'], allowed: boolean) {
    setError('');
    setMsg('');
    try {
      await api.updatePermissions({ [key]: allowed });
      setMsg(`Permission "${key}" ${allowed ? 'granted' : 'locked'}.`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const tabs: TabDefinition<UsersSubTab>[] = [
    {
      key: 'users',
      label: '1. User Accounts & Staff Directory',
      badge: users.length,
      purpose: 'Manage staff accounts, assign roles, configure 4-digit Fast PINs, and set anti-fraud cost locks.',
    },
    {
      key: 'permissions',
      label: '2. Role Permissions & Anti-Fraud Locks',
      badge: permissions.length || 4,
      purpose: 'Server-enforced anti-fraud locks: hide wholesale costs, restrict write-offs, and enforce separation of duties.',
    },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>User Accounts &amp; Staff Management</h1>
          <span className="vernacular-sub">
            {subLabel(
              'Kugadzirisa Vashandi veChitoro, maPIN Ekupinda & Mitemo yeKudzivirira Kubiridzira',
              'Izisebenzi Zesitolo, ama-PIN Okungena &emithetho Yokuvikela Impahla',
            )}
          </span>
        </div>
        <div className="quick-actions">
          {isExec && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowAddForm((s) => !s)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
            >
              {showAddForm ? '✕ Close Form' : '+ Add New User'}
            </button>
          )}
          <button type="button" className="btn btn-outline" onClick={load}>
            ↻ Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="form-error" role="alert" style={{ marginBottom: '1rem' }}>
          {error}
        </div>
      )}
      {msg && (
        <div className="form-success" role="status" style={{ marginBottom: '1rem' }}>
          {msg}
        </div>
      )}

      {loading ? (
        <Spinner label="Loading staff directory and permissions" />
      ) : (
        <section className="card">
          {/* TIER 3: Horizontal In-Page Sub-Menu Bar */}
          <AccessibleTabs
            idPrefix="users"
            ariaLabel="Users and permissions sub-menus"
            tabs={tabs}
            active={activeTab}
            onChange={setActiveTab}
          />

          {/* SUB-MENU 1: User Accounts & Staff Directory */}
          {activeTab === 'users' && (
            <div id="users-panel-users" role="tabpanel" aria-labelledby="users-tab-users">
              {/* Executive Add User Form (Card Drawer) */}
              {isExec && showAddForm && (
                <div
                  className="subcard animate-fade-in"
                  style={{
                    marginBottom: '1.75rem',
                    background: 'var(--surface)',
                    border: '1.5px solid var(--zim-green-700)',
                    borderRadius: '14px',
                    padding: '1.5rem',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.06)',
                  }}
                >
                  <div className="section-head" style={{ marginBottom: '1rem' }}>
                    <div>
                      <h3 style={{ margin: 0, color: 'var(--charcoal)' }}>Create New Staff / Manager Account</h3>
                      <span className="vernacular-sub" style={{ fontSize: '0.78rem' }}>
                        Set their details, system role, initial web password, and 4-digit Fast PIN for 1-tap counter sign-in.
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setShowAddForm(false)}
                      style={{ fontSize: '1rem' }}
                    >
                      ✕
                    </button>
                  </div>

                  <form onSubmit={handleCreateUser} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
                      <label>
                        Full Name
                        <input
                          type="text"
                          value={formName}
                          onChange={(e) => setFormName(e.target.value)}
                          placeholder="e.g. Tendai Moyo"
                          required
                          autoFocus
                        />
                      </label>

                      <label>
                        Email Address (Username)
                        <input
                          type="email"
                          value={formEmail}
                          onChange={(e) => setFormEmail(e.target.value)}
                          placeholder="e.g. tendai@store.co.zw"
                          required
                        />
                      </label>

                      <label>
                        System Role
                        <select
                          value={formRole}
                          onChange={(e) => {
                            const newRole = e.target.value as User['role'];
                            setFormRole(newRole);
                            if (newRole === 'executive_manager') {
                              setFormHideCost(false);
                              setFormRestrictWriteOff(false);
                            } else {
                              setFormHideCost(true);
                              setFormRestrictWriteOff(true);
                            }
                          }}
                        >
                          <option value="inventory_manager">Inventory / Storefloor Manager (Standard)</option>
                          <option value="executive_manager">Executive Manager / Owner (Full Access)</option>
                        </select>
                      </label>

                      <label>
                        Assigned Department / Counter
                        <select value={formDept} onChange={(e) => setFormDept(e.target.value)}>
                          <option value="All Departments">All Departments</option>
                          {departments.map((d) => (
                            <option key={d.id} value={d.name}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label>
                        4-Digit Fast Sign-in PIN
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={4}
                          pattern="\d{4}"
                          value={formPin}
                          onChange={(e) => setFormPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                          placeholder="4 digits e.g. 1234"
                          style={{ letterSpacing: '0.2em', fontWeight: 700 }}
                          required
                        />
                        <span className="muted" style={{ fontSize: '0.72rem' }}>
                          Used for 1-tap PIN login on POS counters and floor tablets.
                        </span>
                      </label>

                      <label>
                        Initial Web Password
                        <input
                          type="password"
                          value={formPassword}
                          onChange={(e) => setFormPassword(e.target.value)}
                          placeholder="Min. 8 characters"
                          required
                        />
                        <span className="muted" style={{ fontSize: '0.72rem' }}>
                          Used for full email + password sign-in.
                        </span>
                      </label>
                    </div>

                    {/* Anti-fraud security locks */}
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '1.5rem',
                        padding: '0.85rem 1rem',
                        background: 'var(--zim-cream)',
                        borderRadius: '8px',
                        border: '1px solid var(--line)',
                      }}
                    >
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={formHideCost}
                          onChange={(e) => setFormHideCost(e.target.checked)}
                          disabled={formRole === 'executive_manager'}
                        />
                        <span style={{ fontSize: '0.84rem' }}>
                          <strong>🔒 Hide Wholesale Cost Prices</strong> (Staff only sees selling prices)
                        </span>
                      </label>

                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={formRestrictWriteOff}
                          onChange={(e) => setFormRestrictWriteOff(e.target.checked)}
                          disabled={formRole === 'executive_manager'}
                        />
                        <span style={{ fontSize: '0.84rem' }}>
                          <strong>🔒 Restrict Stock Write-Offs</strong> (Requires supervisor PIN/approval)
                        </span>
                      </label>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                      <button
                        type="button"
                        className="btn btn-outline"
                        onClick={() => setShowAddForm(false)}
                        disabled={saving}
                      >
                        Cancel
                      </button>
                      <button type="submit" className="btn btn-primary" disabled={saving}>
                        {saving ? 'Creating Account…' : '✓ Create User Account'}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Users Directory Table */}
              <div className="section-head" style={{ marginBottom: '0.75rem' }}>
                <div>
                  <h3 style={{ margin: 0 }}>Registered Staff &amp; Manager Accounts ({users.length})</h3>
                  <span className="vernacular-sub" style={{ fontSize: '0.78rem' }}>
                    Staff can log in with their email &amp; password or their 4-digit Fast PIN on the sign-in screen.
                  </span>
                </div>
              </div>

              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Staff Member</th>
                      <th>System Role</th>
                      <th>Assigned Station / Dept</th>
                      <th>4-Digit Fast PIN</th>
                      <th>Security Locks</th>
                      <th>Status</th>
                      {isExec && <th className="num">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {users.length === 0 ? (
                      <tr>
                        <td colSpan={isExec ? 7 : 6} className="muted text-center" style={{ padding: '2.5rem' }}>
                          No staff accounts registered yet. Click &quot;+ Add New User&quot; above to create accounts.
                        </td>
                      </tr>
                    ) : (
                      users.map((u) => {
                        const isSelf = u.id === currentUser?.id;
                        return (
                          <tr key={u.id}>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                                <div
                                  style={{
                                    width: '34px',
                                    height: '34px',
                                    borderRadius: '50%',
                                    background: u.role === 'executive_manager' ? 'var(--zim-gold-500)' : 'var(--zim-green-700)',
                                    color: '#fff',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontWeight: 800,
                                    fontSize: '0.9rem',
                                    flexShrink: 0,
                                  }}
                                >
                                  {u.name.slice(0, 1).toUpperCase()}
                                </div>
                                <div>
                                  <strong>
                                    {u.name} {isSelf && <span className="muted">(You)</span>}
                                  </strong>
                                  <div className="muted" style={{ margin: 0, fontSize: '0.78rem' }}>
                                    {u.email}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td>
                              <span
                                className={`status-pill ${u.role === 'executive_manager' ? 'optimal' : 'low'}`}
                                style={{ fontWeight: 600 }}
                              >
                                {u.role === 'executive_manager' ? 'Executive Manager' : 'Inventory Manager'}
                              </span>
                            </td>
                            <td>{u.departmentScope || 'All Departments'}</td>
                            <td>
                              {u.pinCode ? (
                                <code
                                  style={{
                                    fontSize: '0.92rem',
                                    fontWeight: 800,
                                    letterSpacing: '0.12em',
                                    padding: '0.2rem 0.5rem',
                                    borderRadius: '6px',
                                    background: 'rgba(217, 119, 6, 0.12)',
                                    color: 'var(--zim-gold-500)',
                                    border: '1px solid rgba(217, 119, 6, 0.35)',
                                  }}
                                >
                                  PIN: {u.pinCode}
                                </code>
                              ) : (
                                <span className="muted" style={{ fontSize: '0.8rem' }}>
                                  No PIN set
                                </span>
                              )}
                            </td>
                            <td>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.76rem' }}>
                                <span>{u.canViewCost ? '👁️ Can View Costs' : '🔒 Cost Prices Hidden'}</span>
                                <span>{u.canWriteOff ? '✓ Can Write Off' : '🔒 Write-Offs Locked'}</span>
                              </div>
                            </td>
                            <td>
                              <span className={`status-pill ${u.active ? 'optimal' : 'out'}`}>
                                {u.active ? 'Active' : 'Suspended'}
                              </span>
                            </td>
                            {isExec && (
                              <td className="num">
                                <div className="action-row" style={{ justifyContent: 'flex-end', gap: '0.4rem' }}>
                                  <button
                                    type="button"
                                    className="btn btn-outline btn-sm"
                                    onClick={() => openEditModal(u)}
                                    title="Edit user details, reset PIN or password"
                                  >
                                    ⚙️ Manage
                                  </button>
                                  {!isSelf && (
                                    <>
                                      <button
                                        type="button"
                                        className="btn btn-outline btn-sm"
                                        onClick={() => handleToggleActive(u)}
                                        title={u.active ? 'Suspend account' : 'Activate account'}
                                      >
                                        {u.active ? 'Suspend' : 'Activate'}
                                      </button>
                                      <button
                                        type="button"
                                        className="btn btn-outline btn-sm"
                                        style={{ color: 'var(--danger)', borderColor: 'var(--line)' }}
                                        onClick={() => handleDeleteUser(u)}
                                        title="Delete user account"
                                      >
                                        🗑
                                      </button>
                                    </>
                                  )}
                                </div>
                              </td>
                            )}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* SUB-MENU 2: Role Permissions & Anti-Fraud Locks */}
          {activeTab === 'permissions' && (
            <div id="users-panel-permissions" role="tabpanel" aria-labelledby="users-tab-permissions">
              <div className="section-head">
                <div>
                  <h2>Server-Enforced Role Permissions &amp; Anti-Fraud Controls</h2>
                  <span className="vernacular-sub">
                    {subLabel(
                      'Kuviga Mitengo yeWholesale & Kudzivirira Kunyora Zvinhu Zvakafa Pasina Mvumo',
                      'Ukufihla Intengo YeWholesale & Ukuvimba Ukusulwa Kwempahla',
                    )}
                  </span>
                </div>
              </div>

              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Permission Policy</th>
                      <th>Current Enforcement Status</th>
                      {isExec && <th className="num">Toggle Status</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {permissions.map((p) => (
                      <tr key={p.key}>
                        <td>
                          <strong>{p.label}</strong>
                          <div className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
                            {p.description}
                          </div>
                        </td>
                        <td>
                          <span className={`status-pill ${p.allowed ? 'optimal' : 'low'}`}>
                            {p.allowed ? '✓ Granted / Active' : '🔒 Locked / Restricted'}
                          </span>
                        </td>
                        {isExec && (
                          <td className="num">
                            <button
                              type="button"
                              className={`btn ${p.allowed ? 'btn-outline' : 'btn-primary'} btn-sm`}
                              onClick={() => handleTogglePermission(p.key, !p.allowed)}
                            >
                              {p.allowed ? 'Lock' : 'Grant'}
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Executive Edit / Reset User Modal */}
      {editingUser && (
        <div
          role="dialog"
          aria-modal="true"
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
            if (e.target === e.currentTarget && !saving) setEditingUser(null);
          }}
        >
          <div
            className="card animate-scale-up"
            style={{
              width: '100%',
              maxWidth: '520px',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '1.75rem',
              borderRadius: '16px',
              background: 'var(--surface)',
              border: '1.5px solid var(--line)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
              <div>
                <h3 style={{ margin: 0, color: 'var(--charcoal)' }}>Manage Account: {editingUser.name}</h3>
                <span className="muted" style={{ fontSize: '0.8rem' }}>{editingUser.email}</span>
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setEditingUser(null)}
                disabled={saving}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveEdit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <label>
                Full Name
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <label>
                  System Role
                  <select
                    value={editRole}
                    onChange={(e) => setEditRole(e.target.value as User['role'])}
                    disabled={editingUser.id === currentUser?.id}
                  >
                    <option value="inventory_manager">Inventory Manager</option>
                    <option value="executive_manager">Executive Manager</option>
                  </select>
                </label>

                <label>
                  Department / Counter
                  <select value={editDept} onChange={(e) => setEditDept(e.target.value)}>
                    <option value="All Departments">All Departments</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <label>
                  4-Digit Fast Sign-in PIN
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    pattern="\d{4}"
                    value={editPin}
                    onChange={(e) => setEditPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="e.g. 1234"
                    style={{ letterSpacing: '0.2em', fontWeight: 700 }}
                  />
                </label>

                <label>
                  Reset Password (Optional)
                  <input
                    type="password"
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                    placeholder="Leave blank to keep current"
                  />
                </label>
              </div>

              {/* Security locks */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.65rem',
                  padding: '0.85rem 1rem',
                  background: 'var(--zim-cream)',
                  borderRadius: '8px',
                  border: '1px solid var(--line)',
                }}
              >
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={editHideCost}
                    onChange={(e) => setEditHideCost(e.target.checked)}
                    disabled={editRole === 'executive_manager'}
                  />
                  <span style={{ fontSize: '0.82rem' }}>
                    <strong>🔒 Hide Wholesale Cost Prices</strong>
                  </span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={editRestrictWriteOff}
                    onChange={(e) => setEditRestrictWriteOff(e.target.checked)}
                    disabled={editRole === 'executive_manager'}
                  />
                  <span style={{ fontSize: '0.82rem' }}>
                    <strong>🔒 Restrict Stock Write-Offs &amp; Adjustments</strong>
                  </span>
                </label>

                {editingUser.id !== currentUser?.id && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={editActive}
                      onChange={(e) => setEditActive(e.target.checked)}
                    />
                    <span style={{ fontSize: '0.82rem' }}>
                      <strong>Active Account</strong> (Uncheck to suspend login)
                    </span>
                  </label>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setEditingUser(null)}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Saving…' : '✓ Save Account Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
