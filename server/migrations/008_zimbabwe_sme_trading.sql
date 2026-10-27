-- Stage 7: Zimbabwean SME Dual-Department Trading & Stock-to-Sales Ledger Extensions
-- Adds Retail Selling Price, Wholesale Price, ZIMRA VAT Category, and Department link to products;
-- adds unit selling price & payment tender to stock_movements;
-- and creates persistent tables for Chikwereti (Customer Credit), Supplier Creditors,
-- Hardware Paid & Uncollected Lay-By Stock, Multi-Tender Till Shifts, USD Small-Change Vouchers,
-- Yield & Break-Bulk Batches, and Staff 4-Digit Fast PINs.

ALTER TABLE products ADD COLUMN selling_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (selling_price_cents >= 0);
ALTER TABLE products ADD COLUMN wholesale_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (wholesale_price_cents >= 0);
ALTER TABLE products ADD COLUMN vat_category TEXT NOT NULL DEFAULT 'standard_15' CHECK (vat_category IN ('standard_15', 'zero_rated', 'exempt'));
ALTER TABLE products ADD COLUMN department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL;

ALTER TABLE stock_movements ADD COLUMN unit_selling_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (unit_selling_price_cents >= 0);
ALTER TABLE stock_movements ADD COLUMN tender_type TEXT NOT NULL DEFAULT 'USD_CASH';

-- Backfill initial retail selling price (~30% retail markup) for existing products where selling_price_cents = 0
UPDATE products
   SET selling_price_cents = CASE
     WHEN unit_cost_cents > 0 THEN CAST(ROUND(unit_cost_cents * 1.30) AS INTEGER)
     ELSE 250
   END
 WHERE selling_price_cents = 0;

CREATE TABLE IF NOT EXISTS staff_pins (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  organisation_id   INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  staff_name        TEXT    NOT NULL,
  role_title        TEXT    NOT NULL DEFAULT 'Storefloor Counter Staff',
  pin_code          TEXT    NOT NULL CHECK (length(pin_code) = 4),
  department_scope  TEXT    NOT NULL DEFAULT 'All Departments',
  can_view_cost     INTEGER NOT NULL DEFAULT 0 CHECK (can_view_cost IN (0, 1)),
  can_write_off     INTEGER NOT NULL DEFAULT 0 CHECK (can_write_off IN (0, 1)),
  active            INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (organisation_id, pin_code)
);

CREATE TABLE IF NOT EXISTS customer_credit_accounts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  organisation_id   INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  customer_name     TEXT    NOT NULL,
  phone             TEXT    NOT NULL,
  department_name   TEXT    NOT NULL DEFAULT 'Groceries',
  credit_limit_cents INTEGER NOT NULL DEFAULT 10000 CHECK (credit_limit_cents >= 0),
  balance_cents     INTEGER NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  due_date          TEXT    NOT NULL,
  items_summary     TEXT    NOT NULL DEFAULT '',
  status            TEXT    NOT NULL DEFAULT 'CURRENT' CHECK (status IN ('CURRENT', 'DUE_SOON', 'OVERDUE', 'CLEARED')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS supplier_credit_ledgers (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  organisation_id   INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  supplier_id       INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name     TEXT    NOT NULL,
  invoice_ref       TEXT    NOT NULL,
  department_name   TEXT    NOT NULL DEFAULT 'Groceries & Hardware',
  total_cents       INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  paid_cents        INTEGER NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),
  balance_cents     INTEGER NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  currency_code     TEXT    NOT NULL DEFAULT 'USD',
  due_date          TEXT    NOT NULL,
  notes             TEXT,
  status            TEXT    NOT NULL DEFAULT 'PARTIAL' CHECK (status IN ('OWED', 'PARTIAL', 'SETTLED')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS paid_uncollected_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  organisation_id   INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  receipt_ref       TEXT    NOT NULL,
  customer_name     TEXT    NOT NULL,
  customer_phone    TEXT    NOT NULL,
  product_id        INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name      TEXT    NOT NULL,
  department_name   TEXT    NOT NULL DEFAULT 'Hardware & Building',
  warehouse_name    TEXT    NOT NULL DEFAULT 'Main Warehouse',
  ordered_qty       REAL    NOT NULL CHECK (ordered_qty > 0),
  collected_qty     REAL    NOT NULL DEFAULT 0 CHECK (collected_qty >= 0),
  unit              TEXT    NOT NULL DEFAULT 'each',
  total_paid_cents  INTEGER NOT NULL DEFAULT 0 CHECK (total_paid_cents >= 0),
  status            TEXT    NOT NULL DEFAULT 'AWAITING_COLLECTION' CHECK (status IN ('AWAITING_COLLECTION', 'PARTIAL_COLLECTED', 'COMPLETED')),
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS till_shifts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  organisation_id   INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  shift_ref         TEXT    NOT NULL,
  cashier_name      TEXT    NOT NULL,
  department_name   TEXT    NOT NULL DEFAULT 'General Store & Yard',
  expected_usd_cents INTEGER NOT NULL DEFAULT 0,
  counted_usd_cents  INTEGER NOT NULL DEFAULT 0,
  expected_zig_cents INTEGER NOT NULL DEFAULT 0,
  counted_zig_cents  INTEGER NOT NULL DEFAULT 0,
  expected_zar_cents INTEGER NOT NULL DEFAULT 0,
  counted_zar_cents  INTEGER NOT NULL DEFAULT 0,
  ecocash_usd_cents  INTEGER NOT NULL DEFAULT 0,
  ecocash_zig_cents  INTEGER NOT NULL DEFAULT 0,
  innbucks_usd_cents INTEGER NOT NULL DEFAULT 0,
  onemoney_zig_cents INTEGER NOT NULL DEFAULT 0,
  change_vouchers_issued_cents INTEGER NOT NULL DEFAULT 0,
  variance_usd_cents INTEGER NOT NULL DEFAULT 0,
  status            TEXT    NOT NULL DEFAULT 'BALANCED' CHECK (status IN ('OPEN', 'BALANCED', 'SHORTAGE', 'SURPLUS')),
  notes             TEXT,
  closed_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS change_vouchers (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  organisation_id   INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  voucher_code      TEXT    NOT NULL,
  customer_name     TEXT    NOT NULL DEFAULT 'Walk-In Customer',
  customer_phone    TEXT,
  amount_cents      INTEGER NOT NULL CHECK (amount_cents > 0),
  department_name   TEXT    NOT NULL DEFAULT 'Groceries',
  status            TEXT    NOT NULL DEFAULT 'UNREDEEMED' CHECK (status IN ('UNREDEEMED', 'REDEEMED')),
  created_by_name   TEXT    NOT NULL DEFAULT 'Cashier',
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  redeemed_at       TEXT,
  UNIQUE (organisation_id, voucher_code)
);

CREATE TABLE IF NOT EXISTS yield_batches (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  organisation_id   INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  batch_ref         TEXT    NOT NULL,
  kind              TEXT    NOT NULL DEFAULT 'BREAK_BULK' CHECK (kind IN ('BREAK_BULK', 'RECIPE_YIELD')),
  department_name   TEXT    NOT NULL DEFAULT 'Groceries',
  source_name       TEXT    NOT NULL,
  input_qty         REAL    NOT NULL CHECK (input_qty > 0),
  input_unit        TEXT    NOT NULL,
  output_name       TEXT    NOT NULL,
  expected_output_qty REAL  NOT NULL CHECK (expected_output_qty > 0),
  actual_output_qty REAL    NOT NULL CHECK (actual_output_qty > 0),
  output_unit       TEXT    NOT NULL,
  waste_qty         REAL    NOT NULL DEFAULT 0,
  yield_pct         REAL    NOT NULL DEFAULT 100,
  document_id       INTEGER REFERENCES stock_documents(id) ON DELETE SET NULL,
  created_by_name   TEXT    NOT NULL DEFAULT 'Storeman',
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);
