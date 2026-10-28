import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type GranularPermissionItem, type User } from '../api';
import { useAuth } from '../auth';
import { AccessibleTabs, type TabDefinition } from '../components/AccessibleTabs';
import { Spinner } from '../components/Spinner';
import { useZim } from '../zimContext';

type UsersSubTab = 'pins' | 'permissions';

interface FastPinStaffMember {
  id: string;
  name: string;
  station: string;
  fastPin: string;
  phone: string;
  hideCostPrices: boolean;
  restrictWriteOffs: boolean;
  active: boolean;
}

export function Users() {
  const { user: currentUser } = useAuth();
  const { subLabel } = useZim();
  const isExec = currentUser?.role === 'executive_manager';

  const [activeTab, setActiveTab] = useState<UsersSubTab>('pins');
  const [pinStaff, setPinStaff] = useState<FastPinStaffMember[]>([]);
  const [users, setUsers] = useState<
    { id: number; email: string; name: string; role: User['role']; branchId: number | null; branchName: string | null; active: boolean; lockedUntil: string | null }[]
  >([]);
  const [branches, setBranches] = useState<{ id: number; name: string }[]>([]);
  const [permissions, setPermissions] = useState<GranularPermissionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  // Fast PIN creation form (for staff without emails)
  const [staffName, setStaffName] = useState('');
  const [staffStation, setStaffStation] = useState('Storefloor Runner / Till');
  const [staffPin, setStaffPin] = useState('4410');
  const [staffPhone, setStaffPhone] = useState('');

  // Full web account creation form (Executive only)
  const [uEmail, setUEmail] = useState('');
  const [uName, setUName] = useState('');
  const [uPassword, setUPassword] = useState('');
  const [uRole, setURole] = useState<User['role']>('inventory_manager');
  const [uBranchId, setUBranchId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [bRes, smeRes] = await Promise.all([
        api.branches().catch(() => []),
        api.smeOverview().catch(() => null),
      ]);
      setBranches(bRes);
      if (bRes[0]) setUBranchId((prev) => prev || String(bRes[0].id));
      if (smeRes) {
        setPinStaff(
          (smeRes.staffPins || []).map((p) => ({
            id: String(p.id),
            name: p.staffName,
            station: `${p.roleTitle} (${p.departmentScope})`,
            fastPin: p.pinCode,
            phone: p.departmentScope,
            hideCostPrices: !p.canViewCost,
            restrictWriteOffs: !p.canWriteOff,
            active: p.active,
          })),
        );
      }

      if (isExec) {
        const [uRes, pRes] = await Promise.all([api.users(), api.permissions()]);
        setUsers(uRes);
        setPermissions(pRes.permissions);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [isExec]);

  useEffect(() => {
    load();
  }, [load]);

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

  async function handleCreateWebUser(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMsg('');
    try {
      await api.createUser({
        email: uEmail,
        name: uName,
        password: uPassword,
        role: uRole,
        branchId: uBranchId ? Number(uBranchId) : null,
      });
      setUEmail('');
      setUName('');
      setUPassword('');
      setMsg('Full web user account created.');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const tabs: TabDefinition<UsersSubTab>[] = [
    {
      key: 'pins',
      label: '1. Staff 4-Digit Fast PIN Directory',
      badge: pinStaff.length + users.length,
      purpose: 'Register 4-digit Fast PINs for shopfloor runners, till operators, and yard staff who do not have email addresses.',
    },
    {
      key: 'permissions',
      label: '2. Role Permissions & Anti-Fraud Locks',
      badge: permissions.length || 4,
      purpose: 'Hide wholesale cost prices from counter staff, lock unauthorized stock write-offs, and enforce separation of duties.',
    },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Users, 4-Digit Fast PINs &amp; Anti-Fraud Locks</h1>
          <span className="vernacular-sub">
            {subLabel(
              'Vashandi veChitoro (4-Digit Fast PIN Pasina Email) & Mitemo Yekudzivirira Kubiridzira',
              'Izisebenzi Zesitolo (4-Digit PIN) &emithetho Yokuvikela Ukwebiwa Kwempahla',
            )}
          </span>
        </div>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      {msg && <p className="form-success" role="status">{msg}</p>}

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

          {/* SUB-MENU 1: Staff 4-Digit Fast PIN Directory */}
          {activeTab === 'pins' && (
            <div id="users-panel-pins" role="tabpanel" aria-labelledby="users-tab-pins">
              <div className="section-head">
                <div>
                  <h2>Storefloor 4-Digit Fast PIN Directory (No Email Required)</h2>
                  <p className="muted" style={{ margin: 0, fontSize: '0.84rem' }}>
                    Ideal for tuckshop cashiers, hardware yard loaders, and butchery blockmen who share a store tablet or terminal.
                  </p>
                </div>
              </div>

              <form
                className="form-grid subcard"
                style={{ marginBottom: '1.25rem' }}
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!staffName.trim()) return;
                  const cleanPin = staffPin.trim().slice(0, 4).padStart(4, '0');
                  await api
                    .createStaffPin({
                      staffName: staffName.trim(),
                      roleTitle: staffStation,
                      pinCode: cleanPin,
                      departmentScope: staffPhone.trim() || 'Groceries & Hardware',
                      canViewCost: false,
                      canWriteOff: false,
                    })
                    .catch(() => null);
                  setStaffName('');
                  setStaffPhone('');
                  setMsg(`Issued 4-Digit Fast PIN (${cleanPin}) for ${staffName}. They can now sign in on the Login screen!`);
                  await load();
                }}
              >
                <label>
                  Staff Full Name
                  <input value={staffName} onChange={(e) => setStaffName(e.target.value)} placeholder="e.g. Tatenda Sibanda" required />
                </label>
                <label>
                  Store Station / Duty
                  <input value={staffStation} onChange={(e) => setStaffStation(e.target.value)} required />
                </label>
                <label>
                  4-Digit Fast PIN
                  <input
                    maxLength={4}
                    pattern="\d{4}"
                    value={staffPin}
                    onChange={(e) => setStaffPin(e.target.value)}
                    placeholder="4 digits e.g. 5521"
                    required
                  />
                </label>
                <label>
                  WhatsApp / Phone
                  <input value={staffPhone} onChange={(e) => setStaffPhone(e.target.value)} placeholder="+263 77..." />
                </label>
                <div className="form-actions">
                  <button type="submit" className="btn btn-primary">+ Issue 4-Digit PIN</button>
                </div>
              </form>

              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Staff Member</th>
                      <th>Assigned Station</th>
                      <th>4-Digit Fast PIN</th>
                      <th>Cost Price Visibility</th>
                      <th>Write-Off Lock</th>
                      <th>Status</th>
                      <th className="num">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pinStaff.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="muted text-center" style={{ padding: '2.5rem', color: 'var(--muted)' }}>
                          No staff PIN codes registered yet. Add storefloor till operators or runners using the form above.
                        </td>
                      </tr>
                    ) : (
                      pinStaff.map((s) => (
                        <tr key={s.id}>
                          <td>
                            <strong>{s.name}</strong>
                            <div className="muted" style={{ margin: 0, fontSize: '0.78rem' }}>{s.phone}</div>
                          </td>
                          <td>{s.station}</td>
                          <td>
                            <code style={{ fontSize: '0.96rem', fontWeight: 800, letterSpacing: '0.12em' }}>
                              PIN: {s.fastPin}
                            </code>
                          </td>
                          <td>
                            <span className={`status-pill ${s.hideCostPrices ? 'optimal' : 'low'}`}>
                              {s.hideCostPrices ? '🔒 Cost Prices Hidden' : '👁️ Can View Costs'}
                            </span>
                          </td>
                          <td>
                            <span className={`status-pill ${s.restrictWriteOffs ? 'optimal' : 'low'}`}>
                              {s.restrictWriteOffs ? '🔒 Write-Offs Locked' : 'Unlocked'}
                            </span>
                          </td>
                          <td>
                            <span className={`status-pill ${s.active ? 'optimal' : 'out'}`}>
                              {s.active ? 'Active' : 'Suspended'}
                            </span>
                          </td>
                          <td className="num">
                            <button
                              type="button"
                              className="btn btn-outline btn-sm"
                              onClick={async () => {
                                const nextHide = !s.hideCostPrices;
                                setPinStaff((prev) =>
                                  prev.map((x) => (x.id === s.id ? { ...x, hideCostPrices: nextHide } : x)),
                                );
                                if (typeof s.id === 'number') {
                                  try {
                                    await api.updateStaffPin(s.id, { canViewCost: !nextHide });
                                  } catch {
                                    /* keep optimistic update if offline */
                                  }
                                }
                              }}
                            >
                              {s.hideCostPrices ? 'Show Costs' : 'Hide Costs'}
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {isExec && (
                <div className="subcard" style={{ marginTop: '1.35rem' }}>
                  <h3>Executive &amp; Manager Login Accounts ({users.length})</h3>
                  <form className="form-grid" style={{ marginBottom: '1rem' }} onSubmit={handleCreateWebUser}>
                    <label>
                      Full Name
                      <input value={uName} onChange={(e) => setUName(e.target.value)} required />
                    </label>
                    <label>
                      Email Address
                      <input type="email" value={uEmail} onChange={(e) => setUEmail(e.target.value)} required />
                    </label>
                    <label>
                      Password
                      <input type="password" value={uPassword} onChange={(e) => setUPassword(e.target.value)} required />
                    </label>
                    <label>
                      Role
                      <select value={uRole} onChange={(e) => setURole(e.target.value as User['role'])}>
                        <option value="inventory_manager">Inventory Manager</option>
                        <option value="executive_manager">Executive Manager</option>
                      </select>
                    </label>
                    <label>
                      Branch Scope
                      <select value={uBranchId} onChange={(e) => setUBranchId(e.target.value)}>
                        <option value="">All Branches</option>
                        {branches.map((b) => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </select>
                    </label>
                    <div className="form-actions">
                      <button type="submit" className="btn btn-primary">+ Create Web Account</button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          )}

          {/* SUB-MENU 2: Role Permissions & Anti-Fraud Locks */}
          {activeTab === 'permissions' && (
            <div id="users-panel-permissions" role="tabpanel" aria-labelledby="users-tab-permissions">
              <div className="section-head">
                <div>
                  <h2>Role Permissions &amp; Storefloor Anti-Fraud Locks</h2>
                  <span className="vernacular-sub">
                    {subLabel(
                      'Kuviga Mitengo yeWholesale & Kudzivirira Kunyora Zvinhu Zvakafa Pasina Mvumo',
                      'Ukufihla Intengo YeWholesale & Ukuvimba Ukusulwa Kwempahla',
                    )}
                  </span>
                </div>
              </div>

              <div className="dashboard-panels">
                <div className="subcard">
                  <h3>Server-Enforced Role Permission Matrix</h3>
                  {permissions.length > 0 ? (
                    <div className="table-wrap">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Permission Control</th>
                            <th>Status</th>
                            <th className="num">Toggle</th>
                          </tr>
                        </thead>
                        <tbody>
                          {permissions.map((p) => (
                            <tr key={p.key}>
                              <td>
                                <strong>{p.label}</strong>
                                <div className="muted" style={{ margin: 0, fontSize: '0.78rem' }}>{p.description}</div>
                              </td>
                              <td>
                                <span className={`status-pill ${p.allowed ? 'optimal' : 'out'}`}>
                                  {p.allowed ? 'Allowed' : 'Locked'}
                                </span>
                              </td>
                              <td className="num">
                                <button
                                  type="button"
                                  className="btn btn-outline btn-sm"
                                  onClick={() => handleTogglePermission(p.key, !p.allowed)}
                                >
                                  {p.allowed ? 'Lock' : 'Allow'}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="muted">
                      Granular role permissions are enforced by the server and configurable by an Executive Manager.
                    </p>
                  )}
                </div>

                <div className="subcard">
                  <h3>Active Anti-Fraud Safeguards</h3>
                  <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.88rem', lineHeight: 1.7 }}>
                    <li><strong>Wholesale Cost Shield:</strong> Counter PIN staff only see shelf quantities and retail prices.</li>
                    <li><strong>Mandatory Shrinkage Reason:</strong> No stock write-off can be posted without a reason code.</li>
                    <li><strong>Append-Only SQLite Triggers:</strong> Posted stock movements and audit logs cannot be edited or deleted.</li>
                    <li><strong>Separation of Duties:</strong> Creators cannot approve their own Purchase Orders or Requisitions.</li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </section>
      )}
    </>
  );
}
