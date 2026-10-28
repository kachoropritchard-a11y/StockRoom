import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.ts';
import { openDb } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { seed } from '../src/seed.ts';
import { resetPassword } from '../src/reset-password.ts';
import { buildApp } from '../src/app.ts';

const CSRF = { 'x-requested-with': 'stockroom' };

function setup() {
  const db = openDb(':memory:');
  migrate(db);
  seed(db, { executive: 'exec-pass-123', inventory: 'inv-pass-123' }, 4);
  const app = buildApp(db, loadConfig({ NODE_ENV: 'test', BCRYPT_COST: '4' }));
  return { db, app };
}

async function login(app: ReturnType<typeof setup>['app'], email: string, password: string) {
  return app.inject({ method: 'POST', url: '/api/auth/login', headers: CSRF, payload: { email, password } });
}

test('migrations are idempotent', () => {
  const db = openDb(':memory:');
  assert.ok(migrate(db).length > 0);
  assert.equal(migrate(db).length, 0);
});

test('health check', async () => {
  const { app } = setup();
  assert.equal((await app.inject('/api/health')).statusCode, 200);
});

test('login rejects bad credentials and invalid input', async () => {
  const { app } = setup();
  assert.equal((await login(app, 'executive@example.com', 'wrong')).statusCode, 401);
  assert.equal((await login(app, 'nobody@example.com', 'x')).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', headers: CSRF, payload: { email: 'bad' } })).statusCode, 400);
});

test('login, session, and logout via bearer token', async () => {
  const { app } = setup();
  const res = await login(app, 'executive@example.com', 'exec-pass-123');
  assert.equal(res.statusCode, 200);
  const { token, user } = res.json();
  assert.equal(user.role, 'executive_manager');
  assert.ok(!('password_hash' in user));
  const auth = { authorization: `Bearer ${token}` };
  assert.equal((await app.inject({ url: '/api/auth/me', headers: auth })).statusCode, 200);
  await app.inject({ method: 'POST', url: '/api/auth/logout', headers: auth });
  assert.equal((await app.inject({ url: '/api/auth/me', headers: auth })).statusCode, 401);
});

test('session cookie is httpOnly', async () => {
  const { app } = setup();
  const res = await login(app, 'inventory@example.com', 'inv-pass-123');
  const setCookie = String(res.headers['set-cookie']);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
});

test('role-based authorization is enforced server-side', async () => {
  const { app } = setup();
  const exec = (await login(app, 'executive@example.com', 'exec-pass-123')).json().token;
  const inv = (await login(app, 'inventory@example.com', 'inv-pass-123')).json().token;
  const get = (url: string, token?: string) => app.inject({ url, headers: token ? { authorization: `Bearer ${token}` } : {} });
  assert.equal((await get('/api/executive/ping')).statusCode, 401);
  assert.equal((await get('/api/executive/ping', inv)).statusCode, 403);
  assert.equal((await get('/api/executive/ping', exec)).statusCode, 200);
  assert.equal((await get('/api/inventory/ping', inv)).statusCode, 200);
});

test('dashboard summary is scoped and hides user count from inventory managers', async () => {
  const { app } = setup();
  const exec = (await login(app, 'executive@example.com', 'exec-pass-123')).json().token;
  const inv = (await login(app, 'inventory@example.com', 'inv-pass-123')).json().token;
  const get = async (t: string) => (await app.inject({ url: '/api/dashboard/summary', headers: { authorization: `Bearer ${t}` } })).json();
  const e = await get(exec);
  assert.equal(e.branches, 1);
  assert.equal(e.users, 2);
  assert.equal((await get(inv)).users, null);
});

test('cookie-authenticated writes without the CSRF header are rejected; bearer clients are exempt', async () => {
  const { app } = setup();
  const noHeader = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'executive@example.com', password: 'exec-pass-123' } });
  assert.equal(noHeader.statusCode, 403);
  const badOrigin = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { ...CSRF, origin: 'https://evil.example' }, payload: { email: 'executive@example.com', password: 'exec-pass-123' } });
  assert.equal(badOrigin.statusCode, 403);
  const token = (await login(app, 'executive@example.com', 'exec-pass-123')).json().token;
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { authorization: `Bearer ${token}` } })).statusCode, 200);
});

test('account locks after repeated failures, even for the right password, and reset unlocks it', async () => {
  const { app, db } = setup();
  for (let i = 0; i < 5; i++) assert.equal((await login(app, 'inventory@example.com', 'wrong')).statusCode, 401);
  assert.equal((await login(app, 'inventory@example.com', 'inv-pass-123')).statusCode, 423);
  assert.ok(resetPassword(db, 'inventory@example.com', 'brand-new-pass-1', 4));
  assert.equal((await login(app, 'inventory@example.com', 'inv-pass-123')).statusCode, 401);
  assert.equal((await login(app, 'inventory@example.com', 'brand-new-pass-1')).statusCode, 200);
});

test('change password validates, rotates credentials and revokes other sessions', async () => {
  const { app } = setup();
  const t1 = (await login(app, 'executive@example.com', 'exec-pass-123')).json().token;
  const t2 = (await login(app, 'executive@example.com', 'exec-pass-123')).json().token;
  const h = (t: string) => ({ authorization: `Bearer ${t}` });
  const change = (currentPassword: string, newPassword: string) =>
    app.inject({ method: 'POST', url: '/api/auth/change-password', headers: h(t1), payload: { currentPassword, newPassword } });
  assert.equal((await change('wrong', 'long-enough-pass')).statusCode, 400);
  assert.equal((await change('exec-pass-123', 'short')).statusCode, 400);
  assert.equal((await change('exec-pass-123', 'long-enough-pass')).statusCode, 200);
  assert.equal((await app.inject({ url: '/api/auth/me', headers: h(t1) })).statusCode, 200);
  assert.equal((await app.inject({ url: '/api/auth/me', headers: h(t2) })).statusCode, 401);
  assert.equal((await login(app, 'executive@example.com', 'long-enough-pass')).statusCode, 200);
});

test('first-time setup: /api/system/status, /api/system/setup-initial-manager, and reset-to-scratch', async () => {
  const db = openDb(':memory:');
  migrate(db);
  const app = buildApp(db, loadConfig({ NODE_ENV: 'test', BCRYPT_COST: '4' }));

  // Initially uninitialized
  const st1 = await app.inject('/api/system/status');
  assert.equal(st1.statusCode, 200);
  assert.equal(st1.json().needsSetup, true);
  assert.equal(st1.json().userCount, 0);

  // Setup initial executive manager
  const setupRes = await app.inject({
    method: 'POST',
    url: '/api/system/setup-initial-manager',
    headers: CSRF,
    payload: {
      managerName: 'Farai Chitepo (Founder)',
      managerEmail: 'owner@stockroom.co.zw',
      managerPassword: 'SecureOwnerPass123!',
      managerPin: '8899',
      businessName: 'StockRoom Harare Hardware & Groceries',
      city: 'Harare',
      currencyCode: 'USD',
      departments: ['Groceries & Staples', 'Hardware & Yard'],
      posDepartmentName: 'Groceries & Staples',
    },
  });
  assert.equal(setupRes.statusCode, 201);
  const { user, token } = setupRes.json();
  assert.equal(user.role, 'executive_manager');
  assert.equal(user.email, 'owner@stockroom.co.zw');
  assert.ok(token);

  // Status now shows initialized
  const st2 = await app.inject('/api/system/status');
  assert.equal(st2.statusCode, 200);
  assert.equal(st2.json().needsSetup, false);
  assert.equal(st2.json().userCount, 1);
  assert.equal(st2.json().organisationName, 'StockRoom Harare Hardware & Groceries');

  // Fast PIN login works with chosen PIN
  const pinRes = await app.inject({
    method: 'POST',
    url: '/api/auth/pin-login',
    headers: CSRF,
    payload: { pin: '8899' },
  });
  assert.equal(pinRes.statusCode, 200);
  assert.equal(pinRes.json().user.role, 'executive_manager');

  // Calling setup-initial-manager again conflicts
  const conflictRes = await app.inject({
    method: 'POST',
    url: '/api/system/setup-initial-manager',
    headers: CSRF,
    payload: {
      managerName: 'Another Owner',
      managerEmail: 'another@stockroom.co.zw',
      managerPassword: 'AnotherPassword123!',
      managerPin: '1122',
      businessName: 'Another Store',
      city: 'Bulawayo',
      currencyCode: 'USD',
      departments: ['Groceries'],
      posDepartmentName: 'Groceries',
    },
  });
  assert.equal(conflictRes.statusCode, 409);

  // Factory reset to scratch wipes database and drops triggers cleanly
  const resetRes = await app.inject({
    method: 'POST',
    url: '/api/system/reset',
    headers: { ...CSRF, authorization: `Bearer ${token}` },
    payload: { wipeToScratch: true },
  });
  assert.equal(resetRes.statusCode, 200);
  assert.equal(resetRes.json().wipedToScratch, true);

  // Status is back to uninitialized scratch state
  const st3 = await app.inject('/api/system/status');
  assert.equal(st3.statusCode, 200);
  assert.equal(st3.json().needsSetup, true);
  assert.equal(st3.json().userCount, 0);
});
