-- Core inventory schema.
-- Quantities are INTEGERS in thousandths ("milli" units, 3 decimal places) to avoid floating-point drift.
-- The stock movement ledger (stock_movements) is the ONLY source of truth; stock_balances is a view over it.

ALTER TABLE organisations ADD COLUMN allow_negative_stock INTEGER NOT NULL DEFAULT 0 CHECK (allow_negative_stock IN (0, 1));

CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  parent_id INTEGER REFERENCES categories(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  UNIQUE (organisation_id, name)
);

CREATE TABLE units_of_measure (
  id INTEGER PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  code TEXT NOT NULL COLLATE NOCASE,
  name TEXT NOT NULL,
  UNIQUE (organisation_id, code)
);

CREATE TABLE suppliers (
  id INTEGER PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  UNIQUE (organisation_id, name)
);

CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  sku TEXT NOT NULL COLLATE NOCASE,
  name TEXT NOT NULL,
  description TEXT,
  category_id INTEGER REFERENCES categories(id) ON DELETE RESTRICT,
  base_unit_id INTEGER NOT NULL REFERENCES units_of_measure(id) ON DELETE RESTRICT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (organisation_id, sku)
);
CREATE INDEX idx_products_name ON products(organisation_id, name);

-- Packaging: 1 <unit> = factor_milli/1000 base units (e.g. 1 carton = 24 each -> factor_milli 24000).
-- The product's base unit is implicitly factor 1.
CREATE TABLE product_packagings (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  unit_id INTEGER NOT NULL REFERENCES units_of_measure(id) ON DELETE RESTRICT,
  factor_milli INTEGER NOT NULL CHECK (factor_milli > 0),
  UNIQUE (product_id, unit_id)
);

-- One header per posted business document (receipt, issue, transfer, ...).
CREATE TABLE stock_documents (
  id INTEGER PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK (type IN ('receipt', 'issue', 'transfer', 'adjustment', 'count', 'write_off', 'reversal')),
  reference TEXT,
  reason TEXT,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE RESTRICT,
  department_id INTEGER REFERENCES departments(id) ON DELETE RESTRICT,
  reverses_document_id INTEGER UNIQUE REFERENCES stock_documents(id) ON DELETE RESTRICT, -- UNIQUE: a document can be reversed once
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (organisation_id, idempotency_key),
  CHECK ((type = 'reversal') = (reverses_document_id IS NOT NULL)),
  CHECK (type != 'reversal' OR (reason IS NOT NULL AND length(trim(reason)) > 0)),
  CHECK (type NOT IN ('adjustment', 'write_off') OR (reason IS NOT NULL AND length(trim(reason)) > 0))
);

-- The ledger. Each row is one signed change to one product at one warehouse.
--  quantity_milli: the quantity as entered, in the entered unit (for counts: the counted quantity)
--  factor_milli:   conversion factor to base units in force at posting time (history is unaffected by later packaging edits)
--  base_delta_milli: signed change in BASE units; balances are SUM of this column.
CREATE TABLE stock_movements (
  id INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES stock_documents(id) ON DELETE RESTRICT,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  unit_id INTEGER NOT NULL REFERENCES units_of_measure(id) ON DELETE RESTRICT,
  quantity_milli INTEGER NOT NULL CHECK (quantity_milli >= 0),
  factor_milli INTEGER NOT NULL CHECK (factor_milli > 0),
  base_delta_milli INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_movements_balance ON stock_movements(organisation_id, product_id, warehouse_id);
CREATE INDEX idx_movements_document ON stock_movements(document_id);
CREATE INDEX idx_movements_warehouse_time ON stock_movements(warehouse_id, id);

-- Posted history is immutable: corrections are made with new (reversal/adjustment) documents.
CREATE TRIGGER stock_movements_no_update BEFORE UPDATE ON stock_movements
BEGIN SELECT RAISE(ABORT, 'stock_movements is append-only'); END;
CREATE TRIGGER stock_movements_no_delete BEFORE DELETE ON stock_movements
BEGIN SELECT RAISE(ABORT, 'stock_movements is append-only'); END;
CREATE TRIGGER stock_documents_no_update BEFORE UPDATE ON stock_documents
BEGIN SELECT RAISE(ABORT, 'stock_documents is append-only'); END;
CREATE TRIGGER stock_documents_no_delete BEFORE DELETE ON stock_documents
BEGIN SELECT RAISE(ABORT, 'stock_documents is append-only'); END;

-- Current stock per product and warehouse, derived from the ledger (single definition of "balance").
CREATE VIEW stock_balances AS
SELECT organisation_id, product_id, warehouse_id, SUM(base_delta_milli) AS quantity_milli
FROM stock_movements
GROUP BY organisation_id, product_id, warehouse_id;
