import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { loadConfig } from './config.ts';
import { openDb, type Db } from './db.ts';
import { migrate } from './migrate.ts';
import { createCountSheet, createPurchaseOrder, createRequisition, postDocument, receivePurchaseOrder, toCents, toMilli } from './inventory/engine.ts';
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

  seedDemoProcurementAndRequisitions(db);
  ensureDualDepartmentDemoData(db);
  return true;
}

/** Idempotently seeds sample purchase orders and department requisitions if none exist yet. */
export function seedDemoProcurementAndRequisitions(db: Db): boolean {
  if ((db.prepare('SELECT COUNT(*) n FROM purchase_orders').get() as { n: number }).n > 0) return false;
  const org = (db.prepare('SELECT id FROM organisations ORDER BY id LIMIT 1').get() as { id: number } | undefined)?.id;
  if (!org) return false;
  const execUser = db.prepare("SELECT id, organisation_id, branch_id, email, name, role FROM users WHERE organisation_id = ? AND role = 'executive_manager' LIMIT 1").get(org) as
    | { id: number; organisation_id: number; branch_id: number | null; email: string; name: string; role: 'executive_manager' }
    | undefined;
  if (!execUser) return false;
  const actor: AuthUser = {
    id: execUser.id,
    organisationId: execUser.organisation_id,
    branchId: execUser.branch_id,
    email: execUser.email,
    name: execUser.name,
    role: execUser.role,
  };

  const mainWh = (db.prepare("SELECT w.id FROM warehouses w JOIN branches b ON b.id = w.branch_id WHERE b.organisation_id = ? ORDER BY w.id LIMIT 1").get(org) as { id: number } | undefined)?.id;
  const supNatfoods = (db.prepare("SELECT id FROM suppliers WHERE organisation_id = ? ORDER BY id LIMIT 1").get(org) as { id: number } | undefined)?.id;
  const pOil = (db.prepare("SELECT id, base_unit_id FROM products WHERE organisation_id = ? AND sku = 'OIL-RG2L'").get(org) as { id: number; base_unit_id: number } | undefined);
  const pMealie = (db.prepare("SELECT id, base_unit_id FROM products WHERE organisation_id = ? AND sku = 'GRN-PM10'").get(org) as { id: number; base_unit_id: number } | undefined);
  const dispatchDept = (db.prepare("SELECT d.id FROM departments d JOIN branches b ON b.id = d.branch_id WHERE b.organisation_id = ? AND d.name = 'Retail Dispatch'").get(org) as { id: number } | undefined)?.id;

  if (!mainWh || !supNatfoods || !pOil || !pMealie) return false;

  // Create an approved PO for restocking cooking oil and roller meal, and record a partial delivery
  const poId = createPurchaseOrder(db, actor, {
    supplierId: supNatfoods,
    warehouseId: mainWh,
    reference: 'PO-2026-104',
    notes: 'Urgent restock for Roil Cooking Oil and Pearlenta Meal',
    approveImmediately: true,
    lines: [
      { productId: pOil.id, unitId: pOil.base_unit_id, orderedQuantity: 60, unitCost: 3.6 },
      { productId: pMealie.id, unitId: pMealie.base_unit_id, orderedQuantity: 50, unitCost: 6.5 },
    ],
  });

  receivePurchaseOrder(db, actor, poId, {
    reference: 'GRN-PO104-PART1',
    idempotencyKey: 'seed-po-104-part1',
    lines: [{ productId: pMealie.id, quantity: 25, batchNumber: 'NF-NOV-02', expiryDate: '2027-06-30' }],
  });

  if (dispatchDept) {
    createRequisition(db, actor, {
      kind: 'department_issue',
      warehouseId: mainWh,
      departmentId: dispatchDept,
      reference: 'REQ-2026-019',
      notes: 'Front-of-store weekend replenishment',
      lines: [{ productId: pMealie.id, unitId: pMealie.base_unit_id, requestedQuantity: 15 }],
    });
  }

  return true;
}

/** Ensures realistic Zimbabwean dual-department (Groceries + Hardware) products, departments, and initial counter sales exist. */
export function ensureDualDepartmentDemoData(db: Db): boolean {
  const org = (db.prepare('SELECT id FROM organisations ORDER BY id LIMIT 1').get() as { id: number } | undefined)?.id;
  if (!org) return false;
  const hreBranch = (db.prepare('SELECT id FROM branches WHERE organisation_id = ? ORDER BY id LIMIT 1').get(org) as { id: number } | undefined)?.id;
  if (!hreBranch) return false;

  db.prepare('INSERT OR IGNORE INTO departments (branch_id, name) VALUES (?, ?)').run(hreBranch, 'Groceries & Staples');
  db.prepare('INSERT OR IGNORE INTO departments (branch_id, name) VALUES (?, ?)').run(hreBranch, 'Hardware & Building');
  const grocDept = (db.prepare("SELECT id FROM departments WHERE branch_id = ? AND name = 'Groceries & Staples'").get(hreBranch) as { id: number } | undefined)?.id;
  const hwDept = (db.prepare("SELECT id FROM departments WHERE branch_id = ? AND name = 'Hardware & Building'").get(hreBranch) as { id: number } | undefined)?.id;

  // Assign existing grocery products to Groceries & Staples with realistic Zimbabwean retail prices & VAT categories
  if (grocDept) {
    db.prepare(
      "UPDATE products SET department_id = ?, selling_price_cents = 850, wholesale_price_cents = 780, vat_category = 'zero_rated' WHERE organisation_id = ? AND sku = 'GRN-PM10'",
    ).run(grocDept, org);
    db.prepare(
      "UPDATE products SET department_id = ?, selling_price_cents = 380, wholesale_price_cents = 340, vat_category = 'zero_rated' WHERE organisation_id = ? AND sku = 'GRN-MR02'",
    ).run(grocDept, org);
    db.prepare(
      "UPDATE products SET department_id = ?, selling_price_cents = 450, wholesale_price_cents = 400, vat_category = 'standard_15' WHERE organisation_id = ? AND sku = 'BEV-MZ2L'",
    ).run(grocDept, org);
    db.prepare(
      "UPDATE products SET department_id = ?, selling_price_cents = 480, wholesale_price_cents = 430, vat_category = 'standard_15' WHERE organisation_id = ? AND sku = 'OIL-RG2L'",
    ).run(grocDept, org);
  }

  // Check if Hardware products already exist
  const hwExists = db.prepare("SELECT id FROM products WHERE organisation_id = ? AND sku = 'HW-PPC50'").get(org);
  if (hwExists) return false;

  db.prepare('INSERT OR IGNORE INTO categories (organisation_id, name) VALUES (?, ?)').run(org, 'Hardware & Building Materials');
  const catHw = (db.prepare("SELECT id FROM categories WHERE organisation_id = ? AND name = 'Hardware & Building Materials'").get(org) as { id: number }).id;

  db.prepare('INSERT OR IGNORE INTO suppliers (organisation_id, name, email, phone) VALUES (?, ?, ?, ?)').run(
    org,
    'PPC Zimbabwe Cement',
    'sales@ppc.co.zw',
    '+263 242 486201',
  );
  const supPpc = (db.prepare("SELECT id FROM suppliers WHERE organisation_id = ? AND name = 'PPC Zimbabwe Cement'").get(org) as { id: number }).id;

  const eachUnit = (db.prepare("SELECT id FROM units_of_measure WHERE organisation_id = ? AND code = 'each'").get(org) as { id: number }).id;
  const kgUnit = (db.prepare("SELECT id FROM units_of_measure WHERE organisation_id = ? AND code = 'kg'").get(org) as { id: number } | undefined)?.id ?? eachUnit;
  const mainWh = (db.prepare('SELECT id FROM warehouses WHERE branch_id = ? ORDER BY id LIMIT 1').get(hreBranch) as { id: number }).id;

  const addHwProd = db.prepare(
    `INSERT INTO products (organisation_id, sku, name, description, category_id, department_id, base_unit_id, unit_cost_cents, selling_price_cents, wholesale_price_cents, vat_category, reorder_level_milli)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'standard_15', ?)`,
  );
  const pCement = Number(
    addHwProd.run(
      org,
      'HW-PPC50',
      'PPC Surebuild Cement 50kg',
      '32.5N All-purpose building cement 50kg bag',
      catHw,
      hwDept ?? null,
      eachUnit,
      toCents(10.2),
      toCents(12.5),
      toCents(11.8),
      toMilli(30),
    ).lastInsertRowid,
  );
  const pIbr = Number(
    addHwProd.run(
      org,
      'HW-IBR36',
      'IBR Chromadek Roofing Sheet 3.6m',
      '0.4mm Charcoal Chromadek IBR roof sheet 3.6m',
      catHw,
      hwDept ?? null,
      eachUnit,
      toCents(17.5),
      toCents(22.0),
      toCents(20.5),
      toMilli(20),
    ).lastInsertRowid,
  );
  const pNails = Number(
    addHwProd.run(
      org,
      'HW-NAIL3',
      'Wire Nails 3-Inch (75mm) Bulk',
      'High-tensile carpentry wire nails sold per kg',
      catHw,
      hwDept ?? null,
      kgUnit,
      toCents(1.8),
      toCents(2.5),
      toCents(2.2),
      toMilli(25),
    ).lastInsertRowid,
  );

  const execUser = db.prepare("SELECT id, organisation_id, branch_id, email, name, role FROM users WHERE organisation_id = ? AND role = 'executive_manager' LIMIT 1").get(org) as
    | { id: number; organisation_id: number; branch_id: number | null; email: string; name: string; role: 'executive_manager' }
    | undefined;
  if (!execUser) return true;
  const actor: AuthUser = {
    id: execUser.id,
    organisationId: execUser.organisation_id,
    branchId: execUser.branch_id,
    email: execUser.email,
    name: execUser.name,
    role: execUser.role,
  };

  // Receive Hardware stock into Main Warehouse
  postDocument(db, actor, {
    type: 'receipt',
    supplierId: supPpc,
    reference: 'GRN-HW-2026-01',
    idempotencyKey: 'seed-grn-hw-2026-01',
    lines: [
      { productId: pCement, warehouseId: mainWh, unitId: eachUnit, quantityMilli: toMilli(140), unitCostCents: toCents(10.2), batchNumber: 'PPC-OCT-88' },
      { productId: pIbr, warehouseId: mainWh, unitId: eachUnit, quantityMilli: toMilli(60), unitCostCents: toCents(17.5), batchNumber: 'IBR-36-09' },
      { productId: pNails, warehouseId: mainWh, unitId: kgUnit, quantityMilli: toMilli(100), unitCostCents: toCents(1.8), batchNumber: 'NAIL-75-02' },
    ],
  });

  // Record a Hardware counter sale (25 bags Cement + 12 IBR sheets + 10kg Nails)
  postDocument(db, actor, {
    type: 'issue',
    departmentId: hwDept ?? null,
    reference: 'SALE-HW-001',
    reason: 'Counter sale (USD_CASH) - Ruwa Builders',
    idempotencyKey: 'seed-sale-hw-001',
    lines: [
      { productId: pCement, warehouseId: mainWh, unitId: eachUnit, quantityMilli: toMilli(25), unitSellingPriceCents: toCents(12.5), tenderType: 'USD_CASH' },
      { productId: pIbr, warehouseId: mainWh, unitId: eachUnit, quantityMilli: toMilli(12), unitSellingPriceCents: toCents(22.0), tenderType: 'ECOCASH_USD' },
      { productId: pNails, warehouseId: mainWh, unitId: kgUnit, quantityMilli: toMilli(10), unitSellingPriceCents: toCents(2.5), tenderType: 'USD_CASH' },
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
  const seededProc = seedDemoProcurementAndRequisitions(db);
  const seededDual = ensureDualDepartmentDemoData(db);
  if (seededOrg) {
    console.log('Seeded organisation and users. Credentials (shown once):');
    console.log(`  executive@example.com / ${pw.executive}`);
    console.log(`  inventory@example.com / ${pw.inventory}`);
  }
  if (seededInv || seededProc || seededDual) {
    console.log('Seeded demo inventory, purchase orders, and requisitions.');
  } else if (!seededOrg) {
    console.log('Organisation and demo inventory already exist; seed skipped.');
  }
}
