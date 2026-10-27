import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type User } from '../api';
import { useAuth } from '../auth';
import { Spinner } from '../components/Spinner';

export function Organisation() {
  const { user: currentUser } = useAuth();
  const [org, setOrg] = useState<{ id: number; name: string; allowNegativeStock: boolean } | null>(null);
  const [branches, setBranches] = useState<{ id: number; name: string; city: string | null; active: number }[]>([]);
  const [warehouses, setWarehouses] = useState<{ id: number; branchId: number; branchName?: string; name: string; active: number }[]>([]);
  const [departments, setDepartments] = useState<{ id: number; branchId: number; branchName?: string; name: string; active: number }[]>([]);
  const [users, setUsers] = useState<{ id: number; email: string; name: string; role: User['role']; branchId: number | null; branchName: string | null; active: boolean; lockedUntil: string | null }[]>([]);
  const [audit, setAudit] = useState<{ ok: boolean; problems: { check: string; detail: string }[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  // Structure forms
  const [branchName, setBranchName] = useState('');
  const [branchCity, setBranchCity] = useState('');
  const [whBranchId, setWhBranchId] = useState('');
  const [whName, setWhName] = useState('');
  const [deptBranchId, setDeptBranchId] = useState('');
  const [deptName, setDeptName] = useState('');

  // New user form
  const [uEmail, setUEmail] = useState('');
  const [uName, setUName] = useState('');
  const [uPassword, setUPassword] = useState('');
  const [uRole, setURole] = useState<User['role']>('inventory_manager');
  const [uBranchId, setUBranchId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [oRes, bRes, wRes, dRes, uRes] = await Promise.all([
        api.organisation(),
        api.branches(),
        api.warehouses(),
        api.departments(),
        api.users(),
      ]);
      setOrg(oRes);
      setBranches(bRes);
      setWarehouses(wRes);
      setDepartments(dRes);
      setUsers(uRes);
      if (!whBranchId && bRes[0]) setWhBranchId(String(bRes[0].id));
      if (!deptBranchId && bRes[0]) setDeptBranchId(String(bRes[0].id));
      if (!uBranchId && bRes[0]) setUBranchId(String(bRes[0].id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [whBranchId, deptBranchId, uBranchId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleToggleNegativeStock(allow: boolean) {
    setError('');
    setMsg('');
    try {
      await api.updateOrganisation({ allowNegativeStock: allow });
      setMsg(`Negative stock policy updated (${allow ? 'Allowed' : 'Blocked by default'}).`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleRunAudit() {
    setError('');
    try {
      const res = await api.verifyLedger();
      setAudit(res);
      setMsg(res.ok ? 'Ledger audit passed: 0 discrepancies found.' : `Ledger audit found ${res.problems.length} issue(s).`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleAddBranch(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.createBranch({ name: branchName, city: branchCity || undefined });
      setBranchName('');
      setBranchCity('');
      setMsg('Branch created.');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleAddWarehouse(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.createWarehouse({ branchId: Number(whBranchId), name: whName });
      setWhName('');
      setMsg('Warehouse created.');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleAddDepartment(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.createDepartment({ branchId: Number(deptBranchId), name: deptName });
      setDeptName('');
      setMsg('Department created.');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleCreateUser(e: FormEvent) {
    e.preventDefault();
    setError('');
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
      setMsg('User account created.');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleToggleUserActive(id: number, active: boolean) {
    setError('');
    try {
      await api.updateUser(id, { active });
      setMsg(`User #${id} ${active ? 'activated' : 'deactivated'}.`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Organisation, Structure &amp; Users</h1>
          <p className="muted">Configure branches, warehouses, departments, staff access and ledger governance.</p>
        </div>
        <div className="action-row">
          <button className="btn btn-primary" type="button" onClick={handleRunAudit}>
            ✓ Verify Ledger Integrity
          </button>
        </div>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      {msg && <p className="form-success" role="status">{msg}</p>}

      {audit && (
        <section className="card" style={{ marginBottom: '1.25rem' }}>
          <h2>Ledger Audit Result: {audit.ok ? 'PASS (All Invariants Verified)' : 'FAIL'}</h2>
          {audit.problems.length === 0 ? (
            <p className="muted" style={{ marginBottom: 0 }}>
              Verified sign rules, packaging unit conversions, zero-sum warehouse transfers, reversal parity, and non-negative balances.
            </p>
          ) : (
            <ul>
              {audit.problems.map((p, idx) => (
                <li key={idx}><strong>{p.check}:</strong> {p.detail}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {loading ? (
        <Spinner label="Loading organisation" />
      ) : (
        <>
          <div className="dashboard-panels">
            <section className="card">
              <h2>Organisation Policy</h2>
              <p><strong>Organisation:</strong> {org?.name}</p>
              <p>
                <strong>Negative Stock Protection:</strong>{' '}
                {org?.allowNegativeStock ? 'Negative balances permitted' : 'Strictly prevented (default)'}
              </p>
              <button
                className="btn btn-outline"
                type="button"
                onClick={() => handleToggleNegativeStock(!org?.allowNegativeStock)}
              >
                {org?.allowNegativeStock ? 'Enforce Non-Negative Stock' : 'Allow Negative Stock'}
              </button>

              <hr className="divider" />
              <h3>Add Branch</h3>
              <form className="inline-form" onSubmit={handleAddBranch}>
                <input value={branchName} onChange={(e) => setBranchName(e.target.value)} placeholder="Branch name (e.g. Mutare)" required />
                <input value={branchCity} onChange={(e) => setBranchCity(e.target.value)} placeholder="City" />
                <button className="btn btn-primary" type="submit">+ Branch</button>
              </form>

              <h3 style={{ marginTop: '1rem' }}>Add Warehouse</h3>
              <form className="inline-form" onSubmit={handleAddWarehouse}>
                <select value={whBranchId} onChange={(e) => setWhBranchId(e.target.value)} required>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
                <input value={whName} onChange={(e) => setWhName(e.target.value)} placeholder="Warehouse name" required />
                <button className="btn btn-primary" type="submit">+ Warehouse</button>
              </form>

              <h3 style={{ marginTop: '1rem' }}>Add Department</h3>
              <form className="inline-form" onSubmit={handleAddDepartment}>
                <select value={deptBranchId} onChange={(e) => setDeptBranchId(e.target.value)} required>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
                <input value={deptName} onChange={(e) => setDeptName(e.target.value)} placeholder="Department name" required />
                <button className="btn btn-primary" type="submit">+ Dept</button>
              </form>
            </section>

            <section className="card">
              <h2>Branches ({branches.length}), Warehouses ({warehouses.length}) &amp; Departments ({departments.length})</h2>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Name</th>
                      <th>Branch / City</th>
                    </tr>
                  </thead>
                  <tbody>
                    {branches.map((b) => (
                      <tr key={`b-${b.id}`}>
                        <td><span className="badge badge-receipt">Branch</span></td>
                        <td><strong>{b.name}</strong></td>
                        <td>{b.city ?? '—'}</td>
                      </tr>
                    ))}
                    {warehouses.map((w) => (
                      <tr key={`w-${w.id}`}>
                        <td><span className="badge badge-transfer">Warehouse</span></td>
                        <td><strong>{w.name}</strong></td>
                        <td>{w.branchName ?? `Branch #${w.branchId}`}</td>
                      </tr>
                    ))}
                    {departments.map((d) => (
                      <tr key={`d-${d.id}`}>
                        <td><span className="badge badge-count">Department</span></td>
                        <td><strong>{d.name}</strong></td>
                        <td>{d.branchName ?? `Branch #${d.branchId}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <section className="card" style={{ marginTop: '1.25rem' }}>
            <h2>User Management &amp; Role Access ({users.length})</h2>
            <form className="form-grid" onSubmit={handleCreateUser} style={{ marginBottom: '1.25rem' }}>
              <label>
                Full Name
                <input value={uName} onChange={(e) => setUName(e.target.value)} placeholder="e.g. Tendai Moyo" required />
              </label>
              <label>
                Email
                <input type="email" value={uEmail} onChange={(e) => setUEmail(e.target.value)} placeholder="tendai@example.com" required />
              </label>
              <label>
                Initial Password (min 10 chars)
                <input type="password" value={uPassword} onChange={(e) => setUPassword(e.target.value)} placeholder="At least 10 characters" required />
              </label>
              <label>
                Role
                <select value={uRole} onChange={(e) => setURole(e.target.value as User['role'])}>
                  <option value="inventory_manager">Inventory Manager</option>
                  <option value="executive_manager">Executive Manager</option>
                </select>
              </label>
              <label>
                Assigned Branch
                <select value={uBranchId} onChange={(e) => setUBranchId(e.target.value)}>
                  <option value="">All Branches (Organisation-wide)</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </label>
              <div className="form-actions">
                <button className="btn btn-primary" type="submit">+ Create User</button>
              </div>
            </form>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Branch Scope</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td><strong>{u.name}</strong></td>
                      <td>{u.email}</td>
                      <td>{u.role === 'executive_manager' ? 'Executive Manager' : 'Inventory Manager'}</td>
                      <td>{u.branchName ?? 'All Branches'}</td>
                      <td>
                        <span className={`badge badge-${u.active ? 'receipt' : 'write_off'}`}>
                          {u.active ? 'Active' : 'Disabled'}
                        </span>
                      </td>
                      <td>
                        {u.id !== currentUser?.id && (
                          <button
                            className="btn btn-outline btn-sm"
                            type="button"
                            onClick={() => handleToggleUserActive(u.id, !u.active)}
                          >
                            {u.active ? 'Deactivate' : 'Activate'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
