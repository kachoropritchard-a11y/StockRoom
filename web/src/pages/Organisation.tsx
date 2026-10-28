import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  api,
  type AuditLogItem,
  type ExecutiveApprovals,
  type GranularPermissionItem,
  type OrganisationSettings,
  type SystemBackupItem,
  type SystemHealthStatus,
} from '../api';
import { useAuth } from '../auth';
import { AccessibleTabs, type TabDefinition } from '../components/AccessibleTabs';
import { Spinner } from '../components/Spinner';
import { useZim, type VernacularMode } from '../zimContext';

import { SetupWizardModal } from '../components/SetupWizardModal';

type SettingsSubTab = 'rates' | 'fdms' | 'offline' | 'reset';

export function Organisation() {
  const navigate = useNavigate();
  const { user: currentUser, logout } = useAuth();
  const isExec = currentUser?.role === 'executive_manager';
  const {
    rates,
    updateRates,
    vernacular,
    setVernacular,
    easyMode,
    setEasyMode,
    zesaGridOnline,
    setZesaGridOnline,
    triggerOfflineSync,
    fdms,
    updateFdms,
    subLabel,
  } = useZim();

  const [activeTab, setActiveTab] = useState<SettingsSubTab>('rates');
  const [org, setOrg] = useState<OrganisationSettings | null>(null);
  const [approvals, setApprovals] = useState<ExecutiveApprovals | null>(null);
  const [permissions, setPermissions] = useState<GranularPermissionItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [health, setHealth] = useState<SystemHealthStatus | null>(null);
  const [backups, setBackups] = useState<SystemBackupItem[]>([]);
  const [backupLabel, setBackupLabel] = useState('');
  const [decisionNote, setDecisionNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  // Daily Exchange Rate inputs
  const [rateZig, setRateZig] = useState(String(rates.ZiG));
  const [rateZar, setRateZar] = useState(String(rates.ZAR));

  // Organisation settings form
  const [orgName, setOrgName] = useState('Great Zimbabwe Groceries Ltd');
  const [orgCurrency, setOrgCurrency] = useState('USD');
  const [poThreshold, setPoThreshold] = useState('500');

  // ZIMRA FDMS form
  const [tinInput, setTinInput] = useState(fdms.tinNumber);
  const [vatInput, setVatInput] = useState(fdms.vatNumber);
  const [devIdInput, setDevIdInput] = useState(fdms.deviceId);
  const [serialInput, setSerialInput] = useState(fdms.serialNo);
  const [vatPctInput, setVatPctInput] = useState(String(fdms.standardVatPct));

  const [wizardOpen, setWizardOpen] = useState(false);
  const [resetConfirm, setResetConfirm] = useState('');
  const [busyReset, setBusyReset] = useState(false);
  const [departmentsList, setDepartmentsList] = useState<{ id: number; name: string }[]>([]);
  const [selectedPosDeptId, setSelectedPosDeptId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [oRes, deptRes] = await Promise.all([
        api.organisation().catch(() => null),
        api.departments().catch(() => []),
      ]);
      if (oRes) {
        setOrg(oRes);
        setOrgName(oRes.name);
        setOrgCurrency(oRes.currencyCode || 'USD');
        setPoThreshold(String(oRes.poApprovalThreshold ?? 0));
        setSelectedPosDeptId(oRes.posDepartmentId ?? null);
      }
      setDepartmentsList(deptRes);
      if (isExec) {
        const [appRes, permRes, logRes, hRes, bkRes] = await Promise.all([
          api.approvals(),
          api.permissions(),
          api.auditLogs({ limit: 50 }),
          api.systemHealth(),
          api.backups(),
        ]);
        setApprovals(appRes);
        setPermissions(permRes.permissions);
        setAuditLogs(logRes.items);
        setHealth(hRes);
        setBackups(bkRes.items);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [isExec]);

  useEffect(() => {
    load();
    const onSync = () => load();
    window.addEventListener('stockroom:sync', onSync);
    return () => window.removeEventListener('stockroom:sync', onSync);
  }, [load]);

  function handleSaveRates(e: FormEvent) {
    e.preventDefault();
    const nextZig = Math.max(0.01, Number(rateZig) || 26.8);
    const nextZar = Math.max(0.01, Number(rateZar) || 18.2);
    updateRates({ ZiG: nextZig, ZAR: nextZar });
    setMsg(`Updated daily morning exchange rates: 1 USD = ${nextZig} ZiG | 1 USD = R ${nextZar}. All store prices updated.`);
  }

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

  const tabs: TabDefinition<SettingsSubTab>[] = [
    {
      key: 'rates',
      label: '1. Daily Exchange Rates (1 USD to ZiG & ZAR)',
      badge: approvals?.totalPending ? `${approvals.totalPending} Pending` : undefined,
      purpose: 'Set morning RBZ / market exchange rates (1 USD to ZiG & ZAR), review Executive Approval Queues, and configure org policy.',
    },
    {
      key: 'fdms',
      label: '2. ZIMRA FDMS Virtual Device Config',
       badge: permissions.length || undefined,
      purpose: 'Configure ZIMRA TIN, VAT Registration, Fiscal Device Serial, and inspect role permissions & immutable audit logs.',
    },
    {
      key: 'offline',
      label: '3. Offline Sync & Vernacular Preferences',
      badge: backups.length || undefined,
      purpose: 'Configure ChiShona / IsiNdebele subtitles, Visual Easy Mode, ZESA load-shedding offline resilience, and SHA-256 backups.',
    },
    {
      key: 'reset',
      label: '4. System Setup & Reset to Scratch',
      purpose: 'Initialize business profile with the Setup Wizard, bind POS department, or clear all data to test from scratch.',
    },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Executive Governance, Approvals &amp; System Control</h1>
          <span className="vernacular-sub">
            {subLabel(
              'Mitemo yeBhizinesi • Mitengo yeMari (USD/ZiG/ZAR) • ZIMRA FDMS & Kudzivirira ZESA Power Cut',
              'Izilungiselelo Zebhizimusi • Amanani Emali (USD/ZiG/ZAR) • ZIMRA FDMS',
            )}
          </span>
        </div>
        <div className="action-row">
          <button className="btn btn-outline" type="button" onClick={load}>
            ↻ Refresh
          </button>
        </div>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      {msg && <p className="form-success" role="status">{msg}</p>}

      {loading && !org && isExec ? (
        <Spinner label="Loading settings and executive governance portal" />
      ) : (
        <section className="card">
          {/* TIER 3: Horizontal In-Page Sub-Menu Bar */}
          <AccessibleTabs
            idPrefix="organisation"
            ariaLabel="Executive governance sections"
            tabs={tabs}
            active={activeTab}
            onChange={setActiveTab}
          />

          {/* SUB-MENU 1: Daily Exchange Rates (1 USD to ZiG & ZAR) + Executive Approvals Queue */}
          {activeTab === 'rates' && (
            <div id="organisation-panel-rates" role="tabpanel" aria-labelledby="organisation-tab-rates">
              <div className="dashboard-panels" style={{ marginBottom: '1.25rem' }}>
                <div className="subcard" style={{ borderLeft: '4px solid var(--zim-gold-500)' }}>
                  <h3>Morning Exchange Rate Board (1 USD to ZiG &amp; ZAR)</h3>
                  <p className="muted" style={{ fontSize: '0.84rem' }}>
                    Last updated: <strong>{rates.updatedAt}</strong>. Updating these rates immediately recalculates ZiG and Rand prices across the entire store.
                  </p>
                  <form className="form-grid" onSubmit={handleSaveRates}>
                    <label>
                      1 USD in Zimbabwe Gold (ZiG)
                      <input type="number" step="0.01" min="0.01" value={rateZig} onChange={(e) => setRateZig(e.target.value)} required />
                    </label>
                    <label>
                      1 USD in South African Rand (ZAR R)
                      <input type="number" step="0.01" min="0.01" value={rateZar} onChange={(e) => setRateZar(e.target.value)} required />
                    </label>
                    <div className="form-actions">
                      <button type="submit" className="btn btn-gold">✓ Broadcast Today&apos;s Rates</button>
                    </div>
                  </form>
                </div>

                {isExec && (
                  <div className="subcard">
                    <h3>Organisation Policy &amp; PO Approval Threshold</h3>
                    <form className="form-grid" onSubmit={handleSaveOrgPolicy}>
                      <label>
                        Organisation Name
                        <input value={orgName} onChange={(e) => setOrgName(e.target.value)} required />
                      </label>
                      <label>
                        PO Executive Threshold (USD $)
                        <input type="number" step="1" min="0" value={poThreshold} onChange={(e) => setPoThreshold(e.target.value)} required />
                      </label>
                      <div className="form-actions">
                        <button type="submit" className="btn btn-primary">Save Policy</button>
                      </div>
                    </form>
                  </div>
                )}
              </div>

              {/* Executive Approval Queue */}
              {isExec && approvals && (
                <div className="subcard">
                  <div className="section-head">
                    <h3>Executive Approval Queue ({approvals.totalPending} Pending)</h3>
                    <input
                      placeholder="Optional approval / rejection reason note…"
                      value={decisionNote}
                      onChange={(e) => setDecisionNote(e.target.value)}
                      style={{ minWidth: '280px' }}
                    />
                  </div>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>PO Reference</th>
                          <th>Supplier</th>
                          <th>Warehouse</th>
                          <th className="num">Value (USD)</th>
                          <th>Created By</th>
                          <th className="num">Decision</th>
                        </tr>
                      </thead>
                      <tbody>
                        {approvals.draftPurchaseOrders.map((po) => (
                          <tr key={po.id}>
                            <td><strong>{po.reference}</strong></td>
                            <td>{po.supplierName}</td>
                            <td>{po.warehouseName}</td>
                            <td className="num">${po.totalValue.toFixed(2)}</td>
                            <td>{po.createdByName ?? 'Staff'}</td>
                            <td className="num">
                              <button type="button" className="btn btn-primary btn-sm" onClick={() => handleApprovePO(po.id)}>
                                Approve PO
                              </button>
                            </td>
                          </tr>
                        ))}
                        {approvals.draftPurchaseOrders.length === 0 && (
                          <tr>
                            <td colSpan={6} className="muted">No draft Purchase Orders awaiting approval.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* SUB-MENU 2: ZIMRA FDMS Virtual Device Config + Role Permissions */}
          {activeTab === 'fdms' && (
            <div id="organisation-panel-fdms" role="tabpanel" aria-labelledby="organisation-tab-fdms">
              <div className="dashboard-panels" style={{ marginBottom: '1.25rem' }}>
                <div className="subcard">
                  <h3>ZIMRA FDMS Virtual Fiscal Device Configuration</h3>
                  <form
                    className="form-grid"
                    onSubmit={(e) => {
                      e.preventDefault();
                      updateFdms({
                        tinNumber: tinInput.trim(),
                        vatNumber: vatInput.trim(),
                        deviceId: devIdInput.trim(),
                        serialNo: serialInput.trim(),
                        standardVatPct: Number(vatPctInput) || 15,
                      });
                      setMsg('Saved ZIMRA FDMS Virtual Fiscal Device configuration.');
                    }}
                  >
                    <label>
                      ZIMRA Taxpayer TIN (10 Digits)
                      <input value={tinInput} onChange={(e) => setTinInput(e.target.value)} required />
                    </label>
                    <label>
                      VAT Registration Number
                      <input value={vatInput} onChange={(e) => setVatInput(e.target.value)} required />
                    </label>
                    <label>
                      FDMS Virtual Device ID
                      <input value={devIdInput} onChange={(e) => setDevIdInput(e.target.value)} required />
                    </label>
                    <label>
                      Device Serial Number
                      <input value={serialInput} onChange={(e) => setSerialInput(e.target.value)} required />
                    </label>
                    <label>
                      Standard VAT Rate (%)
                      <input type="number" step="0.5" value={vatPctInput} onChange={(e) => setVatPctInput(e.target.value)} required />
                    </label>
                    <div className="form-actions">
                      <button type="submit" className="btn btn-primary">Save ZIMRA FDMS Config</button>
                    </div>
                  </form>
                </div>

                <div className="subcard">
                  <h3>Granular Role Permissions Matrix</h3>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Permission</th>
                          <th>Status</th>
                          <th className="num">Action</th>
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
                                {p.allowed ? 'Allowed' : 'Restricted'}
                              </span>
                            </td>
                            <td className="num">
                              <button
                                type="button"
                                className="btn btn-outline btn-sm"
                                onClick={() => handleTogglePermission(p.key, !p.allowed)}
                              >
                                {p.allowed ? 'Restrict' : 'Allow'}
                              </button>
                            </td>
                          </tr>
                        ))}
                        {permissions.length === 0 && (
                          <tr>
                            <td colSpan={3} className="muted">Approve Purchase Orders &amp; Role Permissions configured by Executive Manager.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {isExec && auditLogs.length > 0 && (
                <div className="subcard">
                  <h3>Immutable Executive Audit Trail ({auditLogs.length})</h3>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Actor</th>
                          <th>Action</th>
                          <th>Target</th>
                          <th>Timestamp</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditLogs.slice(0, 8).map((log) => (
                          <tr key={log.id}>
                            <td><code>#{log.id}</code></td>
                            <td>{log.actorEmail}</td>
                            <td><strong>{log.action}</strong></td>
                            <td>{log.targetType} #{log.targetId ?? '—'}</td>
                            <td>{log.createdAt}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* SUB-MENU 3: Offline Sync & Vernacular Preferences + Verified Backups */}
          {activeTab === 'offline' && (
            <div id="organisation-panel-offline" role="tabpanel" aria-labelledby="organisation-tab-offline">
              <div className="dashboard-panels">
                <div className="subcard">
                  <h3>Vernacular Language &amp; Zero-Computer-Background Accessibility</h3>
                  <div className="form-grid">
                    <label>
                      Vernacular Subtitle Mode
                      <select value={vernacular} onChange={(e) => setVernacular(e.target.value as VernacularMode)}>
                        <option value="bilingual">English + ChiShona + IsiNdebele (Recommended)</option>
                        <option value="shona">English + ChiShona Only</option>
                        <option value="ndebele">English + IsiNdebele Only</option>
                        <option value="english">English Only</option>
                      </select>
                    </label>
                    <label className="checkbox-row">
                      <input type="checkbox" checked={easyMode} onChange={(e) => setEasyMode(e.target.checked)} />
                      Enable Visual Easy Mode (Oversized Touch Buttons &amp; Step Controls)
                    </label>
                  </div>
                </div>

                <div className="subcard">
                  <h3>ZESA Load-Shedding Resilience &amp; SHA-256 Backups</h3>
                  <p className="muted" style={{ fontSize: '0.84rem' }}>
                    Power Status: <strong>{zesaGridOnline ? 'Grid Online' : 'Solar Inverter / Battery Backup'}</strong> · Ledger Integrity:{' '}
                    <strong>{health?.ledgerIntegrity?.ok !== false ? 'Verified OK' : 'Check Needed'}</strong>
                  </p>
                  <div className="action-row" style={{ marginBottom: '0.85rem' }}>
                    <button type="button" className="btn btn-primary btn-sm" onClick={triggerOfflineSync}>
                      ↻ Force Offline Queue Sync
                    </button>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setZesaGridOnline(!zesaGridOnline)}>
                      Toggle ZESA / Solar Mode
                    </button>
                  </div>

                  {isExec && (
                    <form className="inline-form" onSubmit={handleCreateBackup}>
                      <input
                        value={backupLabel}
                        onChange={(e) => setBackupLabel(e.target.value)}
                        placeholder="Snapshot label (e.g. Pre-Month-End)"
                        required
                      />
                      <button type="submit" className="btn btn-gold btn-sm">+ Create SHA-256 Backup</button>
                    </form>
                  )}

                  {backups.length > 0 && (
                    <div className="table-wrap" style={{ marginTop: '0.75rem' }}>
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Backup</th>
                            <th>SHA-256 Checksum</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {backups.map((b) => (
                            <tr key={b.id}>
                              <td><strong>{b.label}</strong></td>
                              <td><code>{b.checksumSha256.slice(0, 16)}…</code></td>
                              <td><span className="status-pill optimal">{b.status}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* SUB-MENU 4: System Setup & Reset to Scratch */}
          {activeTab === 'reset' && (
            <div id="organisation-panel-reset" role="tabpanel" aria-labelledby="organisation-tab-reset">
              <div className="dashboard-panels">
                {/* Linked POS Department Control */}
                <div className="subcard" style={{ borderLeft: '4px solid var(--zim-green-700)' }}>
                  <h3>POS Department Binding (Executive Selection)</h3>
                  <p className="muted" style={{ fontSize: '0.84rem' }}>
                    Select which department the storefloor counter POS is assigned to. Counter staff opening the POS will automatically load items and issue fiscal receipts for this department.
                  </p>
                  <div className="form-grid">
                    <label>
                      Active POS Department
                      <select
                        value={selectedPosDeptId ?? ''}
                        onChange={async (e) => {
                          const val = e.target.value ? Number(e.target.value) : null;
                          setSelectedPosDeptId(val);
                          try {
                            await api.updateOrganisation({ posDepartmentId: val });
                            setMsg('✓ POS Counter linked to selected department.');
                            await load();
                          } catch (err) {
                            setError((err as Error).message);
                          }
                        }}
                      >
                        <option value="">-- All Departments (Storewide POS) --</option>
                        {departmentsList.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div style={{ marginTop: '0.75rem', fontSize: '0.82rem' }}>
                    Current Binding: <strong>{org?.posDepartmentName ?? 'All Departments'}</strong>
                  </div>
                </div>

                {/* System Initialization Wizard Trigger */}
                <div className="subcard" style={{ borderLeft: '4px solid var(--zim-gold-500)' }}>
                  <h3>System Initialization &amp; Setup Wizard</h3>
                  <p className="muted" style={{ fontSize: '0.84rem' }}>
                    Launch the guided step-by-step Setup Wizard to configure business name, branch locations, departments, and seed verified starter products.
                  </p>
                  <div style={{ marginTop: '1rem' }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => setWizardOpen(true)}
                      style={{ padding: '0.65rem 1.25rem', fontWeight: 700 }}
                    >
                      Launch StockRoom Setup Wizard →
                    </button>
                  </div>
                </div>

                {/* Danger Zone: Reset to Scratch */}
                {isExec && (
                  <div className="subcard" style={{ borderLeft: '4px solid var(--danger)', gridColumn: '1 / -1' }}>
                    <h3 style={{ color: 'var(--danger)' }}>Factory Reset: Clear All Information to Scratch</h3>
                    <p className="muted" style={{ fontSize: '0.84rem' }}>
                      Wipe all demo inventory items, orders, sales transactions, movements, debtors, and users so you can test the system completely from a clean scratch slate starting with manager creation.
                    </p>
                    <div style={{ maxWidth: '520px', marginTop: '0.75rem' }}>
                      <label style={{ fontSize: '0.82rem', display: 'block', marginBottom: '0.5rem' }}>
                        Type <code>RESET-SCRATCH</code> below to confirm wiping all data:
                        <input
                          type="text"
                          value={resetConfirm}
                          onChange={(e) => setResetConfirm(e.target.value)}
                          placeholder="RESET-SCRATCH"
                          style={{ marginTop: '0.25rem' }}
                        />
                      </label>
                      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.75rem' }}>
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={resetConfirm !== 'RESET-SCRATCH' || busyReset}
                          style={{
                            background: 'var(--danger)',
                            color: '#fff',
                            fontWeight: 700,
                            cursor: resetConfirm === 'RESET-SCRATCH' ? 'pointer' : 'not-allowed',
                            opacity: resetConfirm === 'RESET-SCRATCH' ? 1 : 0.5,
                          }}
                          onClick={async () => {
                            if (!window.confirm('Are you ABSOLUTELY SURE you want to wipe ALL data (including users) and start setup from scratch?')) return;
                            setBusyReset(true);
                            setError('');
                            setMsg('');
                            try {
                              const res = await api.resetSystemData(true);
                              setResetConfirm('');
                              await logout();
                              navigate('/setup', { replace: true });
                            } catch (err) {
                              setError((err as Error).message);
                            } finally {
                              setBusyReset(false);
                            }
                          }}
                        >
                          {busyReset ? 'Wiping Database…' : 'Factory Reset to Scratch (Full Wipe)'}
                        </button>

                        <button
                          type="button"
                          className="btn btn-sm btn-outline"
                          disabled={resetConfirm !== 'RESET-SCRATCH' || busyReset}
                          style={{
                            cursor: resetConfirm === 'RESET-SCRATCH' ? 'pointer' : 'not-allowed',
                            opacity: resetConfirm === 'RESET-SCRATCH' ? 1 : 0.5,
                          }}
                          onClick={async () => {
                            if (!window.confirm('Clear all demo products, stock movements, and orders while keeping your manager account?')) return;
                            setBusyReset(true);
                            setError('');
                            setMsg('');
                            try {
                              const res = await api.resetSystemData(false);
                              setResetConfirm('');
                              setMsg(`✓ ${res.message}`);
                              await load();
                            } catch (err) {
                              setError((err as Error).message);
                            } finally {
                              setBusyReset(false);
                            }
                          }}
                        >
                          Clear Demo Stock Only (Keep Account)
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Setup Wizard Modal */}
      <SetupWizardModal
        isOpen={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onSuccess={async () => {
          setMsg('✓ System initialized successfully!');
          await load();
        }}
      />
    </>
  );
}
