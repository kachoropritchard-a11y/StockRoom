-- Stage 3: Purchase orders (with partial deliveries), department requisitions & internal transfer requests.
-- All actual stock changes still post exclusively through stock_documents + stock_movements.

CREATE TABLE purchase_orders (
  id INTEGER PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  reference TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'partial', 'received', 'cancelled')),
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at TEXT
);

CREATE TABLE purchase_order_lines (
  id INTEGER PRIMARY KEY,
  purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  unit_id INTEGER NOT NULL REFERENCES units_of_measure(id) ON DELETE RESTRICT,
  ordered_milli INTEGER NOT NULL CHECK (ordered_milli > 0),
  received_milli INTEGER NOT NULL DEFAULT 0 CHECK (received_milli >= 0 AND received_milli <= ordered_milli),
  unit_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0),
  UNIQUE (purchase_order_id, product_id)
);

CREATE TABLE purchase_order_receipts (
  id INTEGER PRIMARY KEY,
  purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  document_id INTEGER NOT NULL UNIQUE REFERENCES stock_documents(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE requisitions (
  id INTEGER PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('department_issue', 'warehouse_transfer')),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  department_id INTEGER REFERENCES departments(id) ON DELETE RESTRICT,
  to_warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE RESTRICT,
  reference TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'fulfilled', 'rejected')),
  posted_document_id INTEGER UNIQUE REFERENCES stock_documents(id) ON DELETE RESTRICT,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  fulfilled_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  fulfilled_at TEXT,
  CHECK ((kind = 'department_issue' AND department_id IS NOT NULL AND to_warehouse_id IS NULL)
      OR (kind = 'warehouse_transfer' AND to_warehouse_id IS NOT NULL AND department_id IS NULL))
);

CREATE TABLE requisition_lines (
  id INTEGER PRIMARY KEY,
  requisition_id INTEGER NOT NULL REFERENCES requisitions(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  unit_id INTEGER NOT NULL REFERENCES units_of_measure(id) ON DELETE RESTRICT,
  requested_milli INTEGER NOT NULL CHECK (requested_milli > 0),
  UNIQUE (requisition_id, product_id)
);
