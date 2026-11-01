import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.ts';
import { openDb } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { seed } from '../src/seed.ts';
import { buildApp } from '../src/app.ts';

test('Stage 11: SME Payroll & EasyBook Balancing Full Lifecycle', async (t) => {
  const db = openDb(':memory:');
  migrate(db);
  seed(db, { executive: 'exec-pass-123', inventory: 'inv-pass-123' }, 4);
  const app = buildApp(db, loadConfig({ NODE_ENV: 'test', BCRYPT_COST: '4' }));

  t.after(async () => {
    await app.close();
    db.close();
  });

  const loginRes = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'x-requested-with': 'stockroom' },
    payload: { email: 'executive@example.com', password: 'exec-pass-123' },
  });
  const token = loginRes.json().token as string;
  const authHeader = { authorization: `Bearer ${token}` };

  // 1. EasyBook: Record Income (e.g. Opening Balance / Sales)
  const incRes = await app.inject({
    method: 'POST',
    url: '/api/sme/cashbook',
    headers: authHeader,
    payload: {
      entryDate: '2026-11-01',
      entryType: 'INCOME',
      category: 'Daily Cash Sales',
      description: 'Morning till opening cash sales batch',
      paymentMethod: 'CASH',
      currency: 'USD',
      amount: 450.0,
      receiptVoucherRef: 'BATCH-2026-11-01',
    },
  });
  assert.equal(incRes.statusCode, 201);
  assert.equal(incRes.json().ok, true);

  // 2. EasyBook: Record Expense (e.g. ZESA Electricity Token)
  const expRes = await app.inject({
    method: 'POST',
    url: '/api/sme/cashbook',
    headers: authHeader,
    payload: {
      entryDate: '2026-11-01',
      entryType: 'EXPENSE',
      category: 'Utilities/ZESA/Water',
      description: 'Prepaid 3-phase ZESA electricity token for store',
      paymentMethod: 'ECOCASH',
      currency: 'USD',
      amount: 50.0,
      receiptVoucherRef: 'ZESA-778841',
    },
  });
  assert.equal(expRes.statusCode, 201);

  // 3. EasyBook: Verify CashBook Summary and Balancing calculation
  const cbRes = await app.inject({
    method: 'GET',
    url: '/api/sme/cashbook',
    headers: authHeader,
  });
  assert.equal(cbRes.statusCode, 200);
  const cbData = cbRes.json();
  assert.equal(cbData.entries.length, 2);
  assert.equal(cbData.summary.USD.income, 450.0);
  assert.equal(cbData.summary.USD.expense, 50.0);
  assert.equal(cbData.summary.USD.balance, 400.0);

  // 4. Payroll: Register 2 SME Staff Members (1 EcoCash, 1 Cash)
  const emp1Res = await app.inject({
    method: 'POST',
    url: '/api/sme/payroll/employees',
    headers: authHeader,
    payload: {
      fullName: 'Tinashe Chikore',
      jobTitle: 'Counter Cashier',
      departmentName: 'Groceries',
      baseSalary: 180.0,
      currency: 'USD',
      paymentMethod: 'ECOCASH',
      ecocashNumber: '0772555666',
    },
  });
  assert.equal(emp1Res.statusCode, 201);

  const emp2Res = await app.inject({
    method: 'POST',
    url: '/api/sme/payroll/employees',
    headers: authHeader,
    payload: {
      fullName: 'Simbarashe Dube',
      jobTitle: 'Yard Storeman',
      departmentName: 'Hardware',
      baseSalary: 150.0,
      currency: 'USD',
      paymentMethod: 'CASH',
    },
  });
  assert.equal(emp2Res.statusCode, 201);

  // 5. Payroll: Run & Disburse Payroll with auto-posting to CashBook
  const runRes = await app.inject({
    method: 'POST',
    url: '/api/sme/payroll/runs',
    headers: authHeader,
    payload: {
      periodLabel: 'November 2026',
      currency: 'USD',
      autoPostCashbook: true,
      deductionsPct: 0,
    },
  });
  assert.equal(runRes.statusCode, 201);
  const runData = runRes.json();
  assert.equal(runData.ok, true);
  assert.equal(runData.employeeCount, 2);
  assert.equal(runData.totalNet, 330.0); // 180 + 150

  // 6. Verify Payslips generated with ContiPay EcoCash payout references
  const slipsRes = await app.inject({
    method: 'GET',
    url: `/api/sme/payroll/runs/${runData.runId}/payslips`,
    headers: authHeader,
  });
  assert.equal(slipsRes.statusCode, 200);
  const slipsData = slipsRes.json();
  assert.equal(slipsData.payslips.length, 2);
  const ecocashSlip = slipsData.payslips.find((s: any) => s.paymentMethod === 'ECOCASH');
  assert.ok(ecocashSlip);
  assert.match(ecocashSlip.contipayReference, /^CP-PAY-/);

  // 7. Verify EasyBook CashBook automatically updated with Payroll Disbursal expense
  const cbAfterPayrollRes = await app.inject({
    method: 'GET',
    url: '/api/sme/cashbook',
    headers: authHeader,
  });
  const cbAfter = cbAfterPayrollRes.json();
  assert.equal(cbAfter.entries.length, 3);
  assert.equal(cbAfter.summary.USD.expense, 380.0); // 50 (ZESA) + 330 (Payroll)
  assert.equal(cbAfter.summary.USD.balance, 70.0); // 450 - 380 = 70.0 USD Net Cash Balance
});
