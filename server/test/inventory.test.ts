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
    if (key !== null && method === 'POST' && url.startsWith('/api/stock')) headers['idempotency-key'] = key ?? newKey();
    const res = await app.inject({ method, url, headers, payload: payload as object | undefined });
    return { status: res.statusCode, body: res.json() as any };
  };

  const units = Object.fromEntries((await call('GET', '/api/units', exec)).body.map((u: any) => [u.code, u.id]));
  const product = (await call('POST', '/api/products', exec, { sku: 'RICE-1', name: 'Rice', baseUnitId: units.each })).body.id as number;
  await call('POST', `/api/products/${product}/packagings`, exec, { unitId: units.carton, factor: 24 });
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
  return { db, app, exec, inv, call, units, product, wh1, wh2, wh3, branch2, balance, receive };
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
