-- Migration 011: Serial Numbers, IMEIs, and Product Serial Tracking
-- Enables recording and tracking unique Serial Numbers and IMEIs on stock intake,
-- maintaining an itemized lifecycle (IN_STOCK, SOLD, DEFECTIVE, TRANSFERRED).

CREATE TABLE IF NOT EXISTS stock_serial_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  organisation_id   INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  product_id        INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  warehouse_id      INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  document_id       INTEGER REFERENCES stock_documents(id) ON DELETE SET NULL,
  serial_number     TEXT,
  imei              TEXT,
  batch_number      TEXT,
  status            TEXT NOT NULL DEFAULT 'IN_STOCK' CHECK (status IN ('IN_STOCK', 'SOLD', 'DEFECTIVE', 'TRANSFERRED', 'WRITTEN_OFF')),
  notes             TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_stock_serials_org ON stock_serial_items(organisation_id);
CREATE INDEX IF NOT EXISTS idx_stock_serials_status ON stock_serial_items(organisation_id, status);
CREATE INDEX IF NOT EXISTS idx_stock_serials_sn ON stock_serial_items(organisation_id, serial_number);
CREATE INDEX IF NOT EXISTS idx_stock_serials_imei ON stock_serial_items(organisation_id, imei);
CREATE INDEX IF NOT EXISTS idx_stock_serials_product ON stock_serial_items(organisation_id, product_id);
