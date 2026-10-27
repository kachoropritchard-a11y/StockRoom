-- Stage 8: System Initialization, Selected POS Department Binding, and ZIMRA Fiscal Receipts
ALTER TABLE organisations ADD COLUMN pos_department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE organisations ADD COLUMN initialized_at TEXT;

CREATE TABLE IF NOT EXISTS fiscal_receipts (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  organisation_id     INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  document_id         INTEGER NOT NULL REFERENCES stock_documents(id) ON DELETE CASCADE,
  receipt_number      TEXT NOT NULL,
  fiscal_day          INTEGER NOT NULL DEFAULT 1,
  device_id           TEXT NOT NULL,
  vat_number          TEXT NOT NULL,
  tin_number          TEXT NOT NULL,
  qr_code_payload     TEXT NOT NULL,
  verification_url    TEXT NOT NULL,
  tax_15_cents        INTEGER NOT NULL DEFAULT 0,
  tax_0_cents         INTEGER NOT NULL DEFAULT 0,
  subtotal_cents      INTEGER NOT NULL DEFAULT 0,
  total_cents         INTEGER NOT NULL DEFAULT 0,
  currency_code       TEXT NOT NULL DEFAULT 'USD',
  cashier_name        TEXT NOT NULL,
  department_name     TEXT NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (organisation_id, receipt_number)
);
