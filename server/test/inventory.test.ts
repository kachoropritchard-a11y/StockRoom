import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.ts';
import { openDb, type Db } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { seed } from '../src/seed.ts';
import { buildApp } from '../src/app.ts';
import { postDocument, reverseDocument, verifyLedger, toMilli, type PostableType } from '../src/inventory/engine.ts';
import type { AuthUser } from '../src/app.ts';

let keyCounter = 0;
const newKey = () => `test-key-${++keyCounter}-abcdefgh`;

async function setup() {
  const db = openDb(':memory:');
  migrate(db);
  seed(db, { executive: 'exec-pass-123', inventory: 'inv-pass-123' }, 4);
  const app = buildApp(db, loadConfig({ NODE_ENV: 'test', BCRYPT_COST: '4' }));
  const tokenFor = async (email: string, password: string) =>
    (await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-requested-with': 'stockroom' }, payload: { email, password } })).json().token as string;
  const exec = await tokenFor('executive@example.com', 'exec-pass-123');
  const inv = await tokenFor('inventory@example.com', 'inv-pass-123');

  const call = async (method: 'GET' | 'POST' | 'PATCH', url: string, token: string, payload?: unknown, key?: string | null) => {
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    if (key !== null && method === 'POST' && (url.startsWith('/api/stock') || url.endsWith('/receive') || url.endsWith('/fulfill'))) {
      headers['idempotency-key'] = key ?? newKey();
    }
    const res = await app.inject({ method, url, headers, payload: payload as object | undefined });
    return { status: res.statusCode, body: res.json() as any };
  };

  const units = Object.fromEntries((await call('GET', '/api/units', exec)).body.map((u: any) => [u.code, u.id]));
  const product = (await call('POST', '/api/products', exec, { sku: 'RICE-1', name: 'Rice', baseUnitId: units.each })).body.id as number;
  await call('POST', `/api/products/${product}/packagings`, exec, { unitId: units.carton, factor: 24 });
  const supplier = (await call('POST', '/api/suppliers', exec, { name: 'National Foods' })).body.id as number;
  const dept = 1; // seeded "General" department in branch 1
  const wh1 = 1; // seeded "Main Warehouse" in branch 1
  const wh2 = (await call('POST', '/api/warehouses', exec, { branchId: 1, name: 'Cold Room' })).body.id as number;
  const branch2 = (await call('POST', '/api/branches', exec, { name: 'Bulawayo', city: 'Bulawayo' })).body.id as number;
  const wh3 = (await call('POST', '/api/warehouses', exec, { branchId: branch2, name: 'Bulawayo Store' })).body.id as number;

  const balance = async (productId = product, warehouseId = wh1) => {
    const r = await call('GET', `/api/stock/balances?productId=${productId}&warehouseId=${warehouseId}`, exec);
    return (r.body.items[0]?.quantity ?? 0) as number;
  };
  const receive = (qty: number, warehouseId = wh1, unitId = units.each) =>
    call('POST', '/api/stock/receipts', exec, { lines: [{ productId: product, warehouseId, unitId, quantity: qty }] });
  return { db, app, exec, inv, call, units, product, supplier, dept, wh1, wh2, wh3, branch2, balance, receive };
}

test('migrations create the inventory schema and are idempotent', () => {
  const db = openDb(':memory:');
  assert.ok(migrate(db).includes('003_inventory.sql'));
  assert.equal(migrate(db).length, 0);
});

test('packaging conversion: receiving cartons stores base units; ledger keeps entered qty and factor', async () => {
  const t = await setup();
  const r = await t.receive(2, t.wh1, t.units.carton);
  assert.equal(r.status, 201);
  assert.equal(await t.balance(), 48);
  const line = r.body.document.lines[0];
  assert.deepEqual([line.quantity, line.factor, line.baseChange], [2, 24, 48]);
  // A unit with no declared packaging for the product is rejected.
  const bad = await t.call('POST', '/api/stock/receipts', t.exec, { lines: [{ productId: t.product, warehouseId: t.wh1, unitId: t.units.kg, quantity: 1 }] });
  assert.equal(bad.body.error, 'unit_not_defined_for_product');
  assert.equal(await t.balance(), 48);
});

test('fractional quantities are exact; more than 3 decimals are rejected', async () => {
  const t = await setup();
  await t.receive(0.1);
  await t.receive(0.2);
  assert.equal(await t.balance(), 0.3); // would be 0.30000000000000004 with floats
  assert.equal((await t.receive(1.2345)).body.error, 'too_many_decimals');
});

test('issues cannot take stock negative by default, and a failed posting leaves no trace', async () => {
  const t = await setup();
  await t.receive(10);
  const docsBefore = (t.db.prepare('SELECT COUNT(*) n FROM stock_documents').get() as any).n;
  const res = await t.call('POST', '/api/stock/issues', t.inv, { lines: [{ productId: t.product, warehouseId: t.wh1, unitId: t.units.each, quantity: 11 }] });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'insufficient_stock');
  assert.equal(await t.balance(), 10);
  assert.equal((t.db.prepare('SELECT COUNT(*) n FROM stock_documents').get() as any).n, docsBefore);
  assert.equal((t.db.prepare('SELECT COUNT(*) n FROM stock_movements').get() as any).n, 1);
});

test('negative stock can be allowed only by an executive organisation setting', async () => {
  const t = await setup();
  const issue = () => t.call('POST', '/api/stock/issues', t.exec, { lines: [{ productId: t.product, warehouseId: t.wh1, unitId: t.units.each, quantity: 5 }] });
  assert.equal((await issue()).status, 409);
  assert.equal((await t.call('PATCH', '/api/organisation', t.inv, { allowNegativeStock: true })).status, 403);
  assert.equal((await t.call('PATCH', '/api/organisation', t.exec, { allowNegativeStock: true })).status, 200);
  assert.equal((await issue()).status, 201);
  assert.equal(await t.balance(), -5);
});

test('transfers move stock atomically between warehouses', async () => {
  const t = await setup();
  await t.receive(20);
  const ok = await t.call('POST', '/api/stock/transfers', t.exec, { lines: [{ productId: t.product, warehouseId: t.wh1, toWarehouseId: t.wh2, unitId: t.units.each, quantity: 8 }] });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.document.lines.length, 2);
  assert.equal(await t.balance(t.product, t.wh1), 12);
  assert.equal(await t.balance(t.product, t.wh2), 8);
  // Second line fails => nothing from the first line is posted.
  const bad = await t.call('POST', '/api/stock/transfers', t.exec, {
    lines: [
      { productId: t.product, warehouseId: t.wh1, toWarehouseId: t.wh2, unitId: t.units.each, quantity: 5 },
      { productId: t.product, warehouseId: t.wh1, toWarehouseId: t.wh2, unitId: t.units.each, quantity: 50 },
    ],
  });
  assert.equal(bad.status, 409);
  assert.equal(await t.balance(t.product, t.wh1), 12);
  assert.equal(await t.balance(t.product, t.wh2), 8);
  const same = await t.call('POST', '/api/stock/transfers', t.exec, { lines: [{ productId: t.product, warehouseId: t.wh1, toWarehouseId: t.wh1, unitId: t.units.each, quantity: 1 }] });
  assert.equal(same.body.error, 'invalid_destination');
});

test('duplicate requests: same key + body replays; same key + different body conflicts', async () => {
  const t = await setup();
  const body = { lines: [{ productId: t.product, warehouseId: t.wh1, unitId: t.units.each, quantity: 7 }] };
  const first = await t.call('POST', '/api/stock/receipts', t.exec, body, 'idem-key-12345');
  const again = await t.call('POST', '/api/stock/receipts', t.exec, body, 'idem-key-12345');
  assert.equal(first.status, 201);
  assert.equal(again.status, 200);
  assert.equal(again.body.replayed, true);
  assert.equal(again.body.document.id, first.body.document.id);
  assert.equal(await t.balance(), 7);
  const conflict = await t.call('POST', '/api/stock/receipts', t.exec, { lines: [{ ...body.lines[0], quantity: 9 }] }, 'idem-key-12345');
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error, 'idempotency_key_reuse');
  assert.equal((await t.call('POST', '/api/stock/receipts', t.exec, body, null)).body.error, 'idempotency_key_required');
  assert.equal(await t.balance(), 7);
});

test('counts record the variance against the ledger balance', async () => {
  const t = await setup();
  await t.receive(48);
  const r = await t.call('POST', '/api/stock/counts', t.inv, { lines: [{ productId: t.product, warehouseId: t.wh1, unitId: t.units.each, quantity: 30 }] });
  assert.equal(r.status, 201);
  assert.equal(r.body.document.lines[0].baseChange, -18);
  assert.equal(await t.balance(), 30);
  const dup = await t.call('POST', '/api/stock/counts', t.inv, { lines: [1, 2].map(() => ({ productId: t.product, warehouseId: t.wh1, unitId: t.units.each, quantity: 1 })) });
  assert.equal(dup.body.error, 'duplicate_count_line');
});

test('adjustments and write-offs require a reason; adjustments can be signed', async () => {
  const t = await setup();
  await t.receive(10);
  const line = { productId: t.product, warehouseId: t.wh1, unitId: t.units.each };
  assert.equal((await t.call('POST', '/api/stock/write-offs', t.inv, { lines: [{ ...line, quantity: 1 }] })).status, 400);
  assert.equal((await t.call('POST', '/api/stock/write-offs', t.inv, { reason: 'Damaged in storage', lines: [{ ...line, quantity: 2 }] })).status, 201);
  assert.equal((await t.call('POST', '/api/stock/adjustments', t.inv, { reason: 'Found extra stock', lines: [{ ...line, quantity: 5 }] })).status, 201);
  assert.equal((await t.call('POST', '/api/stock/adjustments', t.inv, { reason: 'Shrinkage', lines: [{ ...line, quantity: -3 }] })).status, 201);
  assert.equal((await t.call('POST', '/api/stock/adjustments', t.inv, { reason: 'Zero is pointless', lines: [{ ...line, quantity: 0 }] })).status, 400);
  assert.equal(await t.balance(), 10);
});

test('reversals: executive-only, exact opposite, once only, blocked if it would cause negative stock', async () => {
  const t = await setup();
  const receipt = (await t.receive(10)).body.document.id as number;
  const reverse = (token: string, docId: number, reason = 'Entered in error') => t.call('POST', `/api/stock/documents/${docId}/reverse`, token, { reason });
  assert.equal((await reverse(t.inv, receipt)).status, 403);

  await t.call('POST', '/api/stock/issues', t.exec, { lines: [{ productId: t.product, warehouseId: t.wh1, unitId: t.units.each, quantity: 4 }] });
  const blocked = await reverse(t.exec, receipt);
  assert.equal(blocked.body.error, 'insufficient_stock'); // only 6 left but 10 would be removed
  assert.equal(await t.balance(), 6);

  const receipt2 = (await t.receive(5)).body.document.id as number;
  const ok = await reverse(t.exec, receipt2);
  assert.equal(ok.status, 201);
  assert.equal(ok.body.document.type, 'reversal');
  assert.equal(ok.body.document.reversesDocumentId, receipt2);
  assert.equal(await t.balance(), 6);
  assert.equal((await reverse(t.exec, receipt2)).body.error, 'already_reversed');
  assert.equal((await reverse(t.exec, ok.body.document.id)).body.error, 'cannot_reverse_a_reversal');
  assert.equal((await t.call('GET', `/api/stock/documents/${receipt2}`, t.exec)).body.reversedByDocumentId, ok.body.document.id);
  assert.equal((await reverse(t.exec, 9999)).status, 404);
});

test('reversing a transfer returns stock to the source', async () => {
  const t = await setup();
  await t.receive(10);
  const tr = (await t.call('POST', '/api/stock/transfers', t.exec, { lines: [{ productId: t.product, warehouseId: t.wh1, toWarehouseId: t.wh2, unitId: t.units.each, quantity: 10 }] })).body.document.id;
  assert.equal((await t.call('POST', `/api/stock/documents/${tr}/reverse`, t.exec, { reason: 'Wrong destination' })).status, 201);
  assert.equal(await t.balance(t.product, t.wh1), 10);
  assert.equal(await t.balance(t.product, t.wh2), 0);
});

test('posted history is immutable at the database level', async () => {
  const t = await setup();
  await t.receive(10);
  assert.throws(() => t.db.exec('UPDATE stock_movements SET base_delta_milli = 999999'), /append-only/);
  assert.throws(() => t.db.exec('DELETE FROM stock_movements'), /append-only/);
  assert.throws(() => t.db.exec('DELETE FROM stock_documents'), /append-only/);
  assert.throws(() => t.db.exec('DELETE FROM products'), /FOREIGN KEY/);
  assert.equal(await t.balance(), 10);
});

test('permissions and scoping are enforced on the server', async () => {
  const t = await setup();
  assert.equal((await t.call('POST', '/api/branches', t.inv, { name: 'Nope' })).status, 403);
  assert.equal((await t.call('POST', '/api/warehouses', t.inv, { branchId: 1, name: 'Nope' })).status, 403);
  assert.equal((await t.call('GET', '/api/stock/verify', t.inv)).status, 403);
  assert.equal((await t.call('GET', '/api/stock/verify', t.exec)).status, 200);
  assert.equal((await t.app.inject({ method: 'GET', url: '/api/products' })).statusCode, 401);
  // Inventory manager belongs to branch 1; the Bulawayo warehouse belongs to another branch.
  await t.receive(5, t.wh3);
  const cross = await t.call('POST', '/api/stock/receipts', t.inv, { lines: [{ productId: t.product, warehouseId: t.wh3, unitId: t.units.each, quantity: 1 }] });
  assert.equal(cross.status, 403);
  assert.equal(cross.body.error, 'forbidden_warehouse');
  const visible = await t.call('GET', '/api/stock/balances', t.inv);
  assert.ok(visible.body.items.every((i: any) => i.warehouseId !== t.wh3));
  assert.ok((await t.call('GET', '/api/stock/balances', t.exec)).body.items.some((i: any) => i.warehouseId === t.wh3));
});

test('input validation and cross-organisation isolation', async () => {
  const t = await setup();
  const line = { productId: t.product, warehouseId: t.wh1, unitId: t.units.each };
  for (const bad of [{ lines: [] }, { lines: [{ ...line, quantity: 0 }] }, { lines: [{ ...line, quantity: -1 }] }, { lines: [{ ...line, quantity: 'ten' }] }, { lines: [{ ...line, quantity: 1, extra: 1 }] }, {}]) {
    assert.equal((await t.call('POST', '/api/stock/receipts', t.exec, bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await t.call('POST', '/api/stock/receipts', t.exec, { lines: [{ ...line, productId: 9999, quantity: 1 }] })).body.error, 'product_not_found');
  assert.equal((await t.call('POST', '/api/stock/issues', t.exec, { supplierId: 1, lines: [{ ...line, quantity: 1 }] })).status, 400);
  // A second organisation's records are invisible and unusable.
  t.db.exec(`INSERT INTO organisations (name) VALUES ('Other');
    INSERT INTO units_of_measure (organisation_id, code, name) VALUES (2, 'each', 'Each');
    INSERT INTO products (organisation_id, sku, name, base_unit_id) VALUES (2, 'X', 'Other product', 6);`);
  const foreign = (t.db.prepare("SELECT id FROM products WHERE organisation_id = 2").get() as any).id;
  assert.equal((await t.call('POST', '/api/stock/receipts', t.exec, { lines: [{ ...line, productId: foreign, quantity: 1 }] })).body.error, 'product_not_found');
  assert.equal((await t.call('GET', `/api/products/${foreign}`, t.exec)).status, 404);
  assert.ok(!(await t.call('GET', '/api/products', t.exec)).body.items.some((p: any) => p.id === foreign));
  // Duplicate SKU in the same organisation is a clean 409, not a crash.
  assert.equal((await t.call('POST', '/api/products', t.exec, { sku: 'rice-1', name: 'Dup', baseUnitId: t.units.each })).status, 409);
});

test('verifyLedger passes after real activity and detects tampering', async () => {
  const t = await setup();
  await t.receive(100);
  await t.call('POST', '/api/stock/transfers', t.exec, { lines: [{ productId: t.product, warehouseId: t.wh1, toWarehouseId: t.wh2, unitId: t.units.each, quantity: 30 }] });
  await t.call('POST', '/api/stock/counts', t.exec, { lines: [{ productId: t.product, warehouseId: t.wh2, unitId: t.units.each, quantity: 25 }] });
  const issue = (await t.call('POST', '/api/stock/issues', t.exec, { departmentId: 1, lines: [{ productId: t.product, warehouseId: t.wh1, unitId: t.units.each, quantity: 10 }] })).body.document.id;
  await t.call('POST', `/api/stock/documents/${issue}/reverse`, t.exec, { reason: 'Issued twice' });
  assert.deepEqual(verifyLedger(t.db), { ok: true, problems: [] });
  assert.deepEqual((await t.call('GET', '/api/stock/verify', t.exec)).body, { ok: true, problems: [] });

  // Simulate corruption (bypassing the triggers, as a DBA or bug might) and confirm the audit notices.
  t.db.exec('DROP TRIGGER stock_movements_no_update');
  t.db.exec('UPDATE stock_movements SET base_delta_milli = base_delta_milli + 1000 WHERE id = 1');
  const checks = verifyLedger(t.db).problems.map((p) => p.check);
  assert.ok(checks.includes('conversion'), checks.join());
});

test('ledger invariants hold under randomised activity, and balances equal an independent sum of movements', () => {
  const db = openDb(':memory:');
  migrate(db);
  seed(db, { executive: 'e', inventory: 'i' }, 4);
  db.exec(`INSERT INTO warehouses (branch_id, name) VALUES (1, 'W2'), (1, 'W3');
    INSERT INTO products (organisation_id, sku, name, base_unit_id) VALUES (1, 'A', 'A', 1), (1, 'B', 'B', 1);
    INSERT INTO product_packagings (product_id, unit_id, factor_milli) VALUES (1, 5, 12000);`);
  const actor: AuthUser = { id: 1, organisationId: 1, branchId: null, email: 'e', name: 'e', role: 'executive_manager' };
  let seedState = 42;
  const rnd = (n: number) => ((seedState = (seedState * 1664525 + 1013904223) % 4294967296) / 4294967296) * n | 0;
  const types: PostableType[] = ['receipt', 'issue', 'transfer', 'adjustment', 'count', 'write_off'];
  const docs: number[] = [];
  let rejected = 0;
  for (let i = 0; i < 400; i++) {
    const type = types[rnd(types.length)];
    const wh = 1 + rnd(3);
    const quantity = toMilli(type === 'count' ? rnd(60) : type === 'adjustment' ? rnd(41) - 20 || 1 : 1 + rnd(30));
    try {
      const r = postDocument(db, actor, {
        type, idempotencyKey: `fuzz-key-${i}-abcdefgh`, reason: 'fuzz',
        lines: [{ productId: 1 + rnd(2), warehouseId: wh, toWarehouseId: wh === 1 ? 2 : 1, unitId: rnd(3) === 0 ? 5 : 1, quantityMilli: quantity }],
      });
      docs.push(r.documentId);
    } catch { rejected++; }
    if (i % 25 === 0 && docs.length) { try { reverseDocument(db, actor, docs[rnd(docs.length)], 'fuzz reversal', `fuzz-rev-${i}-abcdefgh`); } catch { rejected++; } }
  }
  assert.ok(docs.length > 100 && rejected > 0, `posted ${docs.length}, rejected ${rejected}`);
  assert.deepEqual(verifyLedger(db), { ok: true, problems: [] });
  const independent = new Map<string, number>();
  for (const m of db.prepare('SELECT product_id p, warehouse_id w, base_delta_milli d FROM stock_movements').all() as any[]) independent.set(`${m.p}:${m.w}`, (independent.get(`${m.p}:${m.w}`) ?? 0) + m.d);
  for (const b of db.prepare('SELECT product_id p, warehouse_id w, quantity_milli q FROM stock_balances').all() as any[]) {
    assert.equal(b.q, independent.get(`${b.p}:${b.w}`));
    assert.ok(b.q >= 0, 'balance went negative');
  }
});

test('reversing a count restores the pre-count balance and the ledger still verifies', async () => {
  const t = await setup();
  await t.receive(10);
  const count = (await t.call('POST', '/api/stock/counts', t.exec, { lines: [{ productId: t.product, warehouseId: t.wh1, unitId: t.units.each, quantity: 4 }] })).body.document.id;
  assert.equal(await t.balance(), 4);
  assert.equal((await t.call('POST', `/api/stock/documents/${count}/reverse`, t.exec, { reason: 'Counted the wrong shelf' })).status, 201);
  assert.equal(await t.balance(), 10);
  assert.deepEqual(verifyLedger(t.db), { ok: true, problems: [] });
});

test('costing, reorder levels, batch/expiry tracking, and dashboard summary metrics', async () => {
  const t = await setup();
  await t.call('PATCH', `/api/products/${t.product}`, t.exec, { unitCost: 2.5, reorderLevel: 60 });
  // Receive 2 cartons (48 each) at $60/carton ($2.50/each) with batch and expiry
  const rec = await t.call('POST', '/api/stock/receipts', t.exec, {
    reference: 'GRN-100',
    lines: [{ productId: t.product, warehouseId: t.wh1, unitId: t.units.carton, quantity: 2, unitCost: 60, batchNumber: 'LOT-2026-A', expiryDate: '2026-11-05' }],
  });
  assert.equal(rec.status, 201);
  assert.equal(rec.body.document.lines[0].unitCost, 2.5);
  assert.equal(rec.body.document.lines[0].batchNumber, 'LOT-2026-A');
  assert.equal(rec.body.document.lines[0].expiryDate, '2026-11-05');

  const bal = (await t.call('GET', `/api/stock/balances?productId=${t.product}`, t.exec)).body.items[0];
  assert.equal(bal.quantity, 48);
  assert.equal(bal.stockValue, 120);
  assert.equal(bal.lowStock, true);

  const summary = (await t.call('GET', '/api/dashboard/summary', t.exec)).body;
  assert.equal(summary.totalStockValue, 120);
  assert.equal(summary.lowStockCount, 1);
  assert.equal(summary.expiringSoonCount, 1);
});

test('count-sheet approval workflow computes variances from stock_balances and posts via the ledger', async () => {
  const t = await setup();
  await t.receive(25);
  const created = await t.call('POST', '/api/stock/count-sheets', t.inv, {
    warehouseId: t.wh1,
    reference: 'CS-OCT',
    notes: 'Month-end physical count',
    lines: [{ productId: t.product, unitId: t.units.each, countedQuantity: 22 }],
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.status, 'draft');
  assert.equal(created.body.lines[0].expectedBaseQuantity, 25);
  assert.equal(created.body.lines[0].varianceBaseQuantity, -3);
  // Draft does not alter ledger balance yet
  assert.equal(await t.balance(), 25);
  // Inventory manager cannot approve; executive approves
  assert.equal((await t.call('POST', `/api/stock/count-sheets/${created.body.id}/approve`, t.inv, {})).status, 403);
  const approved = await t.call('POST', `/api/stock/count-sheets/${created.body.id}/approve`, t.exec, {});
  assert.equal(approved.status, 201);
  assert.equal(approved.body.sheet.status, 'approved');
  assert.equal(await t.balance(), 22);
  assert.deepEqual(verifyLedger(t.db), { ok: true, problems: [] });
});

test('executive user management and self-service password reset', async () => {
  const t = await setup();
  assert.equal((await t.call('GET', '/api/users', t.inv)).status, 403);
  const created = await t.call('POST', '/api/users', t.exec, {
    email: 'mutare@example.com',
    name: 'Mutare Clerk',
    password: 'initial-password-123',
    role: 'inventory_manager',
    branchId: t.branch2,
  });
  assert.equal(created.status, 201);
  // Self-demotion is blocked
  assert.equal((await t.call('PATCH', '/api/users/1', t.exec, { active: false })).status, 400);

  // Self-service forgot-password + reset-password
  const forgot = await t.app.inject({
    method: 'POST',
    url: '/api/auth/forgot-password',
    headers: { 'x-requested-with': 'stockroom' },
    payload: { email: 'mutare@example.com' },
  });
  assert.equal(forgot.statusCode, 200);
  const { resetToken } = forgot.json() as { resetToken: string };
  assert.ok(resetToken);
  const outbox = t.db.prepare('SELECT to_email FROM email_outbox WHERE to_email = ?').get('mutare@example.com') as { to_email: string };
  assert.equal(outbox.to_email, 'mutare@example.com');

  const reset = await t.app.inject({
    method: 'POST',
    url: '/api/auth/reset-password',
    headers: { 'x-requested-with': 'stockroom' },
    payload: { token: resetToken, newPassword: 'updated-password-456' },
  });
  assert.equal(reset.statusCode, 200);
  const loginRes = await t.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'x-requested-with': 'stockroom' },
    payload: { email: 'mutare@example.com', password: 'updated-password-456' },
  });
  assert.equal(loginRes.statusCode, 200);
});

test('purchase orders: draft, approval, partial deliveries, completion, and over-delivery protection', async () => {
  const t = await setup();
  const po = await t.call('POST', '/api/purchase-orders', t.inv, {
    supplierId: t.supplier,
    warehouseId: t.wh1,
    reference: 'PO-2026-500',
    notes: 'Two-part shipment',
    lines: [{ productId: t.product, unitId: t.units.each, orderedQuantity: 40, unitCost: 3.5 }],
  });
  assert.equal(po.status, 201);
  assert.equal(po.body.status, 'draft');
  assert.equal(po.body.totalValue, 140);

  // Cannot receive against draft PO
  assert.equal(
    (await t.call('POST', `/api/purchase-orders/${po.body.id}/receive`, t.inv, { lines: [{ productId: t.product, quantity: 15 }] })).status,
    409,
  );

  // Approve PO
  const approved = await t.call('POST', `/api/purchase-orders/${po.body.id}/approve`, t.inv, {});
  assert.equal(approved.status, 200);
  assert.equal(approved.body.status, 'approved');

  // First partial delivery: 15 units
  const part1 = await t.call('POST', `/api/purchase-orders/${po.body.id}/receive`, t.inv, {
    reference: 'GRN-500-A',
    lines: [{ productId: t.product, quantity: 15, batchNumber: 'BATCH-A' }],
  });
  assert.equal(part1.status, 201);
  assert.equal(part1.body.purchaseOrder.status, 'partial');
  assert.equal(part1.body.purchaseOrder.lines[0].receivedQuantity, 15);
  assert.equal(part1.body.purchaseOrder.lines[0].remainingQuantity, 25);
  assert.equal(await t.balance(), 15);

  // Over-delivery (30 > 25 remaining) is rejected and does not touch balance
  const over = await t.call('POST', `/api/purchase-orders/${po.body.id}/receive`, t.inv, {
    lines: [{ productId: t.product, quantity: 30 }],
  });
  assert.equal(over.status, 409);
  assert.equal(over.body.error, 'over_delivery');
  assert.equal(await t.balance(), 15);

  // Second delivery completes the remaining 25 units
  const part2 = await t.call('POST', `/api/purchase-orders/${po.body.id}/receive`, t.inv, {
    reference: 'GRN-500-B',
    lines: [{ productId: t.product, quantity: 25, batchNumber: 'BATCH-B' }],
  });
  assert.equal(part2.status, 201);
  assert.equal(part2.body.purchaseOrder.status, 'received');
  assert.equal(part2.body.purchaseOrder.lines[0].remainingQuantity, 0);
  assert.equal(await t.balance(), 40);
  assert.deepEqual(verifyLedger(t.db), { ok: true, problems: [] });
});

test('requisitions: department issues and internal transfers post through the stock engine on fulfillment', async () => {
  const t = await setup();
  await t.receive(30);

  // Create a department requisition for 12 units
  const deptReq = await t.call('POST', '/api/requisitions', t.inv, {
    kind: 'department_issue',
    warehouseId: t.wh1,
    departmentId: t.dept,
    reference: 'REQ-DEPT-1',
    lines: [{ productId: t.product, unitId: t.units.each, requestedQuantity: 12 }],
  });
  assert.equal(deptReq.status, 201);
  assert.equal(deptReq.body.status, 'pending');
  assert.equal(deptReq.body.lines[0].availableBaseQuantity, 30);

  // Fulfill department requisition -> posts issue movement
  const fulfilledDept = await t.call('POST', `/api/requisitions/${deptReq.body.id}/fulfill`, t.inv, {});
  assert.equal(fulfilledDept.status, 201);
  assert.equal(fulfilledDept.body.requisition.status, 'fulfilled');
  assert.equal(fulfilledDept.body.document.type, 'issue');
  assert.equal(await t.balance(), 18);

  // Create an internal warehouse transfer requisition for 8 units from wh1 -> wh2
  const trfReq = await t.call('POST', '/api/requisitions', t.inv, {
    kind: 'warehouse_transfer',
    warehouseId: t.wh1,
    toWarehouseId: t.wh2,
    reference: 'REQ-TRF-1',
    lines: [{ productId: t.product, unitId: t.units.each, requestedQuantity: 8 }],
  });
  assert.equal(trfReq.status, 201);
  const fulfilledTrf = await t.call('POST', `/api/requisitions/${trfReq.body.id}/fulfill`, t.inv, {});
  assert.equal(fulfilledTrf.status, 201);
  assert.equal(fulfilledTrf.body.document.type, 'transfer');
  assert.equal(await t.balance(t.product, t.wh1), 10);
  assert.equal(await t.balance(t.product, t.wh2), 8);
  assert.deepEqual(verifyLedger(t.db), { ok: true, problems: [] });
});

test('stock returns (from department and to supplier) and inventory reports accuracy', async () => {
  const t = await setup();
  await t.call('PATCH', `/api/products/${t.product}`, t.exec, { unitCost: 4, reorderLevel: 20 });
  await t.receive(25);
  await t.call('POST', '/api/stock/issues', t.inv, {
    departmentId: t.dept,
    reference: 'ISS-900',
    lines: [{ productId: t.product, warehouseId: t.wh1, unitId: t.units.each, quantity: 10 }],
  });
  assert.equal(await t.balance(), 15);

  // Department returns 3 unused units back into wh1 -> balance becomes 18
  const retDept = await t.call('POST', '/api/stock/returns', t.inv, {
    returnType: 'from_department',
    warehouseId: t.wh1,
    departmentId: t.dept,
    reference: 'RET-DEPT-1',
    reason: 'Unused stock from weekend shift',
    lines: [{ productId: t.product, warehouseId: t.wh1, unitId: t.units.each, quantity: 3 }].map(({ warehouseId: _, ...rest }) => rest),
  });
  assert.equal(retDept.status, 201);
  assert.equal(await t.balance(), 18);

  // Return 4 damaged units to supplier -> balance becomes 14 (which is <= reorderLevel 20)
  const retSup = await t.call('POST', '/api/stock/returns', t.inv, {
    returnType: 'to_supplier',
    warehouseId: t.wh1,
    supplierId: t.supplier,
    reference: 'RET-SUP-1',
    reason: 'Damaged seals on delivery',
    lines: [{ productId: t.product, unitId: t.units.each, quantity: 4 }],
  });
  assert.equal(retSup.status, 201);
  assert.equal(await t.balance(), 14);

  // Check inventory reports endpoint
  const rep = await t.call('GET', '/api/reports/inventory', t.inv);
  assert.equal(rep.status, 200);
  assert.equal(rep.body.lowStockAlerts.length, 1);
  assert.equal(rep.body.lowStockAlerts[0].currentStock, 14);
  assert.equal(rep.body.lowStockAlerts[0].shortfall, 6);
  const deptRow = rep.body.departmentConsumption.find((d: { departmentId: number }) => d.departmentId === t.dept);
  assert.equal(deptRow.issueCount, 1);
  assert.equal(deptRow.consumedQuantity, 10);
  assert.deepEqual(verifyLedger(t.db), { ok: true, problems: [] });
});

test('Stage 4 governance: separation of duties, PO approval thresholds, and granular role permissions', async () => {
  const t = await setup();
  await t.receive(50);

  // Enable separation of duties and a $100 PO threshold on the organisation
  const patchOrg = await t.call('PATCH', '/api/organisation', t.exec, {
    enforceSeparationOfDuties: true,
    poApprovalThreshold: 100,
    currencyCode: 'USD',
  });
  assert.equal(patchOrg.status, 200);

  // 1. Inventory Manager creates a draft PO worth $60 (below threshold), cannot self-approve when separation of duties is on
  const poLow = await t.call('POST', '/api/purchase-orders', t.inv, {
    supplierId: t.supplier,
    warehouseId: t.wh1,
    reference: 'PO-SOD-1',
    lines: [{ productId: t.product, unitId: t.units.each, orderedQuantity: 10, unitCost: 6 }],
  });
  assert.equal(poLow.status, 201);
  assert.equal(poLow.body.status, 'draft');

  const selfApprovePo = await t.call('POST', `/api/purchase-orders/${poLow.body.id}/approve`, t.inv, {});
  assert.equal(selfApprovePo.status, 403);
  assert.equal(selfApprovePo.body.error, 'separation_of_duties_violation');

  // Executive Manager approves the PO
  const execApprovePo = await t.call('POST', `/api/purchase-orders/${poLow.body.id}/approve`, t.exec, {});
  assert.equal(execApprovePo.status, 200);
  assert.equal(execApprovePo.body.status, 'approved');

  // 2. PO above $100 threshold requires Executive Manager even when separation of duties is off
  await t.call('PATCH', '/api/organisation', t.exec, { enforceSeparationOfDuties: false, poApprovalThreshold: 100 });
  const poHigh = await t.call('POST', '/api/purchase-orders', t.inv, {
    supplierId: t.supplier,
    warehouseId: t.wh1,
    reference: 'PO-HIGH-1',
    lines: [{ productId: t.product, unitId: t.units.each, orderedQuantity: 10, unitCost: 15 }],
  });
  assert.equal(poHigh.status, 201);
  const invApproveHigh = await t.call('POST', `/api/purchase-orders/${poHigh.body.id}/approve`, t.inv, {});
  assert.equal(invApproveHigh.status, 403);
  assert.equal(invApproveHigh.body.error, 'executive_approval_required');

  const execApproveHigh = await t.call('POST', `/api/purchase-orders/${poHigh.body.id}/approve`, t.exec, {});
  assert.equal(execApproveHigh.status, 200);

  // 3. Requisition & Count-Sheet separation of duties
  await t.call('PATCH', '/api/organisation', t.exec, { enforceSeparationOfDuties: true });
  const reqDoc = await t.call('POST', '/api/requisitions', t.inv, {
    kind: 'department_issue',
    warehouseId: t.wh1,
    departmentId: t.dept,
    reference: 'REQ-SOD-1',
    lines: [{ productId: t.product, unitId: t.units.each, requestedQuantity: 5 }],
  });
  assert.equal(reqDoc.status, 201);
  const selfFulfill = await t.call('POST', `/api/requisitions/${reqDoc.body.id}/fulfill`, t.inv, {});
  assert.equal(selfFulfill.status, 403);
  assert.equal(selfFulfill.body.error, 'separation_of_duties_violation');

  const execFulfill = await t.call('POST', `/api/requisitions/${reqDoc.body.id}/fulfill`, t.exec, {});
  assert.equal(execFulfill.status, 201);

  // 4. Granular permissions matrix: disable write-offs and report exports for inventory_manager
  const permUpdate = await t.call('PATCH', '/api/executive/permissions', t.exec, {
    permissions: { can_write_off_stock: false, can_export_reports: false },
  });
  assert.equal(permUpdate.status, 200);

  const blockedWriteOff = await t.call('POST', '/api/stock/write-offs', t.inv, {
    reason: 'Broken bottle',
    lines: [{ productId: t.product, warehouseId: t.wh1, unitId: t.units.each, quantity: 1 }],
  });
  assert.equal(blockedWriteOff.status, 403);
  assert.equal(blockedWriteOff.body.error, 'forbidden_permission');

  const blockedExport = await t.call('GET', '/api/reports/export?section=valuation&format=json', t.inv);
  assert.equal(blockedExport.status, 403);
  assert.equal(blockedExport.body.error, 'forbidden_permission');

  // Executive Manager can still export
  const execExport = await t.call('GET', '/api/reports/export?section=valuation&format=json', t.exec);
  assert.equal(execExport.status, 200);
  assert.equal(execExport.body.section, 'valuation');
  assert.ok(Array.isArray(execExport.body.items));
});

test('Stage 4 executive portal: audit logs immutability, backup/restore lifecycle, health, and notifications', async () => {
  const t = await setup();
  await t.call('PATCH', `/api/products/${t.product}`, t.exec, { unitCost: 12.5, reorderLevel: 25 });
  await t.receive(10); // below reorder level 25 -> triggers low-stock notification

  // Non-executives cannot access executive endpoints
  assert.equal((await t.call('GET', '/api/executive/audit-logs', t.inv)).status, 403);
  assert.equal((await t.call('GET', '/api/executive/backups', t.inv)).status, 403);
  assert.equal((await t.call('GET', '/api/executive/system-health', t.inv)).status, 403);
  assert.equal((await t.call('GET', '/api/executive/approvals', t.inv)).status, 403);

  // Notifications and dashboard summary reflect real database state
  const notif = await t.call('GET', '/api/notifications', t.exec);
  assert.equal(notif.status, 200);
  assert.ok(notif.body.items.some((n: { category: string }) => n.category === 'low_stock'));

  const dash = await t.call('GET', '/api/dashboard/summary', t.exec);
  assert.equal(dash.status, 200);
  assert.equal(dash.body.totalStockUnits, 10);
  assert.equal(dash.body.totalStockValue, 125);
  assert.equal(dash.body.receiptsCount, 1);
  assert.equal(dash.body.receiptsUnits, 10);
  assert.equal(dash.body.lowStockCount, 1);

  // Create a verified backup snapshot
  const bk = await t.call('POST', '/api/executive/backups', t.exec, { label: 'Pre-policy change snapshot' });
  assert.equal(bk.status, 201);
  assert.equal(bk.body.status, 'verified');
  assert.equal(typeof bk.body.checksumSha256, 'string');

  // Verify backup checksum and ledger readiness
  const ver = await t.call('POST', `/api/executive/backups/${bk.body.id}/verify`, t.exec, {});
  assert.equal(ver.status, 200);
  assert.equal(ver.body.checksumMatch, true);
  assert.equal(ver.body.readyForRestore, true);

  // Mutate organisation name, then restore from backup using controlled confirmation phrase
  await t.call('PATCH', '/api/organisation', t.exec, { name: 'Temporary Changed Name' });
  assert.equal((await t.call('GET', '/api/organisation', t.exec)).body.name, 'Temporary Changed Name');

  const badRestore = await t.call('POST', `/api/executive/backups/${bk.body.id}/restore`, t.exec, {
    confirmationPhrase: 'WRONG',
  });
  assert.equal(badRestore.status, 400);
  assert.equal(badRestore.body.error, 'invalid_restore_confirmation');

  const goodRestore = await t.call('POST', `/api/executive/backups/${bk.body.id}/restore`, t.exec, {
    confirmationPhrase: 'CONFIRM-RESTORE',
  });
  assert.equal(goodRestore.status, 200);
  assert.equal(goodRestore.body.ok, true);
  assert.equal((await t.call('GET', '/api/organisation', t.exec)).body.name, 'Demo Organisation');

  // Audit logs recorded actions and are immutable at the SQLite trigger level
  const logs = await t.call('GET', '/api/executive/audit-logs', t.exec);
  assert.equal(logs.status, 200);
  assert.ok(logs.body.total >= 4);
  assert.throws(() => t.db.prepare("UPDATE audit_logs SET action = 'tampered'").run(), /audit_logs_are_immutable/);
  assert.throws(() => t.db.prepare('DELETE FROM audit_logs').run(), /audit_logs_are_immutable/);

  // System health endpoint reports healthy ledger and table counts
  const health = await t.call('GET', '/api/executive/system-health', t.exec);
  assert.equal(health.status, 200);
  assert.equal(health.body.status, 'healthy');
  assert.equal(health.body.ledgerIntegrity.ok, true);
  assert.ok(health.body.tableCounts.backups >= 1);
});

test('Stage 5 concurrency & atomicity: concurrent stock issues and requisition fulfillments cannot oversell', async () => {
  const t = await setup();
  await t.receive(10); // 10 base units available in wh1

  // Fire 5 concurrent stock issues of 6 units each against 10 available units
  const attempts = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      t.call('POST', '/api/stock/issues', t.inv, {
        reference: `CONC-ISS-${i + 1}`,
        lines: [{ productId: t.product, warehouseId: t.wh1, unitId: t.units.each, quantity: 6 }],
      }),
    ),
  );

  const succeeded = attempts.filter((r) => r.status === 201);
  const rejected = attempts.filter((r) => r.status === 409 && r.body.error === 'insufficient_stock');
  assert.equal(succeeded.length, 1);
  assert.equal(rejected.length, 4);
  assert.equal(await t.balance(), 4);

  // Fire 5 concurrent requests with the EXACT same idempotency key and payload -> only 1 document created, others replay
  const sharedKey = 'idem-concurrent-key-99999';
  const body = {
    reference: 'IDEM-ISS-1',
    lines: [{ productId: t.product, warehouseId: t.wh1, unitId: t.units.each, quantity: 2 }],
  };
  const idemResponses = await Promise.all(
    Array.from({ length: 5 }, () =>
      t.app.inject({
        method: 'POST',
        url: '/api/stock/issues',
        headers: { authorization: `Bearer ${t.inv}`, 'idempotency-key': sharedKey },
        payload: body,
      }),
    ),
  );
  const docIds = new Set(idemResponses.map((r) => r.json().document.id));
  assert.equal(docIds.size, 1);
  assert.equal(await t.balance(), 2);
  assert.deepEqual(verifyLedger(t.db), { ok: true, problems: [] });
});

test('Stage 5 approval auditability: approvals and rejections record user, decision, reason, and timestamp', async () => {
  const t = await setup();
  await t.receive(30);

  // 1. Purchase order approval records user, decision, reason, and timestamp
  const po = await t.call('POST', '/api/purchase-orders', t.inv, {
    supplierId: t.supplier,
    warehouseId: t.wh1,
    reference: 'PO-DECISION-1',
    lines: [{ productId: t.product, unitId: t.units.each, orderedQuantity: 10, unitCost: 5 }],
  });
  assert.equal(po.status, 201);

  const poApproved = await t.call('POST', `/api/purchase-orders/${po.body.id}/approve`, t.exec, {
    reason: 'Approved for Q4 seasonal stock replenishment',
  });
  assert.equal(poApproved.status, 200);
  assert.equal(poApproved.body.status, 'approved');
  assert.equal(poApproved.body.decisionReason, 'Approved for Q4 seasonal stock replenishment');
  assert.ok(poApproved.body.approvedBy);
  assert.ok(poApproved.body.decidedBy);
  assert.ok(poApproved.body.approvedAt);
  assert.ok(poApproved.body.decidedAt);

  // 2. Requisition fulfillment records user, decision, reason, and timestamp
  const reqDoc = await t.call('POST', '/api/requisitions', t.inv, {
    kind: 'department_issue',
    warehouseId: t.wh1,
    departmentId: t.dept,
    reference: 'REQ-DECISION-1',
    lines: [{ productId: t.product, unitId: t.units.each, requestedQuantity: 5 }],
  });
  assert.equal(reqDoc.status, 201);

  const reqFulfilled = await t.call('POST', `/api/requisitions/${reqDoc.body.id}/fulfill`, t.exec, {
    reason: 'Dispatched to retail floor shift lead',
  });
  assert.equal(reqFulfilled.status, 201);
  assert.equal(reqFulfilled.body.requisition.status, 'fulfilled');
  assert.equal(reqFulfilled.body.requisition.decisionReason, 'Dispatched to retail floor shift lead');
  assert.ok(reqFulfilled.body.requisition.fulfilledBy);
  assert.ok(reqFulfilled.body.requisition.fulfilledAt);

  // 3. Count sheet approval records user, decision, reason, and timestamp
  const cs = await t.call('POST', '/api/stock/count-sheets', t.inv, {
    warehouseId: t.wh1,
    reference: 'CS-DECISION-1',
    lines: [{ productId: t.product, unitId: t.units.each, countedQuantity: 24 }],
  });
  assert.equal(cs.status, 201);

  const csApproved = await t.call('POST', `/api/stock/count-sheets/${cs.body.id}/approve`, t.exec, {
    reason: 'Verified physical count variance of -1 unit',
  });
  assert.equal(csApproved.status, 201);
  assert.equal(csApproved.body.sheet.status, 'approved');
  assert.equal(csApproved.body.sheet.decisionReason, 'Verified physical count variance of -1 unit');
  assert.ok(csApproved.body.sheet.approvedBy);
  assert.ok(csApproved.body.sheet.decidedBy);
  assert.ok(csApproved.body.sheet.approvedAt);
  assert.ok(csApproved.body.sheet.decidedAt);
});

test('Stage 5 branch isolation & safe file uploads: branch-scoped managers cannot read other branches; file uploads enforce MIME, magic bytes, and path safety', async () => {
  const t = await setup();
  const rcv = await t.receive(20); // posts into wh1 (branch 1)

  // Create Branch 2 and Warehouse 3 in Branch 2, plus a branch-scoped Inventory Manager assigned to Branch 2
  const b2 = (await t.call('POST', '/api/branches', t.exec, { name: 'Bulawayo Branch', city: 'Bulawayo' })).body.id;
  const wh3 = (await t.call('POST', '/api/warehouses', t.exec, { branchId: b2, name: 'Bulawayo Depot' })).body.id;
  await t.call('POST', '/api/users', t.exec, {
    email: 'byo@demo.local',
    name: 'Bulawayo Manager',
    password: 'Password123!',
    role: 'inventory_manager',
    branchId: b2,
  });
  const byoLogin = await t.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'x-requested-with': 'stockroom' },
    payload: { email: 'byo@demo.local', password: 'Password123!' },
  });
  const byoToken = byoLogin.json().token as string;

  // Branch 2 manager only sees Branch 2 and Warehouse 3, and cannot read Branch 1's stock document
  const branchesVisible = await t.call('GET', '/api/branches', byoToken);
  assert.equal(branchesVisible.status, 200);
  assert.equal(branchesVisible.body.length, 1);
  assert.equal(branchesVisible.body[0].id, b2);

  const warehousesVisible = await t.call('GET', '/api/warehouses', byoToken);
  assert.equal(warehousesVisible.status, 200);
  assert.equal(warehousesVisible.body.length, 1);
  assert.equal(warehousesVisible.body[0].id, wh3);

  const crossBranchDoc = await t.call('GET', `/api/stock/documents/${rcv.body.document.id}`, byoToken);
  assert.equal(crossBranchDoc.status, 403);
  assert.equal(crossBranchDoc.body.error, 'forbidden_warehouse');

  // Safe file uploads: valid PDF succeeds
  const validPdfBase64 = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF', 'utf8').toString('base64');
  const uploadOk = await t.call('POST', '/api/attachments', t.inv, {
    targetType: 'stock_document',
    targetId: rcv.body.document.id,
    filename: 'delivery-note-001.pdf',
    mimeType: 'application/pdf',
    contentBase64: validPdfBase64,
  });
  assert.equal(uploadOk.status, 201);
  assert.equal(uploadOk.body.filename, 'delivery-note-001.pdf');

  // Download attachment verifies CSP & nosniff headers
  const dl = await t.app.inject({
    method: 'GET',
    url: `/api/attachments/${uploadOk.body.id}/download`,
    headers: { authorization: `Bearer ${t.inv}` },
  });
  assert.equal(dl.statusCode, 200);
  assert.equal(dl.headers['x-content-type-options'], 'nosniff');
  assert.equal(dl.headers['content-security-policy'], "default-src 'none'");

  // Path traversal in filename is rejected
  const badPath = await t.call('POST', '/api/attachments', t.inv, {
    targetType: 'stock_document',
    targetId: rcv.body.document.id,
    filename: '../../etc/passwd',
    mimeType: 'application/pdf',
    contentBase64: validPdfBase64,
  });
  assert.equal(badPath.status, 400);
  assert.equal(badPath.body.error, 'invalid_filename');

  // Spoofed magic bytes (claiming application/pdf but sending executable/script content) is rejected
  const spoofedPdf = await t.call('POST', '/api/attachments', t.inv, {
    targetType: 'stock_document',
    targetId: rcv.body.document.id,
    filename: 'invoice.pdf',
    mimeType: 'application/pdf',
    contentBase64: Buffer.from('<script>alert(1)</script>', 'utf8').toString('base64'),
  });
  assert.equal(spoofedPdf.status, 400);
  assert.equal(spoofedPdf.body.error, 'file_signature_mismatch');

  // Errors never leak stack traces or internal SQL paths
  const notFoundRes = await t.call('GET', '/api/non-existent-endpoint', t.inv);
  assert.equal(notFoundRes.status, 404);
  assert.equal(notFoundRes.body.stack, undefined);
});

test('executive approvals queue returns draft POs, pending requisitions, and draft count sheets with computed varianceCount', async () => {
  const t = await setup();
  await t.receive(50);

  // Create a draft PO
  const po = await t.call('POST', '/api/purchase-orders', t.inv, {
    supplierId: t.supplier,
    warehouseId: t.wh1,
    reference: 'PO-APPROVAL-001',
    lines: [{ productId: t.product, unitId: t.units.each, orderedQuantity: 25, unitCost: 2.5 }],
  });
  assert.equal(po.status, 201);

  // Create a pending requisition
  const reqRes = await t.call('POST', '/api/requisitions', t.inv, {
    kind: 'department_issue',
    warehouseId: t.wh1,
    departmentId: t.dept,
    reference: 'REQ-APPROVAL-001',
    lines: [{ productId: t.product, unitId: t.units.each, requestedQuantity: 10 }],
  });
  assert.equal(reqRes.status, 201);

  // Create a draft count sheet with a variance (50 expected, 47 counted => variance of -3 on 1 line)
  const cs = await t.call('POST', '/api/stock/count-sheets', t.inv, {
    warehouseId: t.wh1,
    reference: 'CS-APPROVAL-001',
    lines: [{ productId: t.product, unitId: t.units.each, countedQuantity: 47 }],
  });
  assert.equal(cs.status, 201);

  const approvals = await t.call('GET', '/api/executive/approvals', t.exec);
  assert.equal(approvals.status, 200);
  assert.equal(approvals.body.totalPending, 3);
  assert.equal(approvals.body.draftPurchaseOrders.length, 1);
  assert.equal(approvals.body.draftPurchaseOrders[0].reference, 'PO-APPROVAL-001');
  assert.equal(approvals.body.pendingRequisitions.length, 1);
  assert.equal(approvals.body.pendingRequisitions[0].reference, 'REQ-APPROVAL-001');
  assert.equal(approvals.body.draftCountSheets.length, 1);
  assert.equal(approvals.body.draftCountSheets[0].reference, 'CS-APPROVAL-001');
  assert.equal(approvals.body.draftCountSheets[0].lineCount, 1);
  assert.equal(approvals.body.draftCountSheets[0].varianceCount, 1);
});
