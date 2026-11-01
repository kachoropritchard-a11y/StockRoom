import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useZim } from '../zimContext';
import { Spinner } from '../components/Spinner';

interface Employee {
  id: number;
  employeeCode: string;
  fullName: string;
  nationalId: string | null;
  jobTitle: string;
  departmentName: string;
  baseSalary: number;
  currency: 'USD' | 'ZiG';
  ecocashNumber: string | null;
  bankName: string | null;
  bankAccount: string | null;
  paymentMethod: 'ECOCASH' | 'CASH' | 'BANK';
  active: boolean;
  createdAt: string;
}

interface PayrollRun {
  id: number;
  periodLabel: string;
  currency: 'USD' | 'ZiG';
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  status: 'DRAFT' | 'APPROVED' | 'PAID';
  paidAt: string | null;
  processedByName: string;
  createdAt: string;
}

interface Payslip {
  id: number;
  employeeId: number;
  employeeName: string;
  jobTitle: string;
  currency: string;
  basePay: number;
  grossPay: number;
  deductions: number;
  netPay: number;
  paymentMethod: string;
  contipayReference: string | null;
  paymentStatus: string;
  createdAt: string;
}

export function Payroll() {
  const { formatMoney, subLabel } = useZim();

  const [activeTab, setActiveTab] = useState<'runs' | 'employees'>('runs');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Modals
  const [showNewEmpModal, setShowNewEmpModal] = useState(false);
  const [showRunModal, setShowRunModal] = useState(false);
  const [viewSlipsRun, setViewSlipsRun] = useState<{ run: any; payslips: Payslip[] } | null>(null);

  // Form states: New / Edit Employee
  const [editingEmpId, setEditingEmpId] = useState<number | null>(null);
  const [empFullName, setEmpFullName] = useState('');
  const [empJobTitle, setEmpJobTitle] = useState('Store Assistant');
  const [empDepartment, setEmpDepartment] = useState('Storefloor');
  const [empBaseSalary, setEmpBaseSalary] = useState('150.00');
  const [empCurrency, setEmpCurrency] = useState<'USD' | 'ZiG'>('USD');
  const [empPaymentMethod, setEmpPaymentMethod] = useState<'ECOCASH' | 'CASH' | 'BANK'>('ECOCASH');
  const [empEcocashNumber, setEmpEcocashNumber] = useState('');
  const [empBankName, setEmpBankName] = useState('');
  const [empBankAccount, setEmpBankAccount] = useState('');
  const [empActive, setEmpActive] = useState(true);

  // Form states: Process Run
  const now = new Date();
  const defaultMonthName = now.toLocaleString('default', { month: 'long', year: 'numeric' });
  const [runPeriod, setRunPeriod] = useState(defaultMonthName);
  const [runCurrency, setRunCurrency] = useState<'USD' | 'ZiG'>('USD');
  const [runDeductionsPct, setRunDeductionsPct] = useState('0');
  const [runAutoPostCashbook, setRunAutoPostCashbook] = useState(true);
  const [processingRun, setProcessingRun] = useState(false);

  function loadAll() {
    setLoading(true);
    Promise.all([api.payrollEmployees(), api.payrollRuns()])
      .then(([empRes, runsRes]) => {
        setEmployees(empRes.employees);
        setRuns(runsRes.runs);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadAll();
  }, []);

  function openCreateEmployee() {
    setEditingEmpId(null);
    setEmpFullName('');
    setEmpJobTitle('Store Assistant');
    setEmpDepartment('Storefloor');
    setEmpBaseSalary('150.00');
    setEmpCurrency('USD');
    setEmpPaymentMethod('ECOCASH');
    setEmpEcocashNumber('');
    setEmpBankName('');
    setEmpBankAccount('');
    setEmpActive(true);
    setShowNewEmpModal(true);
  }

  function openEditEmployee(emp: Employee) {
    setEditingEmpId(emp.id);
    setEmpFullName(emp.fullName);
    setEmpJobTitle(emp.jobTitle);
    setEmpDepartment(emp.departmentName);
    setEmpBaseSalary(emp.baseSalary.toFixed(2));
    setEmpCurrency(emp.currency);
    setEmpPaymentMethod(emp.paymentMethod);
    setEmpEcocashNumber(emp.ecocashNumber || '');
    setEmpBankName(emp.bankName || '');
    setEmpBankAccount(emp.bankAccount || '');
    setEmpActive(emp.active);
    setShowNewEmpModal(true);
  }

  async function handleSaveEmployee(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.savePayrollEmployee({
        id: editingEmpId || undefined,
        fullName: empFullName,
        jobTitle: empJobTitle,
        departmentName: empDepartment,
        baseSalary: parseFloat(empBaseSalary) || 0,
        currency: empCurrency,
        paymentMethod: empPaymentMethod,
        ecocashNumber: empEcocashNumber.trim() || undefined,
        bankName: empBankName.trim() || undefined,
        bankAccount: empBankAccount.trim() || undefined,
        active: empActive,
      });

      setShowNewEmpModal(false);
      setSuccess(`✓ Employee "${empFullName}" saved successfully.`);
      loadAll();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleExecuteRun(e: FormEvent) {
    e.preventDefault();
    setProcessingRun(true);
    setError('');
    try {
      const res = await api.runPayroll({
        periodLabel: runPeriod,
        currency: runCurrency,
        autoPostCashbook: runAutoPostCashbook,
        deductionsPct: parseFloat(runDeductionsPct) || 0,
      });

      setShowRunModal(false);
      setSuccess(
        `✓ Disbursed payroll run for ${res.employeeCount} employee(s) totaling ${
          res.currency === 'USD' ? '$' : ''
        }${res.totalNet.toFixed(2)} ${res.currency === 'ZiG' ? 'ZiG' : ''}! Auto-posted to EasyBook.`,
      );
      loadAll();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProcessingRun(false);
    }
  }

  async function handleViewPayslips(runId: number) {
    try {
      const data = await api.payrollPayslips(runId);
      setViewSlipsRun(data);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Active wage totals
  const totalMonthlyWageUsd = employees
    .filter((e) => e.active && e.currency === 'USD')
    .reduce((sum, e) => sum + e.baseSalary, 0);

  const totalMonthlyWageZig = employees
    .filter((e) => e.active && e.currency === 'ZiG')
    .reduce((sum, e) => sum + e.baseSalary, 0);

  return (
    <div className="payroll-page animate-fade-in">
      {/* Top Header Card */}
      <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <span style={{ fontSize: '1.6rem' }}>👥</span>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.35rem' }}>SME Payroll & Staff Disbursals</h2>
                <span className="vernacular-sub" style={{ fontSize: '0.78rem' }}>
                  {subLabel('Mitambiro yeVashandi & ContiPay EcoCash Disbursals', 'Imiholo Yezisebenzi & EcoCash')}
                </span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              className="btn btn-outline"
              onClick={openCreateEmployee}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700 }}
            >
              + Add Employee
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowRunModal(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                fontWeight: 800,
                background: 'linear-gradient(135deg, var(--zim-green-700), var(--zim-green-800))',
              }}
            >
              ⚡ Process & Disburse Payroll
            </button>
          </div>
        </div>

        {/* Quick KPI Row */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '0.75rem',
            marginTop: '1.25rem',
          }}
        >
          <div style={{ background: 'var(--surface-alt)', padding: '0.85rem', borderRadius: '8px', border: '1px solid var(--line)' }}>
            <span className="muted" style={{ fontSize: '0.74rem', textTransform: 'uppercase', fontWeight: 700 }}>
              Active Staff
            </span>
            <div style={{ fontSize: '1.5rem', fontWeight: 900, color: 'var(--charcoal)', marginTop: '0.2rem' }}>
              {employees.filter((e) => e.active).length} / {employees.length}
            </div>
            <span className="muted" style={{ fontSize: '0.72rem' }}>
              Employees on active register
            </span>
          </div>

          <div style={{ background: 'var(--surface-alt)', padding: '0.85rem', borderRadius: '8px', border: '1px solid var(--line)' }}>
            <span className="muted" style={{ fontSize: '0.74rem', textTransform: 'uppercase', fontWeight: 700 }}>
              Monthly Wage Bill (USD)
            </span>
            <div style={{ fontSize: '1.5rem', fontWeight: 900, color: 'var(--emerald)', marginTop: '0.2rem' }}>
              ${totalMonthlyWageUsd.toFixed(2)}
            </div>
            <span className="muted" style={{ fontSize: '0.72rem' }}>
              USD contracts
            </span>
          </div>

          <div style={{ background: 'var(--surface-alt)', padding: '0.85rem', borderRadius: '8px', border: '1px solid var(--line)' }}>
            <span className="muted" style={{ fontSize: '0.74rem', textTransform: 'uppercase', fontWeight: 700 }}>
              Monthly Wage Bill (ZiG)
            </span>
            <div style={{ fontSize: '1.5rem', fontWeight: 900, color: 'var(--zim-gold-500)', marginTop: '0.2rem' }}>
              {totalMonthlyWageZig.toFixed(2)} ZiG
            </div>
            <span className="muted" style={{ fontSize: '0.72rem' }}>
              Local currency contracts
            </span>
          </div>

          <div style={{ background: 'var(--surface-alt)', padding: '0.85rem', borderRadius: '8px', border: '1px solid var(--line)' }}>
            <span className="muted" style={{ fontSize: '0.74rem', textTransform: 'uppercase', fontWeight: 700 }}>
              Completed Disbursals
            </span>
            <div style={{ fontSize: '1.5rem', fontWeight: 900, color: 'var(--charcoal)', marginTop: '0.2rem' }}>
              {runs.length} Runs
            </div>
            <span className="muted" style={{ fontSize: '0.72rem' }}>
              All balanced with EasyBook
            </span>
          </div>
        </div>
      </div>

      {error && (
        <div className="banner danger animate-scale-up" style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between' }}>
          <span>{error}</span>
          <button type="button" className="btn btn-link btn-sm" onClick={() => setError('')}>✕</button>
        </div>
      )}

      {success && (
        <div className="banner success animate-scale-up" style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between' }}>
          <span>{success}</span>
          <button type="button" className="btn btn-link btn-sm" onClick={() => setSuccess('')}>✕</button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.85rem' }}>
        <button
          type="button"
          className={`btn btn-sm ${activeTab === 'runs' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setActiveTab('runs')}
          style={{ fontWeight: 700 }}
        >
          📜 Disbursal Runs & Payslips ({runs.length})
        </button>
        <button
          type="button"
          className={`btn btn-sm ${activeTab === 'employees' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setActiveTab('employees')}
          style={{ fontWeight: 700 }}
        >
          👥 Employee Directory ({employees.length})
        </button>
      </div>

      {loading ? (
        <Spinner label="Loading payroll..." />
      ) : activeTab === 'runs' ? (
        /* Payroll Runs Table */
        <div className="card" style={{ padding: '1rem' }}>
          {runs.length === 0 ? (
            <div className="empty-state" style={{ padding: '2.5rem', textAlign: 'center' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>💼</div>
              <h3>No Payroll Runs Disbursed Yet</h3>
              <p className="muted" style={{ maxWidth: '400px', margin: '0.25rem auto 1rem', fontSize: '0.88rem' }}>
                Run your first monthly or weekly payroll with one click. Wages are calculated, ContiPay EcoCash payout references are generated, and entries automatically sync to EasyBook.
              </p>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowRunModal(true)}>
                ⚡ Process First Payroll Run
              </button>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="data-table" style={{ width: '100%', fontSize: '0.88rem' }}>
                <thead>
                  <tr>
                    <th>Period / Month</th>
                    <th>Processed Date</th>
                    <th>Processed By</th>
                    <th className="num">Gross Wages</th>
                    <th className="num">Deductions</th>
                    <th className="num">Net Disbursed</th>
                    <th>Status</th>
                    <th className="num">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 700 }}>{r.periodLabel}</td>
                      <td>{r.paidAt ? new Date(r.paidAt).toLocaleDateString() : '-'}</td>
                      <td>{r.processedByName}</td>
                      <td className="num">
                        {r.currency === 'USD' ? '$' : ''}{r.totalGross.toFixed(2)} {r.currency === 'ZiG' ? 'ZiG' : ''}
                      </td>
                      <td className="num muted">
                        {r.currency === 'USD' ? '$' : ''}{r.totalDeductions.toFixed(2)} {r.currency === 'ZiG' ? 'ZiG' : ''}
                      </td>
                      <td className="num" style={{ fontWeight: 800, color: 'var(--emerald)' }}>
                        {r.currency === 'USD' ? '$' : ''}{r.totalNet.toFixed(2)} {r.currency === 'ZiG' ? 'ZiG' : ''}
                      </td>
                      <td>
                        <span className="status-pill optimal">✓ {r.status}</span>
                      </td>
                      <td className="num">
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.78rem' }}
                          onClick={() => handleViewPayslips(r.id)}
                        >
                          👁 View Payslips
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        /* Employees Directory Table */
        <div className="card" style={{ padding: '1rem' }}>
          {employees.length === 0 ? (
            <div className="empty-state" style={{ padding: '2.5rem', textAlign: 'center' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>👤</div>
              <h3>No Employees Registered Yet</h3>
              <p className="muted" style={{ maxWidth: '400px', margin: '0.25rem auto 1rem', fontSize: '0.88rem' }}>
                Add your store workers, till cashiers, and yard assistants with their base wages and EcoCash mobile numbers.
              </p>
              <button type="button" className="btn btn-primary btn-sm" onClick={openCreateEmployee}>
                + Add First Employee
              </button>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="data-table" style={{ width: '100%', fontSize: '0.88rem' }}>
                <thead>
                  <tr>
                    <th>Emp Code</th>
                    <th>Full Name</th>
                    <th>Job Title & Dept</th>
                    <th>Payment Method</th>
                    <th>EcoCash / Bank Details</th>
                    <th className="num">Base Salary</th>
                    <th>Status</th>
                    <th className="num">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((emp) => (
                    <tr key={emp.id} style={{ opacity: emp.active ? 1 : 0.6 }}>
                      <td>
                        <code>{emp.employeeCode}</code>
                      </td>
                      <td style={{ fontWeight: 700 }}>{emp.fullName}</td>
                      <td>
                        <div>{emp.jobTitle}</div>
                        <span className="muted" style={{ fontSize: '0.75rem' }}>{emp.departmentName}</span>
                      </td>
                      <td>
                        <span
                          className="status-pill"
                          style={{
                            background: emp.paymentMethod === 'ECOCASH' ? '#ecfdf5' : '#f3f4f6',
                            color: emp.paymentMethod === 'ECOCASH' ? '#047857' : '#374151',
                            fontWeight: 700,
                          }}
                        >
                          {emp.paymentMethod === 'ECOCASH' ? '📱 EcoCash' : emp.paymentMethod === 'CASH' ? '💵 Cash' : '🏦 Bank'}
                        </span>
                      </td>
                      <td>
                        {emp.paymentMethod === 'ECOCASH' && emp.ecocashNumber ? (
                          <strong>{emp.ecocashNumber}</strong>
                        ) : emp.paymentMethod === 'BANK' && emp.bankAccount ? (
                          <div>{emp.bankName}: {emp.bankAccount}</div>
                        ) : (
                          <span className="muted">Direct Counter Cash</span>
                        )}
                      </td>
                      <td className="num" style={{ fontWeight: 800 }}>
                        {emp.currency === 'USD' ? '$' : ''}{emp.baseSalary.toFixed(2)} {emp.currency === 'ZiG' ? 'ZiG' : ''}
                      </td>
                      <td>
                        <span className={`status-pill ${emp.active ? 'optimal' : 'danger'}`}>
                          {emp.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="num">
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.78rem' }}
                          onClick={() => openEditEmployee(emp)}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* MODAL: Add / Edit Employee */}
      {showNewEmpModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card animate-scale-up" style={{ maxWidth: '520px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>{editingEmpId ? 'Edit Employee Details' : 'Register New Employee'}</h3>
              <button type="button" className="btn btn-link btn-sm" onClick={() => setShowNewEmpModal(false)}>
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveEmployee}>
              <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <label style={{ gridColumn: '1 / -1' }}>
                  Full Legal Name *
                  <input
                    type="text"
                    required
                    value={empFullName}
                    onChange={(e) => setEmpFullName(e.target.value)}
                    placeholder="e.g. Tendai Moyo"
                  />
                </label>

                <label>
                  Job Title *
                  <input
                    type="text"
                    required
                    value={empJobTitle}
                    onChange={(e) => setEmpJobTitle(e.target.value)}
                    placeholder="e.g. Storefront Cashier"
                  />
                </label>

                <label>
                  Department *
                  <input
                    type="text"
                    required
                    value={empDepartment}
                    onChange={(e) => setEmpDepartment(e.target.value)}
                    placeholder="e.g. Groceries"
                  />
                </label>

                <label>
                  Base Salary *
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={empBaseSalary}
                    onChange={(e) => setEmpBaseSalary(e.target.value)}
                  />
                </label>

                <label>
                  Salary Currency *
                  <select value={empCurrency} onChange={(e) => setEmpCurrency(e.target.value as any)}>
                    <option value="USD">USD ($)</option>
                    <option value="ZiG">ZiG</option>
                  </select>
                </label>

                <label style={{ gridColumn: '1 / -1' }}>
                  Disbursal Payment Method *
                  <select value={empPaymentMethod} onChange={(e) => setEmpPaymentMethod(e.target.value as any)}>
                    <option value="ECOCASH">📱 EcoCash Mobile (Direct Phone Payout)</option>
                    <option value="CASH">💵 Cash (Physical Handout)</option>
                    <option value="BANK">🏦 Bank Transfer</option>
                  </select>
                </label>

                {empPaymentMethod === 'ECOCASH' && (
                  <label style={{ gridColumn: '1 / -1' }}>
                    EcoCash Registered Phone Number *
                    <input
                      type="tel"
                      value={empEcocashNumber}
                      onChange={(e) => setEmpEcocashNumber(e.target.value)}
                      placeholder="e.g. 0772123456 or 0781234567"
                    />
                  </label>
                )}

                {empPaymentMethod === 'BANK' && (
                  <>
                    <label>
                      Bank Name
                      <input
                        type="text"
                        value={empBankName}
                        onChange={(e) => setEmpBankName(e.target.value)}
                        placeholder="e.g. CBZ, CABS, Stanbic"
                      />
                    </label>
                    <label>
                      Account Number
                      <input
                        type="text"
                        value={empBankAccount}
                        onChange={(e) => setEmpBankAccount(e.target.value)}
                        placeholder="Account number"
                      />
                    </label>
                  </>
                )}

                <label style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={empActive}
                    onChange={(e) => setEmpActive(e.target.checked)}
                  />
                  <span><strong>Active Employee</strong> (Include in regular monthly payroll runs)</span>
                </label>
              </div>

              <div className="form-actions" style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                  Save Employee
                </button>
                <button type="button" className="btn btn-outline" onClick={() => setShowNewEmpModal(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Execute Payroll Run */}
      {showRunModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card animate-scale-up" style={{ maxWidth: '480px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <span style={{ fontSize: '1.4rem' }}>⚡</span>
                <h3 style={{ margin: 0 }}>Process & Disburse Payroll</h3>
              </div>
              <button type="button" className="btn btn-link btn-sm" onClick={() => setShowRunModal(false)}>
                ✕
              </button>
            </div>

            <form onSubmit={handleExecuteRun}>
              <div style={{ marginBottom: '1rem', background: '#ecfdf5', border: '1px solid #6ee7b7', borderRadius: '8px', padding: '0.75rem', fontSize: '0.82rem', color: '#065f46' }}>
                <strong>Seamless SME Automation:</strong> Disbursing payroll generates individual employee payslips, assigns ContiPay EcoCash disbursement batch references, and automatically balances into EasyBook as a Salaries & Wages expense.
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
                <label>
                  Payroll Period / Month *
                  <input
                    type="text"
                    required
                    value={runPeriod}
                    onChange={(e) => setRunPeriod(e.target.value)}
                    placeholder="e.g. November 2026"
                  />
                </label>

                <label>
                  Payout Currency *
                  <select value={runCurrency} onChange={(e) => setRunCurrency(e.target.value as any)}>
                    <option value="USD">USD ($) (Applies to {employees.filter((e) => e.active && e.currency === 'USD').length} USD staff)</option>
                    <option value="ZiG">ZiG (Applies to {employees.filter((e) => e.active && e.currency === 'ZiG').length} ZiG staff)</option>
                  </select>
                </label>

                <label>
                  Statutory Deductions (NSSA / Tax) %
                  <input
                    type="number"
                    min="0"
                    max="50"
                    step="0.5"
                    value={runDeductionsPct}
                    onChange={(e) => setRunDeductionsPct(e.target.value)}
                    placeholder="0"
                  />
                  <span className="muted" style={{ fontSize: '0.72rem' }}>
                    Flat percentage to deduct from gross pay (0% for non-taxed gross payout)
                  </span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', marginTop: '0.25rem' }}>
                  <input
                    type="checkbox"
                    checked={runAutoPostCashbook}
                    onChange={(e) => setRunAutoPostCashbook(e.target.checked)}
                  />
                  <span><strong>Auto-post expense to EasyBook CashBook</strong></span>
                </label>
              </div>

              <div className="form-actions" style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="submit"
                  disabled={processingRun}
                  className="btn btn-primary"
                  style={{
                    flex: 1,
                    background: 'linear-gradient(135deg, var(--zim-green-700), var(--zim-green-800))',
                    fontWeight: 800,
                  }}
                >
                  {processingRun ? 'Disbursing...' : 'Confirm & Disburse Run'}
                </button>
                <button type="button" className="btn btn-outline" onClick={() => setShowRunModal(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: View Payslips of a Run */}
      {viewSlipsRun && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card animate-scale-up" style={{ maxWidth: '640px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div>
                <h3 style={{ margin: 0 }}>Payslips: {viewSlipsRun.run.periodLabel}</h3>
                <span className="muted" style={{ fontSize: '0.78rem' }}>
                  Total Disbursed: <strong>{viewSlipsRun.run.currency === 'USD' ? '$' : ''}{viewSlipsRun.run.totalNet.toFixed(2)} {viewSlipsRun.run.currency === 'ZiG' ? 'ZiG' : ''}</strong> • Processed by {viewSlipsRun.run.processedByName}
                </span>
              </div>
              <button type="button" className="btn btn-link btn-sm" onClick={() => setViewSlipsRun(null)}>
                ✕
              </button>
            </div>

            <div style={{ maxHeight: '380px', overflowY: 'auto' }}>
              <table className="data-table" style={{ width: '100%', fontSize: '0.84rem' }}>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Method</th>
                    <th className="num">Gross</th>
                    <th className="num">Deductions</th>
                    <th className="num">Net Pay</th>
                    <th>Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {viewSlipsRun.payslips.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <div style={{ fontWeight: 700 }}>{s.employeeName}</div>
                        <span className="muted" style={{ fontSize: '0.72rem' }}>{s.jobTitle}</span>
                      </td>
                      <td>{s.paymentMethod}</td>
                      <td className="num">${s.grossPay.toFixed(2)}</td>
                      <td className="num muted">${s.deductions.toFixed(2)}</td>
                      <td className="num" style={{ fontWeight: 800, color: 'var(--emerald)' }}>
                        ${s.netPay.toFixed(2)}
                      </td>
                      <td>
                        {s.contipayReference ? (
                          <code style={{ fontSize: '0.72rem', color: 'var(--emerald)' }}>{s.contipayReference}</code>
                        ) : (
                          <span className="muted">Direct Cash</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="form-actions" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem', gap: '0.5rem' }}>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => window.print()}>
                🖨 Print Summary
              </button>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setViewSlipsRun(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
