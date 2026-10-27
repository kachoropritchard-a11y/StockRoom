import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  api,
  type AuditLogItem,
  type ExecutiveApprovals,
  type GranularPermissionItem,
  type OrganisationSettings,
  type SystemBackupItem,
  type SystemHealthStatus,
  type User,
} from '../api';
import { useAuth } from '../auth';
import { AccessibleTabs, type TabDefinition } from '../components/AccessibleTabs';
import { Spinner } from '../components/Spinner';

type OrgTab = 'approvals' | 'users' | 'structure' | 'audit' | 'health';

export function Organisation() {
  const { user: currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState<OrgTab>('approvals');
  const [org, setOrg] = useState<OrganisationSettings | null>(null);
  const [approvals, setApprovals] = useState<ExecutiveApprovals | null>(null);
  const [permissions, setPermissions] = useState<GranularPermissionItem[]>([]);
  const [branches, setBranches] = useState<{ id: number; name: string; city: string | null; active: number }[]>([]);
  const [warehouses, setWarehouses] = useState<{ id: number; branchId: number; branchName?: string; name: string; active: number }[]>([]);
  const [departments, setDepartments] = useState<{ id: number; branchId: number; branchName?: string; name: string; active: number }[]>([]);
  const [users, setUsers] = useState<
    { id: number; email: string; name: string; role: User['role']; branchId: number | null; branchName: string | null; active: boolean; lockedUntil: string | null }[]
  >([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditFilter, setAuditFilter] = useState('');
  const [health, setHealth] = useState<SystemHealthStatus | null>(null);
  const [backups, setBackups] = useState<SystemBackupItem[]>([]);
  const [backupLabel, setBackupLabel] = useState('');
  const [restoreTarget, setRestoreTarget] = useState<SystemBackupItem | null>(null);
  const [restorePhrase, setRestorePhrase] = useState('');
  const [decisionNote, setDecisionNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  // Organisation settings form
  const [orgName, setOrgName] = useState('');
  const [orgCurrency, setOrgCurrency] = useState('USD');
  const [poThreshold, setPoThreshold] = useState('0');

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
      const [oRes, appRes, permRes, bRes, wRes, dRes, uRes, logRes, hRes, bkRes] = await Promise.all([
        api.organisation(),
        api.approvals(),
        api.permissions(),
        api.branches(),
        api.warehouses(),
        api.departments(),
        api.users(),
        api.auditLogs({ action: auditFilter || undefined, limit: 100 }),
        api.systemHealth(),
        api.backups(),
      ]);
      setOrg(oRes);
      setOrgName(oRes.name);
      setOrgCurrency(oRes.currencyCode || 'USD');
      setPoThreshold(String(oRes.poApprovalThreshold ?? 0));
      setApprovals(appRes);
      setPermissions(permRes.permissions);
      setBranches(bRes);
      setWarehouses(wRes);
      setDepartments(dRes);
      setUsers(uRes);
      setAuditLogs(logRes.items);
      setAuditTotal(logRes.total);
      setHealth(hRes);
      setBackups(bkRes.items);
      if (bRes[0]) {
        const defaultBr = String(bRes[0].id);
        setWhBranchId((prev) => prev || defaultBr);
        setDeptBranchId((prev) => prev || defaultBr);
        setUBranchId((prev) => prev || defaultBr);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [auditFilter]);

  useEffect(() => {
    load();
    const onSync = () => load();
    window.addEventListener('stockroom:sync', onSync);
    return () => window.removeEventListener('stockroom:sync', onSync);
  }, [load]);

  async function handleSaveOrgPolicy(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMsg('');
    try {
      await api.updateOrganisation({
        name: orgName.trim(),
        currencyCode: orgCurrency.trim().toUpperCase(),
        poApprovalThreshold: Number(poThreshold) || 0,
      });
      setMsg('Organisation settings and PO approval threshold saved.');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleToggleNegativeStock(allow: boolean) {
    setError('');
    setMsg('');
    try {
      await api.updateOrganisation({ allowNegativeStock: allow });
      setMsg(`Negative stock policy updated (${allow ? 'Allowed' : 'Strictly prevented'}).`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleToggleSeparationOfDuties(enforce: boolean) {
    setError('');
    setMsg('');
    try {
      await api.updateOrganisation({ enforceSeparationOfDuties: enforce });
      setMsg(`Separation of duties ${enforce ? 'enabled (creators cannot approve their own documents)' : 'disabled'}.`);
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
      setMsg(`Inventory Manager permission "${key}" ${allowed ? 'granted' : 'revoked'}.`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleApprovePO(id: number) {
    setError('');
    setMsg('');
    try {
      await api.approvePurchaseOrder(id, decisionNote.trim() || undefined);
      setMsg(`Purchase Order #${id} approved.`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleCancelPO(id: number) {
    setError('');
    setMsg('');
    try {
      await api.cancelPurchaseOrder(id, decisionNote.trim() || undefined);
      setMsg(`Purchase Order #${id} cancelled.`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleFulfillRequisition(id: number) {
    setError('');
    setMsg('');
    try {
      await api.fulfillRequisition(id, decisionNote.trim() || undefined);
      setMsg(`Requisition #${id} fulfilled and posted to the stock ledger.`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleRejectRequisition(id: number) {
    setError('');
    setMsg('');
    try {
      await api.rejectRequisition(id, decisionNote.trim() || 'Rejected from Executive Approval Queue');
      setMsg(`Requisition #${id} rejected.`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleApproveCountSheet(id: number) {
    setError('');
    setMsg('');
    try {
      await api.approveCountSheet(id, decisionNote.trim() || undefined);
      setMsg(`Stocktake Sheet #${id} approved and variances posted to ledger.`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleCancelCountSheet(id: number) {
    setError('');
    setMsg('');
    try {
      await api.cancelCountSheet(id, decisionNote.trim() || undefined);
      setMsg(`Stocktake Sheet #${id} cancelled.`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleRunAudit() {
    setError('');
    try {
      const res = await api.verifyLedger();
      setActiveTab('health');
      setMsg(res.ok ? 'Ledger mathematical audit passed: 0 discrepancies found.' : `Ledger audit found ${res.problems.length} issue(s).`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleCreateBackup(e: FormEvent) {
    e.preventDefault();
    if (!backupLabel.trim()) return;
    setError('');
    setMsg('');
    try {
      const created = await api.createBackup(backupLabel.trim());
      setBackupLabel('');
      setMsg(`Verified backup snapshot #${created.id} (${created.label}) created. SHA-256: ${created.checksumSha256.slice(0, 16)}…`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleVerifyBackup(id: number) {
    setError('');
    setMsg('');
    try {
      const v = await api.verifyBackup(id);
      setMsg(
        v.readyForRestore
          ? `Backup #${id} (${v.label}) verified: SHA-256 checksum matches (${v.computedChecksum.slice(0, 16)}…) and ledger is healthy.`
          : `Backup #${id} verification warning: checksumMatch=${v.checksumMatch}, ledgerOk=${v.ledgerOk}.`,
      );
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleRestoreBackup(e: FormEvent) {
    e.preventDefault();
    if (!restoreTarget) return;
    setError('');
    setMsg('');
    try {
      const res = await api.restoreBackup(restoreTarget.id, restorePhrase);
      setRestoreTarget(null);
      setRestorePhrase('');
      setMsg(`Controlled restoration complete from Backup #${res.backupId} (${res.label}).`);
      await load();
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

  async function handleUnlockUser(id: number) {
    setError('');
    try {
      await api.updateUser(id, { unlock: true });
      setMsg(`User #${id} unlocked.`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleChangeUserRole(id: number, role: User['role']) {
    setError('');
    try {
      await api.updateUser(id, { role });
      setMsg(`User #${id} role updated to ${role === 'executive_manager' ? 'Executive Manager' : 'Inventory Manager'}.`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const tabs: TabDefinition<OrgTab>[] = [
    {
      key: 'approvals',
      label: '1. Approval Queues',
      badge: approvals?.totalPending ?? 0,
      purpose: 'Review and authorise draft Purchase Orders, pending Department Requisitions, and physical Stocktake Variance Sheets with separation-of-duties controls.',
    },
    {
      key: 'users',
      label: '2. Users, Roles & Permissions',
      badge: users.length,
      purpose: 'Manage staff accounts, unlock locked users, assign roles/branches, and configure the Inventory Manager permission matrix.',
    },
    {
      key: 'structure',
      label: '3. Org, Branch & Dept Settings',
      badge: branches.length + warehouses.length + departments.length,
      purpose: 'Configure organisation governance policies (separation of duties, PO thresholds, negative stock) and manage branches, warehouses, and departments.',
    },
    {
      key: 'audit',
      label: '4. Immutable Audit Logs',
      badge: auditTotal,
      purpose: 'Inspect the append-only, trigger-protected audit trail of administrative changes, approvals, reversals, backups, and report exports.',
    },
    {
      key: 'health',
      label: '5. System Health & Backups',
      badge: backups.length,
      purpose: 'Monitor live database and ledger integrity diagnostics, create SHA-256 verified snapshots, and execute controlled system restorations.',
    },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Executive Governance, Approvals &amp; System Control</h1>
          <p className="muted">
            Enforce separation of duties, manage users and role permissions, review approval queues, inspect audit logs, and manage verified recovery backups.
          </p>
        </div>
        <div className="action-row">
          <button className="btn btn-outline" type="button" onClick={load}>
            ↻ Refresh
          </button>
          <button className="btn btn-primary" type="button" onClick={handleRunAudit}>
            ✓ Verify Ledger Integrity
          </button>
        </div>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      {msg && <p className="form-success" role="status">{msg}</p>}

      {loading && !org ? (
        <Spinner label="Loading executive governance portal" />
      ) : (
        <section className="card">
          <AccessibleTabs
            idPrefix="organisation"
            ariaLabel="Executive governance sections"
            tabs={tabs}
            active={activeTab}
            onChange={setActiveTab}
          />

          {/* TAB 1: APPROVAL QUEUES */}
          {activeTab === 'approvals' && (
            <div id="organisation-panel-approvals" role="tabpanel" aria-labelledby="organisation-tab-approvals">
              <div className="kpi-grid" style={{ marginBottom: '1rem' }}>
                <article className="kpi-card">
                  <span className="kpi-label">Draft Purchase Orders</span>
                  <strong className="kpi-value">{approvals?.draftPurchaseOrders.length ?? 0}</strong>
                  <span className="kpi-hint">Awaiting approval</span>
                </article>
                <article className="kpi-card">
                  <span className="kpi-label">Pending Requisitions</span>
                  <strong className="kpi-value">{approvals?.pendingRequisitions.length ?? 0}</strong>
                  <span className="kpi-hint">Dept issues &amp; transfers</span>
                </article>
                <article className="kpi-card">
                  <span className="kpi-label">Draft Stocktake Sheets</span>
                  <strong className="kpi-value">{approvals?.draftCountSheets.length ?? 0}</strong>
                  <span className="kpi-hint">Executive variance sign-off</span>
                </article>
                <article className="kpi-card">
                  <span className="kpi-label">Separation of Duties</span>
                  <strong className="kpi-value">{org?.enforceSeparationOfDuties ? 'ENFORCED' : 'STANDARD'}</strong>
                  <span className="kpi-hint">PO Threshold: ${org?.poApprovalThreshold.toFixed(2) ?? '0.00'}</span>
                </article>
              </div>

              <div className="subcard" style={{ marginBottom: '1rem' }}>
                <label>
                  <strong>Decision / Approval Reason (recorded on the document &amp; immutable audit log)</strong>
                  <input
                    value={decisionNote}
                    onChange={(e) => setDecisionNote(e.target.value)}
                    placeholder="Optional note or reason for approving, fulfilling, or rejecting items below…"
                  />
                </label>
              </div>

              <div className="subcard" style={{ marginBottom: '1rem' }}>
                <h3>Draft Purchase Orders ({approvals?.draftPurchaseOrders.length ?? 0})</h3>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>PO Ref</th>
                        <th>Supplier</th>
                        <th>Warehouse</th>
                        <th>Created By</th>
                        <th className="num">Lines</th>
                        <th className="num">Total Value</th>
                        <th className="num">Executive Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(approvals?.draftPurchaseOrders ?? []).map((po) => {
                        const selfBlocked = org?.enforceSeparationOfDuties && po.createdById === currentUser?.id;
                        return (
                          <tr key={po.id}>
                            <td><strong>{po.reference}</strong></td>
                            <td>{po.supplierName}</td>
                            <td>{po.warehouseName}</td>
                            <td>
                              {po.createdByName ?? `User #${po.createdById}`}
                              {selfBlocked && <span className="badge badge-warn" style={{ marginLeft: '.35rem' }}>Created by you</span>}
                            </td>
                            <td className="num">{po.lineCount}</td>
                            <td className="num"><strong>${po.totalValue.toFixed(2)}</strong></td>
                            <td className="num">
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                disabled={!!selfBlocked}
                                title={selfBlocked ? 'Separation of duties prevents approving your own PO' : 'Approve Purchase Order'}
                                onClick={() => handleApprovePO(po.id)}
                              >
                                ✓ Approve
                              </button>{' '}
                              <button type="button" className="btn btn-outline btn-sm" onClick={() => handleCancelPO(po.id)}>
                                Cancel
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      {(approvals?.draftPurchaseOrders.length ?? 0) === 0 && (
                        <tr>
                          <td colSpan={7} className="muted">No draft Purchase Orders awaiting approval.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="subcard" style={{ marginBottom: '1rem' }}>
                <h3>Pending Department Requisitions &amp; Transfers ({approvals?.pendingRequisitions.length ?? 0})</h3>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Ref</th>
                        <th>Type</th>
                        <th>Source → Destination</th>
                        <th>Requested By</th>
                        <th className="num">Lines</th>
                        <th className="num">Executive Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(approvals?.pendingRequisitions ?? []).map((r) => {
                        const selfBlocked = org?.enforceSeparationOfDuties && r.createdById === currentUser?.id;
                        return (
                          <tr key={r.id}>
                            <td><strong>{r.reference ?? `REQ #${r.id}`}</strong></td>
                            <td>
                              <span className={`badge ${r.kind === 'department_issue' ? 'badge-issue' : 'badge-transfer'}`}>
                                {r.kind === 'department_issue' ? 'Dept Issue' : 'Transfer'}
                              </span>
                            </td>
                            <td>
                              {r.warehouseName} → {r.kind === 'department_issue' ? r.departmentName : r.toWarehouseName}
                            </td>
                            <td>{r.createdByName ?? `User #${r.createdById}`}</td>
                            <td className="num">{r.lineCount}</td>
                            <td className="num">
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                disabled={!!selfBlocked}
                                onClick={() => handleFulfillRequisition(r.id)}
                              >
                                ✓ Fulfill &amp; Post
                              </button>{' '}
                              <button type="button" className="btn btn-outline btn-sm" onClick={() => handleRejectRequisition(r.id)}>
                                Reject
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      {(approvals?.pendingRequisitions.length ?? 0) === 0 && (
                        <tr>
                          <td colSpan={6} className="muted">No pending requisitions awaiting fulfillment.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="subcard">
                <h3>Draft Physical Stocktake Sheets ({approvals?.draftCountSheets.length ?? 0})</h3>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Sheet Ref</th>
                        <th>Warehouse</th>
                        <th>Counted By</th>
                        <th className="num">Lines</th>
                        <th className="num">Variances</th>
                        <th className="num">Executive Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(approvals?.draftCountSheets ?? []).map((cs) => {
                        const selfBlocked = org?.enforceSeparationOfDuties && cs.createdById === currentUser?.id;
                        return (
                          <tr key={cs.id}>
                            <td><strong>{cs.reference ?? `COUNT #${cs.id}`}</strong></td>
                            <td>{cs.warehouseName}</td>
                            <td>{cs.createdByName ?? `User #${cs.createdById}`}</td>
                            <td className="num">{cs.lineCount}</td>
                            <td className="num">{cs.varianceCount}</td>
                            <td className="num">
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                disabled={!!selfBlocked}
                                onClick={() => handleApproveCountSheet(cs.id)}
                              >
                                ✓ Approve &amp; Reconcile
                              </button>{' '}
                              <button type="button" className="btn btn-outline btn-sm" onClick={() => handleCancelCountSheet(cs.id)}>
                                Cancel
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      {(approvals?.draftCountSheets.length ?? 0) === 0 && (
                        <tr>
                          <td colSpan={6} className="muted">No draft stocktake sheets awaiting reconciliation.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: USERS, ROLES & PERMISSIONS */}
          {activeTab === 'users' && (
            <div id="organisation-panel-users" role="tabpanel" aria-labelledby="organisation-tab-users">
              <div className="subcard" style={{ marginBottom: '1.25rem' }}>
                <h3>Role &amp; Permission Matrix (Inventory Manager Capabilities)</h3>
                <p className="muted" style={{ fontSize: '.86rem', marginBottom: '.75rem' }}>
                  Executive Managers hold full authority. Toggle which sensitive operations Inventory Managers are permitted to perform.
                </p>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Permission</th>
                        <th>Operational Scope</th>
                        <th>Inventory Manager Access</th>
                        <th className="num">Toggle</th>
                      </tr>
                    </thead>
                    <tbody>
                      {permissions.map((p) => (
                        <tr key={p.key}>
                          <td><strong>{p.label}</strong></td>
                          <td>{p.description}</td>
                          <td>
                            <span className={`status-pill ${p.allowed ? 'optimal' : 'out'}`}>
                              {p.allowed ? 'Permitted' : 'Restricted (Executive Only)'}
                            </span>
                          </td>
                          <td className="num">
                            <button
                              type="button"
                              className="btn btn-outline btn-sm"
                              onClick={() => handleTogglePermission(p.key, !p.allowed)}
                            >
                              {p.allowed ? 'Restrict to Executive' : 'Grant to Inventory Mgr'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="subcard" style={{ marginBottom: '1.25rem' }}>
                <h3>Create Staff User Account</h3>
                <form className="form-grid" onSubmit={handleCreateUser}>
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
              </div>

              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Branch Scope</th>
                      <th>Status</th>
                      <th className="num">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => {
                      const isLocked = !!u.lockedUntil && new Date(u.lockedUntil) > new Date();
                      return (
                        <tr key={u.id}>
                          <td><strong>{u.name}</strong></td>
                          <td>{u.email}</td>
                          <td>
                            {u.id === currentUser?.id ? (
                              <span>{u.role === 'executive_manager' ? 'Executive Manager' : 'Inventory Manager'}</span>
                            ) : (
                              <select
                                aria-label={`Role for ${u.name}`}
                                value={u.role}
                                onChange={(e) => handleChangeUserRole(u.id, e.target.value as User['role'])}
                              >
                                <option value="inventory_manager">Inventory Manager</option>
                                <option value="executive_manager">Executive Manager</option>
                              </select>
                            )}
                          </td>
                          <td>{u.branchName ?? 'All Branches'}</td>
                          <td>
                            <span className={`status-pill ${!u.active ? 'out' : isLocked ? 'low' : 'optimal'}`}>
                              {!u.active ? 'Disabled' : isLocked ? 'Locked' : 'Active'}
                            </span>
                          </td>
                          <td className="num">
                            {isLocked && (
                              <button className="btn btn-primary btn-sm" type="button" onClick={() => handleUnlockUser(u.id)}>
                                Unlock
                              </button>
                            )}{' '}
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
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: ORG, BRANCH & DEPT SETTINGS */}
          {activeTab === 'structure' && (
            <div id="organisation-panel-structure" role="tabpanel" aria-labelledby="organisation-tab-structure">
              <div className="dashboard-panels" style={{ marginBottom: '1.25rem' }}>
                <div className="subcard">
                  <h3>Organisation &amp; Governance Settings</h3>
                  <form className="form-grid" onSubmit={handleSaveOrgPolicy}>
                    <label>
                      Organisation Name
                      <input value={orgName} onChange={(e) => setOrgName(e.target.value)} required />
                    </label>
                    <label>
                      Base Currency Code
                      <input value={orgCurrency} onChange={(e) => setOrgCurrency(e.target.value)} maxLength={6} required />
                    </label>
                    <label>
                      Executive PO Approval Threshold ({orgCurrency})
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={poThreshold}
                        onChange={(e) => setPoThreshold(e.target.value)}
                      />
                    </label>
                    <div className="form-actions">
                      <button className="btn btn-primary" type="submit">Save Settings</button>
                    </div>
                  </form>
                </div>

                <div className="subcard">
                  <h3>Separation of Duties &amp; Stock Controls</h3>
                  <p>
                    <strong>Separation of Duties:</strong>{' '}
                    {org?.enforceSeparationOfDuties
                      ? 'Enforced (staff cannot approve POs, requisitions, or stocktakes they created)'
                      : 'Optional (single-manager approval allowed)'}
                  </p>
                  <button
                    className="btn btn-outline"
                    type="button"
                    onClick={() => handleToggleSeparationOfDuties(!org?.enforceSeparationOfDuties)}
                  >
                    {org?.enforceSeparationOfDuties ? 'Disable Separation of Duties' : 'Enforce Separation of Duties'}
                  </button>

                  <p style={{ marginTop: '1rem' }}>
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
                </div>
              </div>

              <div className="dashboard-panels">
                <div className="subcard">
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
                </div>

                <div>
                  <h3>Active Structure ({branches.length} Branches, {warehouses.length} Warehouses, {departments.length} Depts)</h3>
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
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: IMMUTABLE AUDIT LOGS */}
          {activeTab === 'audit' && (
            <div id="organisation-panel-audit" role="tabpanel" aria-labelledby="organisation-tab-audit">
              <div className="section-head" style={{ marginBottom: '.75rem' }}>
                <div>
                  <h3>Immutable Administrative &amp; Ledger Audit Trail ({auditTotal})</h3>
                  <p className="muted" style={{ margin: 0, fontSize: '.84rem' }}>
                    Protected by SQLite BEFORE UPDATE and BEFORE DELETE triggers.
                  </p>
                </div>
                <div className="inline-form">
                  <select
                    aria-label="Filter audit logs by action"
                    value={auditFilter}
                    onChange={(e) => setAuditFilter(e.target.value)}
                  >
                    <option value="">All Actions</option>
                    <option value="org.policy_update">Organisation Policy Updates</option>
                    <option value="role_permissions.update">Role Permission Changes</option>
                    <option value="user.create">User Created</option>
                    <option value="user.update">User Updated</option>
                    <option value="po.approve">PO Approved</option>
                    <option value="requisition.fulfill">Requisition Fulfilled</option>
                    <option value="count_sheet.approve">Stocktake Approved</option>
                    <option value="document.reverse">Ledger Reversals</option>
                    <option value="backup.create">Backup Created</option>
                    <option value="backup.restore">Backup Restored</option>
                    <option value="report.export">Report Exported</option>
                  </select>
                </div>
              </div>

              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Timestamp</th>
                      <th>Actor</th>
                      <th>Role</th>
                      <th>Action</th>
                      <th>Target</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map((log) => (
                      <tr key={log.id}>
                        <td><code>#{log.id}</code></td>
                        <td>{log.createdAt}</td>
                        <td><strong>{log.actorEmail}</strong></td>
                        <td>{log.actorRole}</td>
                        <td><span className="badge badge-info">{log.action}</span></td>
                        <td>{log.targetType}{log.targetId ? ` #${log.targetId}` : ''}</td>
                        <td>
                          <code style={{ fontSize: '.78rem' }}>
                            {log.details ? JSON.stringify(log.details) : '—'}
                          </code>
                        </td>
                      </tr>
                    ))}
                    {auditLogs.length === 0 && (
                      <tr>
                        <td colSpan={7} className="muted">No audit log entries match the selected filter.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 5: SYSTEM HEALTH & BACKUPS */}
          {activeTab === 'health' && (
            <div id="organisation-panel-health" role="tabpanel" aria-labelledby="organisation-tab-health">
              {health && (
                <div className="kpi-grid" style={{ marginBottom: '1rem' }}>
                  <article className="kpi-card">
                    <span className="kpi-label">System &amp; Ledger Status</span>
                    <strong className="kpi-value" style={{ color: health.ledgerIntegrity.ok ? 'var(--green)' : 'var(--danger)' }}>
                      {health.ledgerIntegrity.ok ? 'HEALTHY' : 'DEGRADED'}
                    </strong>
                    <span className="kpi-hint">{health.ledgerIntegrity.problems.length} ledger discrepancies</span>
                  </article>
                  <article className="kpi-card">
                    <span className="kpi-label">Active Sessions</span>
                    <strong className="kpi-value">{health.activeSessions}</strong>
                    <span className="kpi-hint">{health.lockedUsers} locked account(s)</span>
                  </article>
                  <article className="kpi-card">
                    <span className="kpi-label">Ledger Records</span>
                    <strong className="kpi-value">{health.tableCounts.stockMovements}</strong>
                    <span className="kpi-hint">{health.tableCounts.stockDocuments} documents · {health.tableCounts.auditLogs} audits</span>
                  </article>
                  <article className="kpi-card">
                    <span className="kpi-label">Recovery Snapshots</span>
                    <strong className="kpi-value">{health.tableCounts.backups}</strong>
                    <span className="kpi-hint">
                      {health.lastBackup ? `Last: ${health.lastBackup.label}` : 'No snapshot yet'}
                    </span>
                  </article>
                </div>
              )}

              <div className="dashboard-panels" style={{ marginBottom: '1.25rem' }}>
                <div className="subcard">
                  <h3>Create Verified System Snapshot</h3>
                  <p className="muted" style={{ fontSize: '.85rem' }}>
                    Captures organisation settings, role permissions, branches, warehouses, departments, products, and ledger balance checkpoints with a SHA-256 integrity hash.
                  </p>
                  <form className="inline-form" onSubmit={handleCreateBackup}>
                    <input
                      value={backupLabel}
                      onChange={(e) => setBackupLabel(e.target.value)}
                      placeholder="Snapshot label (e.g. Month-end close)"
                      required
                    />
                    <button className="btn btn-primary" type="submit">+ Create Snapshot</button>
                  </form>
                </div>

                <div className="subcard">
                  <h3>Mathematical Ledger Verification</h3>
                  <p className="muted" style={{ fontSize: '.85rem' }}>
                    Verifies every movement line against packaging conversions, zero-sum transfer pairs, reversal parity, and balance invariants.
                  </p>
                  <button className="btn btn-primary" type="button" onClick={handleRunAudit}>
                    ✓ Run Full Ledger Verification
                  </button>
                </div>
              </div>

              {restoreTarget && (
                <div className="subcard" style={{ marginBottom: '1.25rem', borderColor: 'var(--gold)' }}>
                  <h3>Controlled Restoration: Backup #{restoreTarget.id} ({restoreTarget.label})</h3>
                  <p className="muted" style={{ fontSize: '.86rem' }}>
                    Restores organisation policies, role permissions, structure, and product catalogue metadata from snapshot{' '}
                    <code>{restoreTarget.checksumSha256.slice(0, 16)}…</code> while preserving the immutable stock movement ledger.
                    Type <code>CONFIRM-RESTORE</code> to authorise.
                  </p>
                  <form className="inline-form" onSubmit={handleRestoreBackup}>
                    <input
                      value={restorePhrase}
                      onChange={(e) => setRestorePhrase(e.target.value)}
                      placeholder="Type CONFIRM-RESTORE"
                      aria-label="Confirmation phrase"
                      required
                    />
                    <button className="btn btn-primary" type="submit">Confirm &amp; Restore</button>
                    <button className="btn btn-outline" type="button" onClick={() => { setRestoreTarget(null); setRestorePhrase(''); }}>
                      Cancel
                    </button>
                  </form>
                </div>
              )}

              <div className="subcard">
                <h3>Backup History &amp; Recovery Status ({backups.length})</h3>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Label</th>
                        <th>SHA-256 Checksum</th>
                        <th className="num">Size</th>
                        <th>Status</th>
                        <th>Created At</th>
                        <th className="num">Recovery Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {backups.map((b) => (
                        <tr key={b.id}>
                          <td><code>#{b.id}</code></td>
                          <td><strong>{b.label}</strong></td>
                          <td><code>{b.checksumSha256.slice(0, 16)}…</code></td>
                          <td className="num">{(b.sizeBytes / 1024).toFixed(1)} KB</td>
                          <td>
                            <span className="status-pill optimal">
                              {b.status === 'restored' ? 'Restored' : 'Verified'}
                            </span>
                          </td>
                          <td>{b.createdAt}</td>
                          <td className="num">
                            <button
                              type="button"
                              className="btn btn-outline btn-sm"
                              onClick={() => handleVerifyBackup(b.id)}
                            >
                              ✓ Verify SHA-256
                            </button>{' '}
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={() => {
                                setRestoreTarget(b);
                                setRestorePhrase('');
                              }}
                            >
                              ↺ Restore
                            </button>
                          </td>
                        </tr>
                      ))}
                      {backups.length === 0 && (
                        <tr>
                          <td colSpan={7} className="muted">No system backups created yet. Use "Create Verified System Snapshot" above.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </section>
      )}
    </>
  );
}
