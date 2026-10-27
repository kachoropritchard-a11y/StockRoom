-- Stage 2.1: Costing, reorder thresholds, batch/expiry tracking, count-sheet workflow, and password reset tokens.
-- Note: stock_balances view remains the single authoritative definition of stock balance.

ALTER TABLE products ADD COLUMN unit_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0);
ALTER TABLE products ADD COLUMN reorder_level_milli INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level_milli >= 0);

ALTER TABLE stock_movements ADD COLUMN unit_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0);
ALTER TABLE stock_movements ADD COLUMN batch_number TEXT;
ALTER TABLE stock_movements ADD COLUMN expiry_date TEXT;

CREATE INDEX idx_movements_expiry ON stock_movements(organisation_id, expiry_date) WHERE expiry_date IS NOT NULL;

-- Count-sheet workflow: allows recording a physical count as a draft, reviewing live variances against
-- stock_balances, and approving it (which posts an authoritative 'count' document to stock_movements).
CREATE TABLE count_sheets (
  id INTEGER PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  reference TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'cancelled')),
  posted_document_id INTEGER UNIQUE REFERENCES stock_documents(id) ON DELETE RESTRICT,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at TEXT
);

CREATE TABLE count_sheet_lines (
  id INTEGER PRIMARY KEY,
  count_sheet_id INTEGER NOT NULL REFERENCES count_sheets(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  unit_id INTEGER NOT NULL REFERENCES units_of_measure(id) ON DELETE RESTRICT,
  counted_milli INTEGER NOT NULL CHECK (counted_milli >= 0),
  UNIQUE (count_sheet_id, product_id)
);

-- Self-service password reset tokens (stored hashed) and local email outbox so resets work without external SMTP.
CREATE TABLE password_reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE email_outbox (
  id INTEGER PRIMARY KEY,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
