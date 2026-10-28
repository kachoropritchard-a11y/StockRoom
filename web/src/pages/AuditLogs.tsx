import { useCallback, useEffect, useState } from 'react';
import { api, type MovementItem } from '../api';
import { AccessibleTabs, type TabDefinition } from '../components/AccessibleTabs';
import { Spinner } from '../components/Spinner';
import { useZim } from '../zimContext';

type AuditSubTab = 'ledger' | 'audit' | 'governance';

interface AuditLogItem {
  id: number;
  actorId: number;
  actorEmail: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  details?: Record<string, unknown>;
  createdAt: string;
}

export function AuditLogs() {
  const { subLabel, formatMoney } = useZim();
  const [activeTab, setActiveTab] = useState<AuditSubTab>('ledger');

  const [movements, setMovements] = useState<MovementItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [ledgerPage, setLedgerPage] = useState(0);
  const [typeFilter, setTypeFilter] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  // Governance Policy State
  const [enforceSeparation, setEnforceSeparation] = useState(true);
  const [poThreshold, setPoThreshold] = useState('500');
  const [savingPolicy, setSavingPolicy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [mRes, aRes, orgRes] = await Promise.all([
        api.movements(typeFilter || undefined, { limit: 50, offset: ledgerPage * 50 }),
        api.auditLogs({ limit: 50 }).catch(() => ({ items: [], total: 0 })),
        api.organisation().catch(() => null),
      ]);
      setMovements(mRes.items);
      setAuditLogs(aRes.items as AuditLogItem[]);
      if (orgRes) {
        setEnforceSeparation(Boolean(orgRes.enforceSeparationOfDuties));
        setPoThreshold(String(orgRes.poApprovalThreshold ?? 500));
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [ledgerPage, typeFilter]);

  useEffect(() => {
    load();
    const onSync = () => load();
    window.addEventListener('stockroom:sync', onSync);
    return () => window.removeEventListener('stockroom:sync', onSync);
  }, [load]);

  async function handleSavePolicy() {
    setSavingPolicy(true);
    setError('');
    setMsg('');
    try {
      await api.updateOrganisation({
        enforceSeparationOfDuties: enforceSeparation,
        poApprovalThreshold: Number(poThreshold),
      });
      setMsg('Governance policy and approval thresholds updated successfully.');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingPolicy(false);
    }
  }

  const tabs: TabDefinition<AuditSubTab>[] = [
    {
      key: 'ledger',
      label: '1. Authoritative Stock Ledger',
      badge: movements.length,
      purpose: 'Complete immutable chronological record of every stock movement posted to the store ledger.',
    },
    {
      key: 'audit',
      label: '2. Administrative Activity Audit',
      badge: auditLogs.length,
      purpose: 'Tamper-evident logs of user activities, policy edits, credential rotations, and approvals.',
    },
    {
      key: 'governance',
      label: '3. Separation of Duties Policy',
      badge: undefined,
      purpose: 'Enforce dual authorization on high-value orders and prevent single-user fraud.',
    },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Audit Logs &amp; Governance Trail</h1>
          <span className="vernacular-sub">
            {subLabel(
              'Gwaro reKufamba Kwezvinhu neMaitiro eVashandi • Chengetedzo yeBhizinesi',
              'Ukulandelela Izinto Lezenzo Zabasebenzi • Ukulondeka Kwebhizimusi',
            )}
          </span>
        </div>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      {msg && <p className="form-success" role="status">{msg}</p>}

      <section className="card">
        {/* TIER 3: Horizontal Sub-Menu Tabs */}
        <AccessibleTabs
          idPrefix="audit-logs"
          ariaLabel="Audit logs and governance sections"
          tabs={tabs}
          active={activeTab}
          onChange={setActiveTab}
        />

        {/* SUB-MENU 1: Authoritative Stock Movement Ledger */}
        {activeTab === 'ledger' && (
          <div id="audit-logs-panel-ledger" role="tabpanel" aria-labelledby="audit-logs-tab-ledger">
            <div className="section-head" style={{ marginBottom: '0.75rem' }}>
              <div>
                <h3 style={{ margin: 0 }}>Authoritative Append-Only Stock Movements</h3>
                <span className="vernacular-sub" style={{ fontSize: '0.82rem' }}>
                  Every receipt, sale, transfer, write-off, and count adjustment recorded in the system.
                </span>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <select
                  value={typeFilter}
                  onChange={(e) => {
                    setTypeFilter(e.target.value);
                    setLedgerPage(0);
                  }}
                  style={{ padding: '0.4rem 0.75rem' }}
                >
                  <option value="">All Movement Types</option>
                  <option value="receipt">Goods Intakes (Receipts)</option>
                  <option value="issue">Storefloor Issues &amp; Sales</option>
                  <option value="transfer">Inter-Store Transfers</option>
                  <option value="count">Physical Stocktake Adjustments</option>
                  <option value="write_off">Non-Selling Write-Offs</option>
                </select>
              </div>
            </div>

            {loading ? (
              <div style={{ padding: '3rem', textAlign: 'center' }}>
                <Spinner label="Loading ledger movements" />
                <p className="muted" style={{ marginTop: '0.5rem' }}>Loading immutable ledger…</p>
              </div>
            ) : movements.length === 0 ? (
              <div className="empty-state-box" style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
                <p className="muted" style={{ margin: 0 }}>No movements match the selected filter.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Doc #</th>
                      <th>Type</th>
                      <th>Reference</th>
                      <th>Product</th>
                      <th>Store Location</th>
                      <th className="num">Base Qty Change</th>
                      <th className="num">Unit Cost</th>
                      <th>Recorded By</th>
                      <th>Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((m) => {
                      const isPosChange = m.baseChange > 0;
                      return (
                        <tr key={m.id}>
                          <td>
                            <code>#{m.documentId}</code>
                          </td>
                          <td style={{ textTransform: 'capitalize' }}>
                            <span
                              className={`status-pill ${
                                m.type === 'receipt'
                                  ? 'optimal'
                                  : m.type === 'issue'
                                  ? 'warn'
                                  : m.type === 'write_off'
                                  ? 'low'
                                  : 'low'
                              }`}
                            >
                              {m.type.replace('_', ' ')}
                            </span>
                          </td>
                          <td>
                            <strong>{m.reference || '—'}</strong>
                          </td>
                          <td>
                            {m.productName} <code>({m.sku})</code>
                          </td>
                          <td>{m.warehouseName}</td>
                          <td className="num">
                            <strong style={{ color: isPosChange ? 'var(--emerald)' : 'var(--danger)' }}>
                              {isPosChange ? `+${m.baseChange}` : m.baseChange} {m.unit}
                            </strong>
                          </td>
                          <td className="num">{formatMoney(m.unitCost)}</td>
                          <td>Staff</td>
                          <td>{m.createdAt.slice(0, 16)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* SUB-MENU 2: Administrative Activity Audit */}
        {activeTab === 'audit' && (
          <div id="audit-logs-panel-audit" role="tabpanel" aria-labelledby="audit-logs-tab-audit">
            <div className="section-head" style={{ marginBottom: '0.75rem' }}>
              <div>
                <h3 style={{ margin: 0 }}>Executive Administrative Audit Trail</h3>
                <span className="vernacular-sub" style={{ fontSize: '0.82rem' }}>
                  Cryptographically immutable security log tracking user management, configuration changes, and approvals.
                </span>
              </div>
            </div>

            {auditLogs.length === 0 ? (
              <div className="empty-state-box" style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
                <p className="muted" style={{ margin: 0 }}>No administrative actions logged yet.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Log #</th>
                      <th>Admin User</th>
                      <th>Role</th>
                      <th>Action</th>
                      <th>Target</th>
                      <th>Details</th>
                      <th>Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map((log) => (
                      <tr key={log.id}>
                        <td>
                          <code>#{log.id}</code>
                        </td>
                        <td>
                          <strong>{log.actorEmail}</strong>
                        </td>
                        <td>
                          <span className="status-pill optimal" style={{ textTransform: 'capitalize' }}>
                            {log.actorRole.replace('_', ' ')}
                          </span>
                        </td>
                        <td>
                          <code>{log.action}</code>
                        </td>
                        <td>
                          {log.targetType} #{log.targetId}
                        </td>
                        <td style={{ fontSize: '0.76rem', color: 'var(--muted)' }}>
                          {log.details ? JSON.stringify(log.details) : '—'}
                        </td>
                        <td>{log.createdAt.slice(0, 16)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* SUB-MENU 3: Separation of Duties Policy */}
        {activeTab === 'governance' && (
          <div id="audit-logs-panel-governance" role="tabpanel" aria-labelledby="audit-logs-tab-governance">
            <div
              className="subcard"
              style={{
                marginBottom: '1.25rem',
                borderLeft: '4px solid var(--emerald)',
                background: 'var(--surface-alt)',
              }}
            >
              <h3 style={{ margin: '0 0 0.35rem', color: 'var(--charcoal)' }}>
                Internal Controls &amp; Governance Safeguards
              </h3>
              <p style={{ margin: 0, fontSize: '0.86rem', color: 'var(--muted)', lineHeight: 1.5 }}>
                Enforce strict separation between staff who create purchase orders and executives who authorize cash disbursements.
                Orders exceeding the approval threshold require executive sign-off before vendor goods intake can occur.
              </p>
            </div>

            <div className="form-grid subcard" style={{ maxWidth: '600px' }}>
              <div className="checkbox-row" style={{ gridColumn: '1 / -1', alignItems: 'flex-start' }}>
                <input
                  id="enforceSeparationCheck"
                  type="checkbox"
                  checked={enforceSeparation}
                  onChange={(e) => setEnforceSeparation(e.target.checked)}
                />
                <label htmlFor="enforceSeparationCheck" style={{ margin: 0, cursor: 'pointer' }}>
                  <strong>Enforce Separation of Duties</strong>
                  <div className="muted" style={{ fontSize: '0.82rem', marginTop: '0.2rem' }}>
                    Staff who create purchase orders cannot approve their own orders. High-value orders must be authorized by an Executive Manager.
                  </div>
                </label>
              </div>

              <label style={{ gridColumn: '1 / -1' }}>
                PO Approval Threshold ($ USD)
                <input
                  type="number"
                  min="0"
                  step="10"
                  value={poThreshold}
                  onChange={(e) => setPoThreshold(e.target.value)}
                />
                <span className="muted" style={{ fontSize: '0.76rem', marginTop: '0.25rem', display: 'block' }}>
                  Orders above this value require executive sign-off before goods intake can be posted.
                </span>
              </label>

              <div className="form-actions" style={{ gridColumn: '1 / -1' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleSavePolicy}
                  disabled={savingPolicy}
                >
                  {savingPolicy ? 'Saving Policy…' : '✓ Save Governance Policy'}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
