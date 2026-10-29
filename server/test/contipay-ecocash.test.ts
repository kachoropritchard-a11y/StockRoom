import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.ts';
import { openDb } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { seed } from '../src/seed.ts';
import { buildApp } from '../src/app.ts';

test('Stage 10: ContiPay EcoCash USSD Push and Counter POS Checkout', async (t) => {
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

  // 1. Validation: Rejects invalid mobile number (not 077/078 Econet EcoCash)
  const invalidPhoneRes = await app.inject({
    method: 'POST',
    url: '/api/payments/contipay/ecocash-charge',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      phone: '0711234567', // NetOne prefix, not EcoCash
      amount: 15.5,
      currency: 'USD',
      pin: '1234',
    },
  });
  assert.equal(invalidPhoneRes.statusCode, 400);
  assert.match(invalidPhoneRes.json().message, /Invalid EcoCash mobile number/);

  // 2. Validation: Rejects non-4-digit PIN
  const badPinRes = await app.inject({
    method: 'POST',
    url: '/api/payments/contipay/ecocash-charge',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      phone: '0772123456',
      amount: 15.5,
      currency: 'USD',
      pin: '12', // Too short
    },
  });
  assert.equal(badPinRes.statusCode, 400);
  assert.match(badPinRes.json().message, /4-digit/);

  // 3. Successful EcoCash authorization via ContiPay Gateway
  const contipayRes = await app.inject({
    method: 'POST',
    url: '/api/payments/contipay/ecocash-charge',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      phone: '0772123456',
      amount: 25.0,
      currency: 'USD',
      pin: '4321',
    },
  });
  assert.equal(contipayRes.statusCode, 200);
  const contipayData = contipayRes.json();
  assert.equal(contipayData.ok, true);
  assert.equal(contipayData.status, 'COMPLETED');
  assert.match(contipayData.contipayRef, /^CP-ECO-/);
  assert.match(contipayData.approvalCode, /^AUTH-/);
  assert.equal(contipayData.amount, 25.0);
  assert.equal(contipayData.currency, 'USD');

  // 4. POS Counter Sale with tenderType ECOCASH_USD and contipayRef
  // Create a product first
  const prodRes = await app.inject({
    method: 'POST',
    url: '/api/products',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      sku: 'ECO-SUGAR-2KG',
      name: 'Eco Sugar 2KG',
      baseUnitId: 1,
    },
  });
  const prod = prodRes.json();

  // Receive stock so there's enough inventory
  await app.inject({
    method: 'POST',
    url: '/api/stock/receipts',
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': 'key-rcpt-contipay-1' },
    payload: {
      lines: [{ productId: prod.id, warehouseId: 1, unitId: 1, quantity: 20 }],
    },
  });

  // Execute POS Counter Sale via EcoCash & ContiPay
  const saleRes = await app.inject({
    method: 'POST',
    url: '/api/sme/counter-sale',
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': 'key-sale-contipay-1' },
    payload: {
      warehouseId: 1,
      tenderType: 'ECOCASH_USD',
      customerName: 'Tendai Moyo',
      customerPhone: '0772123456',
      contipayRef: contipayData.contipayRef,
      lines: [{ productId: prod.id, unitId: 1, quantity: 2, unitSellingPrice: 2.2 }],
    },
  });

  assert.equal(saleRes.statusCode, 201);
  const saleData = saleRes.json();
  assert.equal(saleData.contipayRef, contipayData.contipayRef);
  assert.equal(saleData.fiscalReceipt.contipayRef, contipayData.contipayRef);
  assert.equal(saleData.totalSaleUsd, 4.4);

  // Verify contipay_transactions table linked to document
  const txRow = db
    .prepare('SELECT document_id, status, reference FROM contipay_transactions WHERE reference = ?')
    .get(contipayData.contipayRef) as { document_id: number; status: string; reference: string };
  assert.equal(txRow.document_id, saleData.document.id);
  assert.equal(txRow.status, 'COMPLETED');
});
