import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { loadConfig } from './config.ts';
import { openDb, type Db } from './db.ts';
import { migrate } from './migrate.ts';
import { createCountSheet, postDocument, toCents, toMilli } from './inventory/engine.ts';
import type { AuthUser } from './app.ts';

/** Creates a starter organisation structure and two users. Idempotent: does nothing if an organisation exists. */
export function seed(db: Db, passwords: { executive: string; inventory: string }, cost = 12): boolean {
  if ((db.prepare('SELECT COUNT(*) n FROM organisations').get() as { n: number }).n > 0) return false;
  const org = Number(db.prepare('INSERT INTO organisations (name) VALUES (?)').run('Demo Organisation').lastInsertRowid);
  const branch = Number(db.prepare('INSERT INTO branches (organisation_id, name, city) VALUES (?, ?, ?)').run(org, 'Head Office', 'Harare').lastInsertRowid);
  db.prepare('INSERT INTO warehouses (branch_id, name) VALUES (?, ?)').run(branch, 'Main Warehouse');
  db.prepare('INSERT INTO departments (branch_id, name) VALUES (?, ?)').run(branch, 'General');
  const addUnit = db.prepare('INSERT INTO units_of_measure (organisation_id, code, name) VALUES (?, ?, ?)');
  for (const [code, label] of [['each', 'Each'], ['kg', 'Kilogram'], ['l', 'Litre'], ['box', 'Box'], ['carton', 'Carton']]) addUnit.run(org, code, label);
  const addUser = db.prepare('INSERT INTO users (organisation_id, branch_id, email, name, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)');
  addUser.run(org, branch, 'executive@example.com', 'Executive Manager', bcrypt.hashSync(passwords.executive, cost), 'executive_manager');
  addUser.run(org, branch, 'inventory@example.com', 'Inventory Manager', bcrypt.hashSync(passwords.inventory, cost), 'inventory_manager');
  return true;
}

/** Populates realistic Zimbabwean inventory master data and initial ledger movements if no products exist yet. */
export function seedDemoInventory(db: Db): boolean {
  if ((db.prepare('SELECT COUNT(*) n FROM products').get() as { n: number }).n > 0) return false;
  const org = (db.prepare('SELECT id FROM organisations ORDER BY id LIMIT 1').get() as { id: number } | undefined)?.id;
  if (!org) return false;

  const hreBranch = (db.prepare('SELECT id FROM branches WHERE organisation_id = ? ORDER BY id LIMIT 1').get(org) as { id: number }).id;
  db.prepare('INSERT OR IGNORE INTO branches (organisation_id, name, city) VALUES (?, ?, ?)').run(org, 'Bulawayo Branch', 'Bulawayo');
  const byoBranch = (db.prepare("SELECT id FROM branches WHERE organisation_id = ? AND name = 'Bulawayo Branch'").get(org) as { id: number }).id;

  const mainWh = (db.prepare('SELECT id FROM warehouses WHERE branch_id = ? ORDER BY id LIMIT 1').get(hreBranch) as { id: number }).id;
  db.prepare('INSERT OR IGNORE INTO warehouses (branch_id, name) VALUES (?, ?)').run(hreBranch, 'Msasa Reserve Store');
  const msasaWh = (db.prepare("SELECT id FROM warehouses WHERE branch_id = ? AND name = 'Msasa Reserve Store'").get(hreBranch) as { id: number }).id;
  db.prepare('INSERT OR IGNORE INTO warehouses (branch_id, name) VALUES (?, ?)').run(byoBranch, 'Belmont Depot');

  db.prepare('INSERT OR IGNORE INTO departments (branch_id, name) VALUES (?, ?)').run(hreBranch, 'Retail Dispatch');
  const dispatchDept = (db.prepare("SELECT id FROM departments WHERE branch_id = ? AND name = 'Retail Dispatch'").get(hreBranch) as { id: number }).id;

  const addUnit = db.prepare('INSERT OR IGNORE INTO units_of_measure (organisation_id, code, name) VALUES (?, ?, ?)');
  for (const [code, label] of [['each', 'Each'], ['kg', 'Kilogram'], ['l', 'Litre'], ['box', 'Box'], ['carton', 'Carton']]) addUnit.run(org, code, label);

  const units = Object.fromEntries(
    (db.prepare('SELECT code, id FROM units_of_measure WHERE organisation_id = ?').all(org) as { code: string; id: number }[]).map((u) => [u.code, u.id]),
  );

  for (const c of ['Grains & Staples', 'Beverages & Cordials', 'Cooking Oils & Fats']) {
    db.prepare('INSERT OR IGNORE INTO categories (organisation_id, name) VALUES (?, ?)').run(org, c);
  }
  const catId = (n: string) => (db.prepare('SELECT id FROM categories WHERE organisation_id = ? AND name = ?').get(org, n) as { id: number }).id;
  const catStaples = catId('Grains & Staples');
  const catBev = catId('Beverages & Cordials');
  const catOil = catId('Cooking Oils & Fats');

  db.prepare('INSERT OR IGNORE INTO suppliers (organisation_id, name, email, phone) VALUES (?, ?, ?, ?)').run(org, 'National Foods Zimbabwe', 'orders@natfoods.co.zw', '+263 242 756100');
  db.prepare('INSERT OR IGNORE INTO suppliers (organisation_id, name, email, phone) VALUES (?, ?, ?, ?)').run(org, 'Schweppes Zimbabwe', 'sales@schweppes.co.zw', '+263 242 620231');
  const supNatfoods = (db.prepare("SELECT id FROM suppliers WHERE organisation_id = ? AND name = 'National Foods Zimbabwe'").get(org) as { id: number }).id;
  const supSchweppes = (db.prepare("SELECT id FROM suppliers WHERE organisation_id = ? AND name = 'Schweppes Zimbabwe'").get(org) as { id: number }).id;

  const addProduct = db.prepare(
    'INSERT INTO products (organisation_id, sku, name, description, category_id, base_unit_id, unit_cost_cents, reorder_level_milli) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const pMealie = Number(addProduct.run(org, 'GRN-PM10', 'Pearlenta Roller Meal 10kg', 'Super refined maize meal 10kg bag', catStaples, units.each, toCents(6.5), toMilli(40)).lastInsertRowid);
  const pRice = Number(addProduct.run(org, 'GRN-MR02', 'Mahatma Long Grain Rice 2kg', 'Parboiled long grain rice 2kg pack', catStaples, units.each, toCents(2.8), toMilli(50)).lastInsertRowid);
  const pMazoe = Number(addProduct.run(org, 'BEV-MZ2L', 'Mazoe Orange Crush 2L', 'Concentrated orange cordial 2L bottle', catBev, units.each, toCents(3.25), toMilli(60)).lastInsertRowid);
  const pOil = Number(addProduct.run(org, 'OIL-RG2L', 'Roil Pure Cooking Oil 2L', 'Refined vegetable oil 2L bottle', catOil, units.each, toCents(3.6), toMilli(45)).lastInsertRowid);

  const addPkg = db.prepare('INSERT INTO product_packagings (product_id, unit_id, factor_milli) VALUES (?, ?, ?)');
  addPkg.run(pRice, units.carton, toMilli(12)); // 1 carton = 12 x 2kg packs
  addPkg.run(pMazoe, units.carton, toMilli(6)); // 1 carton = 6 x 2L bottles
  addPkg.run(pOil, units.carton, toMilli(6)); // 1 carton = 6 x 2L bottles

  const execUser = db.prepare("SELECT id, organisation_id, branch_id, email, name, role FROM users WHERE organisation_id = ? AND role = 'executive_manager' LIMIT 1").get(org) as {
    id: number;
    organisation_id: number;
    branch_id: number | null;
    email: string;
    name: string;
    role: 'executive_manager';
  };
  const actor: AuthUser = {
    id: execUser.id,
    organisationId: execUser.organisation_id,
    branchId: execUser.branch_id,
    email: execUser.email,
    name: execUser.name,
    role: execUser.role,
  };

  // Post initial receipts through the real stock engine
  postDocument(db, actor, {
    type: 'receipt',
    supplierId: supNatfoods,
    reference: 'GRN-2026-001',
    idempotencyKey: 'seed-grn-2026-001',
    lines: [
      { productId: pMealie, warehouseId: mainWh, unitId: units.each, quantityMilli: toMilli(120), unitCostCents: toCents(6.5), batchNumber: 'NF-OCT-01', expiryDate: '2027-04-30' },
      { productId: pRice, warehouseId: mainWh, unitId: units.carton, quantityMilli: toMilli(8), unitCostCents: toCents(33.6), batchNumber: 'NF-RICE-18', expiryDate: '2027-08-15' },
      { productId: pOil, warehouseId: mainWh, unitId: units.carton, quantityMilli: toMilli(5), unitCostCents: toCents(21.6), batchNumber: 'ROIL-11', expiryDate: '2026-11-12' },
    ],
  });

  postDocument(db, actor, {
    type: 'receipt',
    supplierId: supSchweppes,
    reference: 'GRN-2026-002',
    idempotencyKey: 'seed-grn-2026-002',
    lines: [
      { productId: pMazoe, warehouseId: mainWh, unitId: units.carton, quantityMilli: toMilli(15), unitCostCents: toCents(19.5), batchNumber: 'MZ-2026-99', expiryDate: '2027-03-01' },
    ],
  });

  // Transfer some Mazoe & Rice to Msasa Reserve Store
  postDocument(db, actor, {
    type: 'transfer',
    reference: 'TRF-2026-001',
    idempotencyKey: 'seed-trf-2026-001',
    lines: [
      { productId: pMazoe, warehouseId: mainWh, toWarehouseId: msasaWh, unitId: units.carton, quantityMilli: toMilli(4) },
      { productId: pRice, warehouseId: mainWh, toWarehouseId: msasaWh, unitId: units.carton, quantityMilli: toMilli(2) },
    ],
  });

  // Issue some Cooking Oil to Retail Dispatch (taking Roil Oil down to 24 bottles, below its reorder level of 45!)
  postDocument(db, actor, {
    type: 'issue',
    departmentId: dispatchDept,
    reference: 'ISS-2026-001',
    idempotencyKey: 'seed-iss-2026-001',
    lines: [{ productId: pOil, warehouseId: mainWh, unitId: units.each, quantityMilli: toMilli(6) }],
  });

  // Create a draft count sheet ready for review/approval
  createCountSheet(db, actor, {
    warehouseId: mainWh,
    reference: 'CS-2026-OCT',
    notes: 'Weekly spot check on staples',
    lines: [
      { productId: pMealie, unitId: units.each, countedQuantity: 118 },
      { productId: pOil, unitId: units.each, countedQuantity: 24 },
    ],
  });

  return true;
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const config = loadConfig();
  if (config.NODE_ENV === 'production') throw new Error('Refusing to run demo seed in production.');
  const db = openDb(config.DATABASE_PATH);
  migrate(db);
  const pw = {
    executive: process.env.SEED_EXECUTIVE_PASSWORD ?? randomBytes(9).toString('base64url'),
    inventory: process.env.SEED_INVENTORY_PASSWORD ?? randomBytes(9).toString('base64url'),
  };
  const seededOrg = seed(db, pw);
  const seededInv = seedDemoInventory(db);
  if (seededOrg) {
    console.log('Seeded organisation and users. Credentials (shown once):');
    console.log(`  executive@example.com / ${pw.executive}`);
    console.log(`  inventory@example.com / ${pw.inventory}`);
  }
  if (seededInv) {
    console.log('Seeded demo inventory (products, suppliers, initial receipts, transfers, issues, and draft count sheet).');
  } else if (!seededOrg) {
    console.log('Organisation and demo inventory already exist; seed skipped.');
  }
}
